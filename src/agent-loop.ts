/**
 * Agent 主调度循环（Agent Loop）。
 *
 * 驱动大模型完成「思考(Thought) → 决策动作(Tool Call) → 观察回传(Observation)
 * → 下一步决策」的多轮闭环，并内置完备异常保护：
 *  - 最大推理步数限制（Max Steps Protection），防止死循环；
 *  - 空响应 / 模型异常自动捕获与自愈重试（回填提示后继续）；
 *  - 工具调用异常捕获与错误信息回填至上下文；
 *  - 高危操作（停电/危急缺陷工单）由 Guardrail 阻塞并等待人工审批。
 */
import type { AgentStep, AgentTurnResult, ChatMessage, ModelAdapter } from './types.js'
import type { ToolRegistry, ToolResult } from './tool.js'
import type { ApprovalHandler, ApprovalRequest, GuardrailPolicy } from './guardrails.js'
import type { TraceSink } from './observability.js'

export type AgentTurnArgs = {
  model: ModelAdapter
  tools: ToolRegistry
  messages: ChatMessage[]
  cwd: string
  maxSteps?: number
  guardrails?: GuardrailPolicy
  approve?: ApprovalHandler
  trace?: TraceSink
  signal?: AbortSignal
}

export async function runAgentTurn(args: AgentTurnArgs): Promise<AgentTurnResult> {
  const maxSteps = args.maxSteps ?? 8
  let messages = args.messages
  let toolCalls = 0
  let emptyRetries = 0
  let modelErrorRetries = 0
  let toolErrorCount = 0

  const finish = (outcome: AgentTurnResult['outcome'], error?: string): AgentTurnResult => {
    args.trace?.onEvent({ type: 'outcome', outcome, toolCalls })
    return { messages, outcome, toolCalls, ...(error ? { error } : {}) }
  }

  const pushContinuation = (content: string) => {
    messages = [...messages, { role: 'user', content, internal: 'continuation' }]
  }

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (args.signal?.aborted) {
        return finish('aborted', String(args.signal.reason ?? '执行被中止'))
      }

      let next: AgentStep
      try {
        next = await args.model.next(messages, {
          tools: args.tools.listForModel(),
          signal: args.signal,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (modelErrorRetries < 2) {
          modelErrorRetries += 1
          args.trace?.onEvent({
            type: 'error',
            message: `模型调用异常，已自动捕获并回填上下文，进行第 ${modelErrorRetries} 次自愈重试：${message}`,
          })
          pushContinuation(`上一次模型调用失败：${message}。请忽略该错误，继续完成缺陷研判任务。`)
          continue
        }
        return finish('failed', `模型调用连续失败：${message}`)
      }

      // 情况 1：模型直接给出最终回答。
      if (next.type === 'assistant') {
        if (!next.content.trim()) {
          if (emptyRetries < 2) {
            emptyRetries += 1
            args.trace?.onEvent({
              type: 'error',
              message: `模型返回空响应，已自动捕获，进行第 ${emptyRetries} 次自愈重试。`,
            })
            pushContinuation('你的上一条响应为空。请继续：调用工具获取数据，或输出最终综合研判报告。')
            continue
          }
          return finish('failed', '模型连续返回空响应，已停止当前回合')
        }

        args.trace?.onEvent({ type: 'final', content: next.content })
        messages = [...messages, { role: 'assistant', content: next.content }]
        return finish('final')
      }

      // 情况 2：模型请求工具调用。
      if (next.content) {
        args.trace?.onEvent({ type: 'thought', step, content: next.content })
      }

      // 先写入 assistant_tool_call 与占位 tool_result，保证工具错误也能回填到上下文。
      messages = [
        ...messages,
        ...next.calls.map((call) => ({
          role: 'assistant_tool_call' as const,
          toolUseId: call.id,
          toolName: call.toolName,
          input: call.input,
        })),
        ...next.calls.map((call) => ({
          role: 'tool_result' as const,
          toolUseId: call.id,
          toolName: call.toolName,
          content: '未执行',
          isError: false,
        })),
      ]

      for (const call of next.calls) {
        toolCalls += 1
        args.trace?.onEvent({ type: 'tool_call', step, name: call.toolName, input: call.input })

        let toolResult: ToolResult

        const decision = args.guardrails?.evaluate(call.toolName, call.input)
        if (decision && !decision.allowed) {
          const request: ApprovalRequest = {
            toolName: call.toolName,
            reason: decision.reason,
            riskLevel: decision.riskLevel,
            diff: decision.diff,
            input: call.input,
            proposedOrder: decision.proposedOrder,
          }

          args.trace?.onEvent({ type: 'approval_required', step, request })

          const answer = args.approve
            ? await args.approve(request)
            : { approved: false, note: '未配置审批处理器，默认拒绝' }

          args.trace?.onEvent({
            type: 'approval_decision',
            step,
            approved: answer.approved,
            note: answer.note,
          })

          if (!answer.approved) {
            toolResult = {
              ok: false,
              output: JSON.stringify(
                {
                  issued: false,
                  rejected: true,
                  order_no: request.proposedOrder.order_no,
                  reason: '高危工单被人工审批拒绝',
                  note: answer.note ?? '',
                },
                null,
                2,
              ),
            }
          } else {
            toolResult = await args.tools.execute(call.toolName, call.input, {
              cwd: args.cwd,
              signal: args.signal,
              approvedPayload: request.proposedOrder,
            })
          }
        } else {
          toolResult = await args.tools.execute(call.toolName, call.input, {
            cwd: args.cwd,
            signal: args.signal,
          })
        }

        if (!toolResult.ok) toolErrorCount += 1
        args.trace?.onEvent({
          type: 'tool_result',
          step,
          name: call.toolName,
          output: toolResult.output,
          isError: !toolResult.ok,
        })

        // 错误信息回填至上下文，供模型下一步自适应。
        messages = messages.map((message) =>
          message.role === 'tool_result' && message.toolUseId === call.id
            ? { ...message, content: toolResult.output, isError: !toolResult.ok }
            : message,
        )
      }

      // 继续下一轮推理；若工具调用已被计入步数，循环条件会阻止死循环。
    }

    return finish('max_steps')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (args.signal?.aborted) {
      return finish('aborted', String(args.signal.reason ?? message))
    }
    args.trace?.onEvent({ type: 'error', message })
    return finish('failed', message)
  }
}
