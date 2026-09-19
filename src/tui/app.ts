/**
 * HeatFlow TUI：全屏面板式交互界面（手写 ANSI 渲染循环）。
 *
 * 布局（自上而下）：
 *   第 1 行      标题栏（模型 / 审批模式 / 状态 / 滚动指示）
 *   中间区域    执行链路滚动区（Step / 思考 / 工具入参返回 / 报告）
 *   倒数第 2 行 输入框
 *   最后 1 行   快捷键提示
 *
 * 交互：输入巡检文本回车即研判；`:help` 查看命令；高危工单时按 y/n 审批；
 *       ↑↓/PgUp/PgDn 滚动历史；Ctrl+C 退出。
 */
import { runDiagnosis } from '../app.js'
import { TEST_CASES } from '../cases.js'
import { hasRealModelConfig } from '../config.js'
import type { ApprovalRequest } from '../guardrails.js'
import { TraceLogger } from '../observability.js'
import type { Key, Terminal } from './terminal.js'
import {
  cursorHide,
  cursorHome,
  cursorShow,
  cursorTo,
  eraseToEol,
  stripAnsi,
  style,
  syncEnd,
  syncStart,
} from './ansi.js'
import { padToWidth, stringWidth, truncateToWidth, wrapToWidth } from './width.js'

export type TuiApprovalMode = 'interactive' | 'auto' | 'reject'

export type TuiOptions = {
  terminal: Terminal
  cwd?: string
  mock?: boolean
  maxSteps?: number
  approvalMode?: TuiApprovalMode
}

const HEADER_ROWS = 1
const FOOTER_ROWS = 2
const PROMPT = '> '

export class TuiApp {
  private transcript: string[] = []
  private inputChars: string[] = []
  private cursor = 0
  private scroll = 0
  private status = '就绪'
  private running = false
  private mock: boolean
  private approvalMode: TuiApprovalMode
  private pendingApproval: { request: ApprovalRequest; resolve: (a: { approved: boolean; note?: string }) => void } | null =
    null
  private approvalWaiters: Array<() => void> = []
  private currentRun: Promise<void> | null = null
  private history: string[] = []
  private historyIndex = 0
  private resolveExit: (() => void) | null = null

  private wrapped: string[] = []
  private wrappedWidth = 0
  private wrappedCount = -1

  private readonly term: Terminal
  private readonly cwd: string
  private readonly maxSteps: number

  constructor(options: TuiOptions) {
    this.term = options.terminal
    this.cwd = options.cwd ?? process.cwd()
    this.mock = options.mock ?? false
    this.maxSteps = options.maxSteps ?? 8
    this.approvalMode = options.approvalMode ?? 'interactive'
  }

  async start(): Promise<void> {
    this.term.enter()
    this.term.onKey((key) => this.handleKey(key))
    this.term.onResize(() => {
      this.wrappedCount = -1
      this.render()
    })
    this.pushWelcome()
    this.render()
    await new Promise<void>((resolve) => {
      this.resolveExit = resolve
    })
    this.term.exit()
  }

  // ---- 供测试与外部观察 ----

  whenIdle(): Promise<void> {
    return this.currentRun ?? Promise.resolve()
  }

  waitForApproval(): Promise<void> {
    if (this.pendingApproval) return Promise.resolve()
    return new Promise((resolve) => this.approvalWaiters.push(resolve))
  }

  isAwaitingApproval(): boolean {
    return this.pendingApproval !== null
  }

  getTranscript(): string {
    return this.transcript.join('\n')
  }

  // ---- 交互 ----

  private async handleKey(key: Key): Promise<void> {
    if (this.pendingApproval) {
      if (key.name === 'char' && /^[yY]$/.test(key.char ?? '')) return this.resolveApproval(true)
      if (key.name === 'char' && /^[nN]$/.test(key.char ?? '')) return this.resolveApproval(false)
      if (key.name === 'ctrl-c' || key.name === 'ctrl-d') return this.quit()
      return
    }

    switch (key.name) {
      case 'ctrl-c':
      case 'ctrl-d':
        return this.quit()
      case 'enter':
        this.submit()
        return
      case 'backspace':
        if (this.cursor > 0) {
          this.inputChars.splice(this.cursor - 1, 1)
          this.cursor -= 1
        }
        this.render()
        return
      case 'left':
        if (this.cursor > 0) this.cursor -= 1
        this.render()
        return
      case 'right':
        if (this.cursor < this.inputChars.length) this.cursor += 1
        this.render()
        return
      case 'home':
        this.cursor = 0
        this.render()
        return
      case 'end':
        this.cursor = this.inputChars.length
        this.render()
        return
      case 'ctrl-u':
        this.inputChars = []
        this.cursor = 0
        this.render()
        return
      case 'up':
        this.scrollBy(1)
        return
      case 'down':
        this.scrollBy(-1)
        return
      case 'pageup':
        this.scrollBy(this.bodyHeight())
        return
      case 'pagedown':
        this.scrollBy(-this.bodyHeight())
        return
      case 'char':
        if (!this.running && key.char) {
          this.inputChars.splice(this.cursor, 0, key.char)
          this.cursor += 1
          this.render()
        }
        return
      default:
        return
    }
  }

