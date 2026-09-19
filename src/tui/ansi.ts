/** ANSI 转义序列与样式助手（TUI 渲染底层）。 */

export const ESC = '\x1b'

export const altScreenEnter = `${ESC}[?1049h`
export const altScreenExit = `${ESC}[?1049l`
export const cursorHide = `${ESC}[?25l`
export const cursorShow = `${ESC}[?25h`
export const clearScreen = `${ESC}[2J`
export const cursorHome = `${ESC}[H`
export const eraseToEol = `${ESC}[K`
/** DEC 私有模式 2026：同步输出，减少重绘闪烁（不支持时无副作用）。 */
export const syncStart = `${ESC}[?2026h`
export const syncEnd = `${ESC}[?2026l`

export function cursorTo(row: number, col: number): string {
  return `${ESC}[${row};${col}H`
}

export const RESET = `${ESC}[0m`

export function sgr(...codes: number[]): string {
  return `${ESC}[${codes.join(';')}m`
}

export const style = {
  bold: (s: string) => `${sgr(1)}${s}${RESET}`,
  dim: (s: string) => `${sgr(2)}${s}${RESET}`,
  cyan: (s: string) => `${sgr(36)}${s}${RESET}`,
  green: (s: string) => `${sgr(32)}${s}${RESET}`,
  yellow: (s: string) => `${sgr(33)}${s}${RESET}`,
  red: (s: string) => `${sgr(31)}${s}${RESET}`,
  magenta: (s: string) => `${sgr(35)}${s}${RESET}`,
  inverse: (s: string) => `${sgr(7)}${s}${RESET}`,
  bar: (s: string) => `${sgr(44, 97)}${s}${RESET}`,
}

/** 去掉 ANSI 转义序列（用于测试断言与宽度计算）。 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
}
