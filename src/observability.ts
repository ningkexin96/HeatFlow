/**
 * 执行状态追踪与可观测性（Observability）。
 *
 * Agent Loop 通过 `onEvent` 回调发出结构化事件，TraceLogger 负责
 * 格式化打印执行链路（Step 编号、思考摘要、工具入参/返回、审批、最终报告），
 * 同时保留一份纯文本 transcript 供测试日志落盘。
 */
import type { ApprovalRequest } from './guardrails.js'

export type TraceEvent =
  | { type: 'system'; content: string }
  | { type: 'user_input'; content: string }
  | { type: 'thought'; step: number; content: string }
  | { type: 'tool_call'; step: number; name: string; input: unknown }
  | { type: 'tool_result'; step: number; name: string; output: string; isError: boolean }
  | { type: 'approval_required'; step: number; request: ApprovalRequest }
  | { type: 'approval_decision'; step: number; approved: boolean; note?: string }
  | { type: 'final'; content: string }
  | { type: 'outcome'; outcome: string; toolCalls: number }
  | { type: 'error'; message: string }

export interface TraceSink {
  onEvent(event: TraceEvent): void
}

const RULE = '─'.repeat(64)

function compactJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function indent(text: string, prefix = '  '): string {
  return text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : line))
    .join('\n')
}

export function formatEvent(event: TraceEvent): string {
  switch (event.type) {
    case 'system':
      return `${RULE}\n[系统提示词]\n${indent(event.content)}\n${RULE}`
    case 'user_input':
      return `${RULE}\n[用户输入]\n${indent(event.content)}\n${RULE}`
    case 'thought':
      return `\n[Step ${event.step}] 模型思考摘要\n${indent(event.content)}`
    case 'tool_call':
      return `  → 工具调用: ${event.name}\n     入参: ${compactJson(event.input)}`
    case 'tool_result':
      return `  ← 工具返回${event.isError ? '（错误）' : ''}: ${event.name}\n${indent(event.output, '     ')}`
    case 'approval_required':
      return (
        `\n  ⚠ 高危操作拦截 [${event.request.riskLevel}]\n` +
        `     拦截原因: ${event.request.reason}\n` +
        `     拟落盘 Diff:\n${indent(event.request.diff, '       ')}`
      )
    case 'approval_decision':
      return `  ✔ 人工审批: ${event.approved ? '已通过（允许落盘）' : '已拒绝（阻止落盘）'}${event.note ? `（${event.note}）` : ''}`
    case 'final':
      return `\n[最终综合研判报告]\n${event.content}\n`
    case 'outcome':
      return `\n[回合结束] outcome=${event.outcome}, 工具调用次数=${event.toolCalls}`
    case 'error':
      return `\n[错误] ${event.message}`
  }
}

export class TraceLogger implements TraceSink {
  private readonly lines: string[] = []
  private readonly out: (line: string) => void

  constructor(options: { out?: (line: string) => void; echo?: boolean } = {}) {
    this.out = options.out ?? ((line) => process.stdout.write(`${line}\n`))
    this.echo = options.echo ?? true
  }

  private echo: boolean

  onEvent(event: TraceEvent): void {
    const text = formatEvent(event)
    this.lines.push(text)
    if (this.echo) this.out(text)
  }

  transcript(): string {
    return this.lines.join('\n')
  }
}

/** 便捷入口：从事件数组生成纯文本链路日志。 */
export function renderTranscript(events: TraceEvent[]): string {
  return events.map(formatEvent).join('\n')
}
