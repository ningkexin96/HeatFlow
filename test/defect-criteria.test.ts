import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDefect } from '../src/rules/defect-criteria.js'

test('温升 33℃ / 绝对 58℃ → 一般缺陷', () => {
  const r = classifyDefect(33, 58)
  assert.equal(r.level, 'general')
  assert.equal(r.requires_outage, false)
  assert.match(r.response, /常规检修/)
})

test('温升 55℃ → 严重缺陷', () => {
  const r = classifyDefect(55, 80)
  assert.equal(r.level, 'serious')
  assert.equal(r.requires_outage, false)
  assert.match(r.response, /72 小时/)
})

test('温升 90℃ → 危急缺陷（温升阈值命中）', () => {
  const r = classifyDefect(90, 120)
  assert.equal(r.level, 'critical')
  assert.equal(r.requires_outage, true)
})

test('绝对温度 115℃ → 危急缺陷（绝对温度阈值命中）', () => {
  const r = classifyDefect(60, 115)
  assert.equal(r.level, 'critical')
  assert.match(r.threshold_hit, /110℃/)
})

test('温升 10℃ → 正常（未达缺陷标准）', () => {
  const r = classifyDefect(10, 40)
  assert.equal(r.level, 'normal')
  assert.equal(r.requires_outage, false)
})

test('边界值 40℃ → 严重缺陷，80℃ → 危急缺陷', () => {
  assert.equal(classifyDefect(40, 60).level, 'serious')
  assert.equal(classifyDefect(80, 100).level, 'critical')
})
