/**
 * 终端显示宽度工具。
 *
 * 中文/日文/韩文等为「宽字符」，占 2 列；据此实现按列宽换行、截断与填充，
 * 保证 TUI 在混合中英文内容时对齐正确。
 */

export function charWidth(codePoint: number): number {
  if (codePoint === 0) return 0
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0
  const wide =
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  return wide ? 2 : 1
}

export function stringWidth(text: string): number {
  let width = 0
  for (const ch of text) width += charWidth(ch.codePointAt(0) ?? 0)
  return width
}

export function truncateToWidth(text: string, width: number): string {
  if (width <= 0) return ''
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0) ?? 0)
    if (used + w > width) break
    out += ch
    used += w
  }
  return out
}

export function padToWidth(text: string, width: number): string {
  const w = stringWidth(text)
  if (w >= width) return truncateToWidth(text, width)
  return text + ' '.repeat(width - w)
}

export function wrapToWidth(text: string, width: number): string[] {
  if (width <= 0) return [text]
  const lines: string[] = []
  let current = ''
  let used = 0
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0) ?? 0)
    if (used + w > width) {
      lines.push(current)
      current = ''
      used = 0
    }
    current += ch
    used += w
  }
  lines.push(current)
  return lines
}

/** 把字符串拆分为码点数组（正确处理 surrogate pair）。 */
export function toCodePoints(text: string): string[] {
  return [...text]
}
