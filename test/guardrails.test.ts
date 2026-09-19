import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DispatchOrderGuardrail } from '../src/guardrails.js'

const baseInput = {
  defect_level: 'general',
  equipment_id: '220kV-隔离开关触头',
  solution: '打磨除氧化并涂覆 SGIET-100',
  requires_outage: false,
}

test('非工单工具直接放行', () => {
  const guardrail = new DispatchOrderGuardrail()
  const decision = guardrail.evaluate('get_defect_criteria', {})
  assert.equal(decision.allowed, true)
})

test('一般缺陷且无需停电 → 放行', () => {
  const decision = new DispatchOrderGuardrail().evaluate('generate_dispatch_order', baseInput)
  assert.equal(decision.allowed, true)
})

test('危急缺陷 → 拦截并输出 Diff', () => {
  const decision = new DispatchOrderGuardrail().evaluate('generate_dispatch_order', {
    ...baseInput,
    defect_level: 'critical',
  })
  assert.equal(decision.allowed, false)
  if (!decision.allowed) {
    assert.equal(decision.riskLevel, 'critical')
    assert.match(decision.reason, /危急缺陷/)
    assert.match(decision.diff, /^--- \/dev\/null/)
    assert.match(decision.diff, /\+/)
    assert.match(decision.proposedOrder.order_no, /^WO-/)
  }
})

test('申请停电（即使非危急）→ 拦截', () => {
  const decision = new DispatchOrderGuardrail().evaluate('generate_dispatch_order', {
    ...baseInput,
    requires_outage: true,
  })
  assert.equal(decision.allowed, false)
  if (!decision.allowed) {
    assert.equal(decision.riskLevel, 'high')
    assert.match(decision.reason, /申请停电/)
  }
})
