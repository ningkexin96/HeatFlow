/**
 * 工具注册中心（ToolRegistry）。
 *
 * 每个工具同时维护两套元数据：
 *  - `inputSchema`：面向模型端的 JSON Schema（OpenAI Function Calling 协议）。
 *  - `schema`：zod 运行时校验器（Agent Loop 执行前的防御性参数校验）。
 *
 * 参考 MiniCode 的 ToolDefinition 设计，保证工具可插拔、可组合、
 * 参数校验失败与执行异常都能被统一捕获并回填到 Agent 上下文。
 */
import { z } from 'zod'
import type { ModelToolDefinition } from './types.js'

export type ToolContext = {
  cwd: string
  signal?: AbortSignal
  /** 高危工具经人工审批通过后，由 Agent Loop 注入的预构建产物（避免二次构造导致不一致）。 */
  approvedPayload?: unknown
}

export type ToolResult = {
  ok: boolean
  output: string
  /** 不可恢复的致命错误（供上层决定是否终止回合）。 */
  fatal?: boolean
  /** 由工具主动请求停止（预留扩展）。 */
  stop?: boolean
}

export type ToolDefinition<TInput = unknown> = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  schema: z.ZodType<TInput>
  run(input: TInput, context: ToolContext): Promise<ToolResult>
}

export class ToolRegistry {
  private readonly toolsStore: ToolDefinition[]

  constructor(tools: ToolDefinition[] = []) {
    this.toolsStore = [...tools]
  }

  list(): ToolDefinition[] {
    return this.toolsStore
  }

  listForModel(): ModelToolDefinition[] {
    return this.toolsStore.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))
  }

  find(name: string): ToolDefinition | undefined {
    return this.toolsStore.find((tool) => tool.name === name)
  }

  add(...tools: ToolDefinition[]): void {
    const existing = new Set(this.toolsStore.map((tool) => tool.name))
    for (const tool of tools) {
      if (existing.has(tool.name)) continue
      this.toolsStore.push(tool)
      existing.add(tool.name)
    }
  }

  async execute(toolName: string, input: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.find(toolName)
    if (!tool) {
      return { ok: false, output: `未知工具: ${toolName}` }
    }

    const parsed = tool.schema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        output: `参数校验失败: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      }
    }

    try {
      return await tool.run(parsed.data, context)
    } catch (error) {
      return {
        ok: false,
        output: `工具执行异常: ${error instanceof Error ? error.message : String(error)}`,
        fatal: true,
      }
    }
  }
}
