/**
 * 终端抽象层：把「按键/尺寸/输出」与具体实现解耦。
 *
 * - ProcessTerminal：真实终端（raw 模式 + 备用屏幕缓冲区）。
 * - 测试可用假 Terminal 注入，从而在无 TTY 环境下断言渲染结果与交互。
 */
import {
  altScreenEnter,
  altScreenExit,
  clearScreen,
  cursorHome,
  cursorShow,
} from './ansi.js'

export type KeyName =
  | 'char'
  | 'enter'
  | 'backspace'
  | 'escape'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'pageup'
  | 'pagedown'
  | 'home'
  | 'end'
  | 'ctrl-c'
  | 'ctrl-d'
  | 'ctrl-u'
  | 'ctrl-l'
  | 'unknown'

export type Key = {
  name: KeyName
  /** 仅 name === 'char' 时存在，为单个码点。 */
  char?: string
  raw: string
}

export type KeyHandler = (key: Key) => void | Promise<void>

export interface Terminal {
  size(): { columns: number; rows: number }
  write(data: string): void
  onKey(handler: KeyHandler): void
  onResize(handler: () => void): void
  enter(): void
  exit(): void
  isTTY(): boolean
}

function mapCsi(params: string, final: string, raw: string): Key {
  switch (final) {
    case 'A':
      return { name: 'up', raw }
    case 'B':
      return { name: 'down', raw }
    case 'C':
      return { name: 'right', raw }
    case 'D':
      return { name: 'left', raw }
    case 'H':
      return { name: 'home', raw }
    case 'F':
      return { name: 'end', raw }
    case '~':
      if (params === '5') return { name: 'pageup', raw }
      if (params === '6') return { name: 'pagedown', raw }
      if (params === '1' || params === '7') return { name: 'home', raw }
      if (params === '4' || params === '8') return { name: 'end', raw }
      return { name: 'unknown', raw }
    default:
      return { name: 'unknown', raw }
  }
}

/** 解析一段输入数据为按键序列（支持 CSI / SS3 转义序列与多字节字符）。 */
export function parseKeys(data: string): Key[] {
  const keys: Key[] = []
  let i = 0
  while (i < data.length) {
    const ch = data[i]

    if (ch === '\x1b') {
      const rest = data.slice(i)
      const csi = /^\x1b\[([0-9;]*)([A-Za-z~])/.exec(rest)
      if (csi) {
        keys.push(mapCsi(csi[1], csi[2], csi[0]))
        i += csi[0].length
        continue
      }
      const ss3 = /^\x1bO([A-Za-z])/.exec(rest)
      if (ss3) {
        keys.push(mapCsi('', ss3[1], ss3[0]))
        i += ss3[0].length
        continue
      }
      keys.push({ name: 'escape', raw: '\x1b' })
      i += 1
      continue
    }

    const code = data.codePointAt(i) ?? 0
    const cp = String.fromCodePoint(code)
    i += cp.length

    if (cp === '\r' || cp === '\n') {
      keys.push({ name: 'enter', raw: cp })
    } else if (cp === '\x7f' || cp === '\b') {
      keys.push({ name: 'backspace', raw: cp })
    } else if (cp === '\x03') {
      keys.push({ name: 'ctrl-c', raw: cp })
    } else if (cp === '\x04') {
      keys.push({ name: 'ctrl-d', raw: cp })
    } else if (cp === '\x15') {
      keys.push({ name: 'ctrl-u', raw: cp })
    } else if (cp === '\x0c') {
      keys.push({ name: 'ctrl-l', raw: cp })
    } else if (code < 32) {
      keys.push({ name: 'unknown', raw: cp })
    } else {
      keys.push({ name: 'char', char: cp, raw: cp })
    }
  }
  return keys
}

export class ProcessTerminal implements Terminal {
  private keyHandler: KeyHandler | null = null
  private resizeHandler: (() => void) | null = null

  constructor(
    private readonly stdin: NodeJS.ReadStream = process.stdin,
    private readonly stdout: NodeJS.WriteStream = process.stdout,
  ) {}

  size(): { columns: number; rows: number } {
    return {
      columns: this.stdout.columns ?? 80,
      rows: this.stdout.rows ?? 24,
    }
  }

  write(data: string): void {
    this.stdout.write(data)
  }

  onKey(handler: KeyHandler): void {
    this.keyHandler = handler
  }

  onResize(handler: () => void): void {
    this.resizeHandler = handler
  }

  isTTY(): boolean {
    return Boolean(this.stdin.isTTY && this.stdout.isTTY)
  }

  enter(): void {
    this.stdin.setRawMode?.(true)
    this.stdin.resume()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', this.handleData)
    this.stdout.on('resize', this.handleResize)
    this.write(altScreenEnter + clearScreen + cursorHome)
  }

  exit(): void {
    this.stdout.off('resize', this.handleResize)
    this.stdin.off('data', this.handleData)
    this.stdin.setRawMode?.(false)
    this.stdin.pause()
    this.write(cursorShow + altScreenExit)
  }

  private readonly handleData = (data: string | Buffer): void => {
    const text = typeof data === 'string' ? data : data.toString('utf8')
    for (const key of parseKeys(text)) {
      void this.keyHandler?.(key)
    }
  }

  private readonly handleResize = (): void => {
    this.resizeHandler?.()
  }
}
