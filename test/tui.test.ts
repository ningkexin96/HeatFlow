import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TuiApp } from '../src/tui/app.js'
import { stripAnsi } from '../src/tui/ansi.js'
import { parseKeys, type Key, type KeyHandler, type Terminal } from '../src/tui/terminal.js'
import { stringWidth, truncateToWidth, wrapToWidth } from '../src/tui/width.js'
import { TEST_CASE_2 } from '../src/cases.js'

class FakeTerminal implements Terminal {
  written = ''
  cols = 100
  rows = 24
  private keyHandler: KeyHandler | null = null
  private resizeHandler: (() => void) | null = null

  size(): { columns: number; rows: number } {
    return { columns: this.cols, rows: this.rows }
  }
  write(data: string): void {
    this.written += data
  }
  onKey(handler: KeyHandler): void {
    this.keyHandler = handler
  }
  onResize(handler: () => void): void {
    this.resizeHandler = handler
  }
  enter(): void {}
  exit(): void {}
  isTTY(): boolean {
    return true
  }

  async send(data: string): Promise<void> {
    for (const key of parseKeys(data)) {
      await this.keyHandler?.(key)
    }
  }

  screen(): string {
    return stripAnsi(this.written)
  }

  fireResize(): void {
    this.resizeHandler?.()
  }
}

async function withTempCwd(fn: (cwd: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'heatflow-tui-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---- 宽度与按键解析 ----

test('中文字符按 2 列计算宽度', () => {
  assert.equal(stringWidth('abc'), 3)
  assert.equal(stringWidth('中文'), 4)
  assert.equal(stringWidth('中a'), 3)
})

test('按列宽截断与换行', () => {
  assert.equal(truncateToWidth('中文abc', 4), '中文')
  assert.deepEqual(wrapToWidth('abcdef', 4), ['abcd', 'ef'])
  assert.deepEqual(wrapToWidth('中文中文', 4), ['中文', '中文'])
})

test('解析转义序列与普通按键', () => {
  assert.equal(parseKeys('\x1b[A')[0].name, 'up')
  assert.equal(parseKeys('\x1b[B')[0].name, 'down')
  assert.equal(parseKeys('\x1b[5~')[0].name, 'pageup')
  assert.equal(parseKeys('\r')[0].name, 'enter')
  assert.equal(parseKeys('\x7f')[0].name, 'backspace')
  const key: Key = parseKeys('中')[0]
  assert.equal(key.name, 'char')
  assert.equal(key.char, '中')
})

// ---- TUI 交互 ----

test('TUI：输入巡检文本回车后完成研判并输出报告', async () => {
  await withTempCwd(async (cwd) => {
    const term = new FakeTerminal()
    const app = new TuiApp({ terminal: term, mock: true, cwd })
    const started = app.start()

    await term.send('巡检反馈：220kV 某变电站 1 号主变 A 相隔离开关触头，环境温度 25℃，表面温度 58℃（温升 33℃）。\r')
    await app.whenIdle()

    const screen = term.screen()
    assert.match(screen, /一般缺陷/)
    assert.match(screen, /工具调用: get_defect_criteria/)

    await term.send('\x03')
    await started
  })
})

test('TUI：:help 显示命令列表', async () => {
  await withTempCwd(async (cwd) => {
    const term = new FakeTerminal()
    const app = new TuiApp({ terminal: term, mock: true, cwd })
    const started = app.start()

    await term.send(':help\r')
    assert.match(term.screen(), /命令列表/)

    await term.send('\x03')
    await started
  })
})

test('TUI：:case 2 触发高危工单审批，按 y 后签发', async () => {
  await withTempCwd(async (cwd) => {
    const term = new FakeTerminal()
    const app = new TuiApp({ terminal: term, mock: true, cwd, approvalMode: 'interactive' })
    const started = app.start()

    await term.send(`${TEST_CASE_2}\r`)
    await app.waitForApproval()
    assert.equal(app.isAwaitingApproval(), true)
    assert.match(term.screen(), /高危工单待审批/)

    await term.send('y')
    await app.whenIdle()

    const screen = term.screen()
    assert.match(screen, /已批准/)
    assert.match(screen, /危急缺陷/)

    await term.send('\x03')
    await started
  })
})

test('TUI：:case 2 审批按 n 时工单被拒绝', async () => {
  await withTempCwd(async (cwd) => {
    const term = new FakeTerminal()
    const app = new TuiApp({ terminal: term, mock: true, cwd, approvalMode: 'interactive' })
    const started = app.start()

    await term.send(`${TEST_CASE_2}\r`)
    await app.waitForApproval()
    await term.send('n')
    await app.whenIdle()

    assert.match(term.screen(), /已拒绝/)

    await term.send('\x03')
    await started
  })
})

test('TUI：输入编辑（退格）与命令切换', async () => {
  await withTempCwd(async (cwd) => {
    const term = new FakeTerminal()
    const app = new TuiApp({ terminal: term, mock: true, cwd })
    const started = app.start()

    await term.send('ab\x7fc\r')
    await app.whenIdle()
    // "ab\x7fc" 退格后为 "ac"，作为文本跑一次研判（离线模型按文本解析，仍能出报告）
    assert.match(term.screen(), /综合研判报告|开始研判/)

    await term.send(':mock\r')
    assert.match(term.screen(), /离线脚本模型/)

    await term.send('\x03')
    await started
  })
})

test('TUI：Ctrl+C 退出使 start() 结束', async () => {
  await withTempCwd(async (cwd) => {
    const term = new FakeTerminal()
    const app = new TuiApp({ terminal: term, mock: true, cwd })
    const started = app.start()
    await term.send('\x03')
    await started
  })
})
