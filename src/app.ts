/**
 * 应用装配层：把模型、工具、规则、Guardrail、审批处理器与 Agent Loop
 * 组装成一个可直接运行的「缺陷诊断与工单分流」入口。
 */
import { createInterface } from 'node:readline/promises'
import { runAgentTurn, type AgentTurnArgs } from './agent-loop.js'
import { DispatchOrderGuardrail, type ApprovalHandler } from './guardrails.js'
import { TraceLogger } from './observability.js'
import { buildSystemPrompt } from './prompt.js'
import { RuleRegistry } from './rules/progressive-loader.js'
import { createToolRegistry } from './tools/index.js'
import { createModelAdapter } from './model/index.js'
import type { AgentTurnResult, ChatMessage, ModelAdapter } from './types.js'

export type ApprovalMode = 'interactive' | 'auto' | 'reject'

export type RunDiagnosisOptions = {
  text: string
  cwd?: string
  mock?: boolean
  maxSteps?: number
  approvalMode?: ApprovalMode
  model?: ModelAdapter
  trace?: TraceLogger
  approve?: ApprovalHandler
}

export type RunDiagnosisResult = {
  result: AgentTurnResult
  logger: TraceLogger
}

export async function runDiagnosis(options: RunDiagnosisOptions): Promise<RunDiagnosisResult> {
  const cwd = options.cwd ?? process.cwd()
  const ruleRegistry = new RuleRegistry()
  const system = buildSystemPrompt(ruleRegistry.listIndex())

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: options.text },
  ]

  const tools = createToolRegistry()
  const model = options.model ?? createModelAdapter({ mock: options.mock })
  const guardrails = new DispatchOrderGuardrail()
  const logger = options.trace ?? new TraceLogger()

  logger.onEvent({ type: 'system', content: system })
  logger.onEvent({ type: 'user_input', content: options.text })

  const approve = options.approve ?? createApprovalHandler(options.approvalMode ?? 'interactive')

  const loopArgs: AgentTurnArgs = {
    model,
    tools,
    messages,
    cwd,
    maxSteps: options.maxSteps,
    guardrails,
    approve,
    trace: logger,
  }

  const result = await runAgentTurn(loopArgs)
  return { result, logger }
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${question} [y/n]: `)
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

export function createApprovalHandler(mode: ApprovalMode): ApprovalHandler {
  if (mode === 'auto') {
    return async () => ({ approved: true, note: '自动放行（演示模式）' })
  }
  if (mode === 'reject') {
    return async () => ({ approved: false, note: '自动拒绝' })
  }
  return async (request) => {
    const approved = await promptYesNo(`是否批准该高危工单签发？拦截原因：${request.reason}`)
    return { approved, note: approved ? '人工确认通过' : '人工拒绝' }
  }
}