  private submit(): void {
    if (this.running) return
    const line = this.inputChars.join('')
    this.inputChars = []
    this.cursor = 0
    if (!line.trim()) {
      this.render()
      return
    }
    this.history.push(line)
    this.historyIndex = this.history.length

    if (line.startsWith(':')) {
      this.runCommand(line.slice(1).trim())
      this.render()
      return
    }
    this.currentRun = this.runCase(line)
  }

  private runCommand(cmd: string): void {
    const [name, ...rest] = cmd.split(/\s+/)
    const arg = rest.join(' ')

    switch (name) {
      case 'help':
      case 'h':
        this.pushLines([
          '',
          style.bold('命令列表：'),
          '  :case 1 | :case 2      运行内置测试用例',
          '  :mock                  切换为离线脚本模型',
          '  :real                  切换为真实大模型（需配置 OPENAI_API_KEY）',
          '  :approve interactive   高危工单等待 y/n 人工确认（默认）',
          '  :approve auto          高危工单自动放行',
          '  :approve reject        高危工单自动拒绝',
          '  :clear                 清空链路区',
          '  :quit                  退出',
          '  （直接输入巡检反馈文本并回车即开始研判）',
          '',
        ])
        return
      case 'case': {
        const n = Number(arg)
        if (n >= 1 && n <= TEST_CASES.length) {
          this.currentRun = this.runCase(TEST_CASES[n - 1])
        } else {
          this.pushLines([`未知用例: ${arg}（可选 1 / 2）`])
        }
        return
      }
      case 'mock':
        this.mock = true
        this.pushLines(['已切换为「离线脚本模型」。'])
        return
      case 'real':
        this.mock = false
        this.pushLines([
          hasRealModelConfig()
            ? '已切换为「真实大模型」。'
            : '已切换为「真实大模型」，但未检测到 OPENAI_API_KEY，运行时仍会自动降级为离线脚本模型。',
        ])
        return
      case 'approve':
        if (arg === 'interactive' || arg === 'auto' || arg === 'reject') {
          this.approvalMode = arg
          this.pushLines([`审批模式已设为「${arg}」。`])
        } else {
          this.pushLines(['用法: :approve interactive | auto | reject'])
        }
        return
      case 'clear':
        this.transcript = []
        this.wrappedCount = -1
        this.scroll = 0
        return
      case 'quit':
      case 'q':
        this.quit()
        return
      default:
        this.pushLines([`未知命令: ${name}（输入 :help 查看命令）`])
        return
    }
  }

  private async runCase(text: string): Promise<void> {
    this.running = true
    this.status = '推理中...'
    this.scroll = 0
    this.pushLines(['', style.cyan(`──── 开始研判：${truncateToWidth(text, 40)} ────`)])
    this.render()

    const sink = new TraceLogger({
      echo: true,
      out: (line) => {
        this.pushLines(line.split('\n'))
        this.render()
      },
    })

    try {
      await runDiagnosis({
        text,
        cwd: this.cwd,
        mock: this.mock,
        maxSteps: this.maxSteps,
        approvalMode: this.approvalMode,
        trace: sink,
        approve: (request) => this.requestApproval(request),
      })
    } catch (error) {
      this.pushLines([style.red(`[错误] ${error instanceof Error ? error.message : String(error)}`)])
    } finally {
      this.running = false
      this.status = '就绪'
      this.render()
    }
  }

  private requestApproval(request: ApprovalRequest): Promise<{ approved: boolean; note?: string }> {
    return new Promise((resolve) => {
      this.pendingApproval = { request, resolve }
      this.status = '等待高危工单审批'
      this.render()
      const waiters = this.approvalWaiters
      this.approvalWaiters = []
      for (const w of waiters) w()
    })
  }

  private resolveApproval(approved: boolean): void {
    const pending = this.pendingApproval
    this.pendingApproval = null
    this.status = this.running ? '推理中...' : '就绪'
    this.pushLines([
      approved ? style.green('  ✔ 已批准（TUI 人工确认）') : style.red('  ✖ 已拒绝（TUI 人工确认）'),
    ])
    this.render()
    pending?.resolve({ approved, note: approved ? 'TUI 人工确认通过' : 'TUI 人工拒绝' })
  }

  private quit(): void {
    const resolve = this.resolveExit
    this.resolveExit = null
    resolve?.()
  }

