import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolRegistry } from '../src/tools/index.js'

test('未知工具返回错误', async () => {
  const registry = createToolRegistry()
  const result = await registry.execute('no_such_tool', {}, { cwd: process.cwd() })
  assert.equal(result.ok, false)
  assert.match(result.output, /未知工具/)
})

test('参数校验失败返回错误', async () => {
  const registry = createToolRegistry()
  const result = await registry.execute(
    'get_defect_criteria',
    { voltage_level: '220kV', part_type: '隔离开关触头', temp_delta: 'abc', abs_temp: 58 },
    { cwd: process.cwd() },
  )
  assert.equal(result.ok, false)
  assert.match(result.output, /参数校验失败/)
})

test('get_defect_criteria 正常执行', async () => {
  const registry = createToolRegistry()
  const result = await registry.execute(
    'get_defect_criteria',
    { voltage_level: '220kV', part_type: '隔离开关触头', temp_delta: 33, abs_temp: 58 },
    { cwd: process.cwd() },
  )
  assert.equal(result.ok, true)
  const parsed = JSON.parse(result.output)
  assert.equal(parsed.defect_level, 'general')
})

test('工具列表暴露给模型的元数据包含 JSON Schema', () => {
  const registry = createToolRegistry()
  const forModel = registry.listForModel()
  assert.ok(forModel.length >= 4)
  const names = forModel.map((t) => t.name)
  assert.ok(names.includes('get_defect_criteria'))
  assert.ok(names.includes('query_material_spec'))
  assert.ok(names.includes('generate_dispatch_order'))
  assert.ok(names.includes('load_domain_rules'))
  for (const tool of forModel) {
    assert.equal(tool.inputSchema.type, 'object')
  }
})
