import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unifiedDiff } from '../src/diff.js'

test('空文件 → 全新文件 Diff（全部新增）', () => {
  const diff = unifiedDiff('', 'a\nb\nc', { from: '/dev/null', to: 'orders/WO-1.json' })
  assert.match(diff, /^--- \/dev\/null/)
  assert.match(diff, /^\+\+\+ orders\/WO-1\.json/m)
  assert.match(diff, /^\+a$/m)
  assert.match(diff, /^\+c$/m)
})

test('单行修改产生 - 与 +', () => {
  const diff = unifiedDiff('a\nb\nc', 'a\nB\nc', { from: 'a/x', to: 'b/x' })
  assert.match(diff, /^-b$/m)
  assert.match(diff, /^\+B$/m)
})

test('内容相同 → 空 Diff', () => {
  assert.equal(unifiedDiff('a\nb', 'a\nb'), '')
})