  // ---- 渲染 ----

  private bodyHeight(): number {
    const { rows } = this.term.size()
    return Math.max(1, rows - HEADER_ROWS - FOOTER_ROWS)
  }

  private scrollBy(delta: number): void {
    const maxScroll = Math.max(0, this.wrappedLines(this.term.size().columns - 0).length - this.bodyHeight())
    this.scroll = Math.min(maxScroll, Math.max(0, this.scroll + delta))
    this.render()
  }

  private pushLines(lines: string[]): void {
    this.transcript.push(...lines)
    if (this.running) this.scroll = 0
  }

  private wrappedLines(width: number): string[] {
    const safeWidth = Math.max(8, width)
    if (width === this.wrappedWidth && this.transcript.length === this.wrappedCount) {
      return this.wrapped
    }
    const out: string[] = []
    for (const line of this.transcript) {
      const plain = stripAnsi(line)
      if (plain === '') {
        out.push('')
        continue
      }
      for (const segment of wrapToWidth(line, safeWidth)) out.push(segment)
    }
    this.wrapped = out
    this.wrappedWidth = width
    this.wrappedCount = this.transcript.length
    return out
  }

  render(): void {
    const { columns, rows } = this.term.size()
    const width = Math.max(20, columns)
    const bodyH = Math.max(1, rows - HEADER_ROWS - FOOTER_ROWS)

    const rowsOut: string[] = []
    rowsOut.push(this.renderHeader(width))

    const wrapped = this.wrappedLines(width)
    const maxScroll = Math.max(0, wrapped.length - bodyH)
    this.scroll = Math.min(maxScroll, Math.max(0, this.scroll))
    const end = wrapped.length - this.scroll
    const start = Math.max(0, end - bodyH)
    const visible = wrapped.slice(start, end)
    for (let i = 0; i < bodyH; i++) rowsOut.push(visible[i] ?? '')

    rowsOut.push(this.renderInput(width))
    rowsOut.push(this.renderStatus(width))

    let frame = syncStart + cursorHome
    frame += rowsOut.map((line) => line + eraseToEol).join('\r\n')
    const inputRow = HEADER_ROWS + bodyH + 1
    const cursorCol = this.inputCursorColumn(width)
    frame += cursorTo(inputRow, cursorCol)
    frame += this.running || this.pendingApproval ? cursorHide : cursorShow
    frame += syncEnd

    this.term.write(frame)
  }

  private renderHeader(width: number): string {
    const modelLabel = this.mock || !hasRealModelConfig() ? '离线脚本模型' : '真实大模型'
    const scrollHint = this.scroll > 0 ? ` │ ↑${this.scroll}` : ''
    const text =
      ` HeatFlow · 缺陷诊断与工单分流 Agent` +
      ` │ 模型:${modelLabel} │ 审批:${this.approvalMode} │ 状态:${this.status}${scrollHint}`
    return style.bar(padToWidth(truncateToWidth(text, width), width))
  }

  private renderInput(width: number): string {
    if (this.pendingApproval) {
      const prompt = `⚠ 高危工单待审批：按 y 批准 / n 拒绝 —— ${this.pendingApproval.request.reason}`
      return style.yellow(padToWidth(truncateToWidth(prompt, width), width))
    }
    const avail = Math.max(1, width - PROMPT.length)
    const text = this.inputChars.join('')
    const shown = stringWidth(text) <= avail ? text : truncateToWidth(text, avail)
    return style.cyan(PROMPT) + padToWidth(shown, avail)
  }

  private inputCursorColumn(width: number): number {
    if (this.pendingApproval) return 1
    const avail = Math.max(1, width - PROMPT.length)
    const beforeCursor = stringWidth(this.inputChars.slice(0, this.cursor).join(''))
    return PROMPT.length + Math.min(beforeCursor, avail) + 1
  }

  private renderStatus(width: number): string {
    const hint = this.running
      ? '推理中… 请稍候（↑↓ 可滚动历史）'
      : ':help 命令 │ :case 1|2 用例 │ :mock/:real 切模型 │ :approve 审批 │ 输入文本回车研判 │ Ctrl+C 退出'
    return style.dim(padToWidth(truncateToWidth(hint, width), width))
  }

  private pushWelcome(): void {
    const model = this.mock || !hasRealModelConfig() ? '离线脚本模型' : '真实大模型'
    this.pushLines([
      style.bold('HeatFlow TUI —— 电气设备发热缺陷智能诊断与工单分流 Agent'),
      `当前模型：${model}　审批模式：${this.approvalMode}`,
      '输入巡检反馈文本并回车即开始研判；输入 :help 查看命令，:case 1 / :case 2 运行内置用例。',
      '',
    ])
  }
}
