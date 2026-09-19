import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVoltageKv, recommendMaterial } from '../src/rules/material-spec.js'

test('常规室内铜接头 → SGIET-100', () => {
  const r = recommendMaterial({ environment: '室内', temp_max: 58, material_pairing: '铜质' })
  assert.match(r.primary_material, /SGIET-100/)
  assert.equal(r.must_not_use.length, 0)
})

test('沿海铜铝过渡 → SGIET-300 且严禁普通导电膏', () => {
  const r = recommendMaterial({ environment: '沿海重盐雾', temp_max: 70, material_pairing: '铜铝过渡' })
  assert.match(r.primary_material, /SGIET-300/)
  assert.ok(r.must_not_use.some((m) => /普通导电膏/.test(m)))
})

test('特高压高温 → SGIET-200', () => {
  const r = recommendMaterial({
    environment: '户外',
    temp_max: 95,
    material_pairing: '铜质',
    voltage_level: '±800kV',
  })
  assert.match(r.primary_material, /SGIET-200/)
})

test('沿海+特高压+铜铝过渡 → SGIET-300 为主 + SGIET-200 叠加', () => {
  const r = recommendMaterial({
    environment: '沿海重盐雾',
    temp_max: 136,
    material_pairing: '铜铝过渡',
    voltage_level: '±800kV',
  })
  assert.match(r.primary_material, /SGIET-300/)
  assert.ok(r.supplementary_materials.some((m) => /SGIET-200/.test(m)))
  assert.ok(r.notes.some((n) => /电偶腐蚀与高温无流淌/.test(n)))
})

test('电压等级解析', () => {
  assert.equal(parseVoltageKv('220kV'), 220)
  assert.equal(parseVoltageKv('±800kV'), 800)
})
