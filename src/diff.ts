/**
 * 极简行级统一 Diff（LCS 实现），用于高危工单「新增文件」对比展示。
 *
 * 不依赖第三方 diff 库，保证核心引擎零运行时依赖、可独立测试。
 */

type DiffOp = { type: 'equal' | 'del' | 'add'; text: string }

const CONTEXT = 3

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

function computeOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i] })
      i++
    } else {
      ops.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: a[i] })
    i++
  }
  while (j < m) {
    ops.push({ type: 'add', text: b[j] })
    j++
  }
  return ops
}

function buildHunks(ops: DiffOp[]): string[] {
  const lines: string[] = []
  let start: number | null = null
  let lastChange = -1

  const flush = (end: number) => {
    if (start === null) return
    const window = ops.slice(start, end + 1)
    const aStart = ops.slice(0, start).filter((o) => o.type !== 'add').length
    const aCount = window.filter((o) => o.type !== 'add').length
    const bStart = ops.slice(0, start).filter((o) => o.type !== 'del').length
    const bCount = window.filter((o) => o.type !== 'del').length
    lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`)
    for (const op of window) {
      const prefix = op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '
      lines.push(`${prefix}${op.text}`)
    }
    start = null
  }

  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== 'equal') {
      if (start === null) {
        start = Math.max(0, i - CONTEXT)
      }
      lastChange = i
      continue
    }
    if (start !== null && i - lastChange > CONTEXT * 2) {
      flush(Math.min(ops.length - 1, lastChange + CONTEXT))
    }
  }
  flush(ops.length - 1)
  return lines
}

export function unifiedDiff(
  before: string,
  after: string,
  options: { from?: string; to?: string } = {},
): string {
  const from = options.from ?? 'a/before'
  const to = options.to ?? 'b/after'
  const a = splitLines(before)
  const b = splitLines(after)

  // 空文件（/dev/null）语义：全部为新增。
  const aIsEmpty = a.length === 0 || (a.length === 1 && a[0] === '')
  const bIsEmpty = b.length === 0 || (b.length === 1 && b[0] === '')

  const ops = computeOps(aIsEmpty ? [] : a, bIsEmpty ? [] : b)
  if (ops.length === 0 || ops.every((op) => op.type === 'equal')) {
    return ''
  }

  const hunks = buildHunks(ops)
  return [`--- ${from}`, `+++ ${to}`, ...hunks].join('\n')
}
