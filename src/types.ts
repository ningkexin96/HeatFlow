/**
 * 核心领域类型：对话消息、工具调用、模型步骤与 Agent 回合结果。
 *
 * 这些类型是 Agent 主调度循环、模型适配层与工具注册中心之间
 * 共享的「协议」，保证各模块低耦合、可替换（如替换不同厂商的模型适配器）。
 */

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; internal?: 'continuation' }
  | { role: 'assistant'; content: string }
  | {
      role: 'assistant_tool_call'
      toolUseId: string
      toolName: string
      input: unknown
    }
  | {
      role: 'tool_result'
      toolUseId: string
      toolName: string
      content: string
      isError: boolean
    }

export type ToolCall = {
  id: string
  toolName: string
  input: unknown
}

/** 模型单步输出：要么直接给出最终回答，要么给出若干工具调用。 */
export type AgentStep =
  | { type: 'assistant'; content: string; kind?: 'final' | 'progress' }
  | {
      type: 'tool_calls'
      calls: ToolCall[]
      content?: string
      contentKind?: 'progress'
    }

/** 暴露给模型端的工具元数据（OpenAI Function Calling 协议）。 */
export type ModelToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type ModelRequestOptions = {
  tools?: ModelToolDefinition[]
  signal?: AbortSignal
}

/** 模型驱动层抽象：Agent Loop 只依赖该接口，不关心底层是真实 API 还是脚本模型。 */
export interface ModelAdapter {
  next(messages: ChatMessage[], options?: ModelRequestOptions): Promise<AgentStep>
}

export type AgentTurnOutcome = 'final' | 'max_steps' | 'failed' | 'aborted'

export type AgentTurnResult = {
  messages: ChatMessage[]
  outcome: AgentTurnOutcome
  toolCalls: number
  error?: string
}
