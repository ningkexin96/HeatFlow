/**
 * 真实模型适配器：OpenAI 兼容接口（/chat/completions）。
 *
 * 支持任意标准 OpenAI 格式 API（含 OpenAI、DeepSeek、通义、Moonshot 等，
 * 以及经网关转换为 OpenAI 格式的 Anthropic 服务）。
 *
 * 职责：将内部 ChatMessage 协议映射为 OpenAI 消息协议，发送请求并解析
 * 文本 / 工具调用；对 429 / 5xx 做指数退避重试。
 */
import type {
  AgentStep,
  ChatMessage,
  ModelAdapter,
  ModelRequestOptions,
  ToolCall,
} from '../types.js'
import type { ModelConfig } from '../config.js'

const DEFAULT_MAX_RETRIES = 4
const BASE_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 8000

type OpenAIToolCall = {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

type OpenAIResponse = {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: OpenAIToolCall[] } }>
  error?: { message?: string }
}

function safeParseJson(text: string): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export function toOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  let pendingToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []

  const flush = () => {
    if (pendingToolCalls.length > 0) {
      out.push({ role: 'assistant', content: null, tool_calls: pendingToolCalls })
      pendingToolCalls = []
    }
  }

  for (const message of messages) {
    if (message.role === 'assistant_tool_call') {
      pendingToolCalls.push({
        id: message.toolUseId,
        type: 'function',
        function: {
          name: message.toolName,
          arguments: JSON.stringify(message.input ?? {}),
        },
      })
      continue
    }

    flush()

    if (message.role === 'system') out.push({ role: 'system', content: message.content })
    else if (message.role === 'user') out.push({ role: 'user', content: message.content })
    else if (message.role === 'assistant') out.push({ role: 'assistant', content: message.content })
    else if (message.role === 'tool_result') {
      out.push({ role: 'tool', tool_call_id: message.toolUseId, content: message.content })
    }
  }

  flush()
  return out
}

function buildUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

function retryDelayMs(attempt: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS)
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  constructor(private readonly getConfig: () => ModelConfig) {}

  async next(messages: ChatMessage[], options: ModelRequestOptions = {}): Promise<AgentStep> {
    const config = this.getConfig()
    if (!config.apiKey) {
      throw new Error('未配置 OPENAI_API_KEY，无法调用真实模型')
    }

    const tools = options.tools ?? []
    const body: Record<string, unknown> = {
      model: config.model,
      messages: toOpenAIMessages(messages),
    }

    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }))
      body.tool_choice = 'auto'
    }

    if (config.maxOutputTokens) {
      body.max_tokens = config.maxOutputTokens
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    }

    const url = buildUrl(config.baseUrl)
    const maxRetries = DEFAULT_MAX_RETRIES
    let response: Response | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      })
      if (response.ok) break
      if (!shouldRetryStatus(response.status) || attempt >= maxRetries) break
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)))
    }

    if (!response) {
      throw new Error('模型请求失败：未收到响应')
    }

    const data = (await response.json().catch(() => ({}))) as OpenAIResponse

    if (!response.ok) {
      const message = data.error?.message ?? `模型请求失败：HTTP ${response.status}`
      throw new Error(message)
    }

    const message = data.choices?.[0]?.message
    const content = (message?.content ?? '').trim()
    const rawCalls = message?.tool_calls ?? []

    const calls: ToolCall[] = rawCalls
      .filter((call) => typeof call.function?.name === 'string')
      .map((call, index) => ({
        id: call.id ?? `call-${Date.now()}-${index}`,
        toolName: call.function!.name!,
        input: safeParseJson(call.function?.arguments ?? ''),
      }))

    if (calls.length > 0) {
      return { type: 'tool_calls', calls, content: content || undefined }
    }

    return { type: 'assistant', content }
  }
}
