import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { runAgentTurn } from '../src/agent-loop.js'
import { runDiagnosis } from '../src/app.js'
import { TEST_CASE_1, TEST_CASE_2 } from '../src/cases.js'
import { TraceLogger } from '../src/observability.js'
import { createToolRegistry } from '../src/tools/index.js'
import type { ChatMessage, ModelAdapter } from '../src/types.js'
import type { ToolDefinition } from '../src/tool.js'

type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>
type ToolResultMessage = Extract<ChatMessage, { role: 'tool_result' }>

function lastAssistant(messages: ChatMessage[]): AssistantMessage | undefined {
  return messages.filter((m): m is AssistantMessage => m.role === 'assistant').at(-1)
}

function findToolResult(messages: ChatMessage[], toolName: string): ToolResultMessage | undefined {
  return messages.find(
    (m): m is ToolResultMessage => m.role === 'tool_result' && m.toolName === toolName,
  )
}

async function withTempCwd(fn: (cwd: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'defect-agent-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const silent = () => new TraceLogger({ echo: false })

test('用例1：一般缺陷 → 多轮工具闭环并签发普通工单', async () => {
  await withTempCwd(async (cwd) => {
    const { result } = await runDiagnosis({
      text: TEST_CASE_1,
      mock: true,
      cwd,
      approvalMode: 'auto',
      trace: silent(),
    })

    assert.equal(result.outcome, 'final')
    assert.ok(result.toolCalls >= 4, `期望至少 4 次工具调用，实际 ${result.toolCalls}`)

    const finalMessage = lastAssistant(result.messages)
    assert.match(finalMessage?.content ?? '', /一般缺陷/)

    const dispatch = findToolResult(result.messages, 'generate_dispatch_order')
    assert.ok(dispatch)
    assert.match(dispatch.content, /"issued": true/)
    assert.match(dispatch.content, /"requires_outage": false/)

    const orders = await readdir(path.join(cwd, 'orders'))
    assert.equal(orders.length, 1)
  })
})

test('用例2：沿海特高压危急缺陷 → 高危审批拦截后签发停电工单', async () => {
  await withTempCwd(async (cwd) => {
    const { result } = await runDiagnosis({
      text: TEST_CASE_2,
      mock: true,
      cwd,
      approvalMode: 'auto',
      trace: silent(),
    })

    assert.equal(result.outcome, 'final')

    const finalMessage = lastAssistant(result.messages)
    assert.match(finalMessage?.content ?? '', /危急缺陷/)
    assert.match(finalMessage?.content ?? '', /SGIET-300/)
    assert.match(finalMessage?.content ?? '', /SGIET-200/)

    const dispatch = findToolResult(result.messages, 'generate_dispatch_order')
    assert.ok(dispatch)
    assert.match(dispatch.content, /"issued": true/)
    assert.match(dispatch.content, /"approval": "human-approved"/)
    assert.match(dispatch.content, /"requires_outage": true/)

    const orders = await readdir(path.join(cwd, 'orders'))
    assert.equal(orders.length, 1)
  })
})

test('用例2：人工拒绝 → 工单不落盘', async () => {
  await withTempCwd(async (cwd) => {
    const { result } = await runDiagnosis({
      text: TEST_CASE_2,
      mock: true,
      cwd,
      approvalMode: 'reject',
      trace: silent(),
    })

    assert.equal(result.outcome, 'final')

    const dispatch = findToolResult(result.messages, 'generate_dispatch_order')
    assert.ok(dispatch)
    assert.match(dispatch.content, /"rejected": true/)

    const orders = await readdir(path.join(cwd, 'orders')).catch(() => [])
    assert.equal(orders.length, 0)
  })
})

test('最大步数保护：无限工具调用模型被终止', async () => {
  const model: ModelAdapter = {
    async next() {
      return {
        type: 'tool_calls',
        calls: [
          {
            id: 'loop-1',
            toolName: 'get_defect_criteria',
            input: { voltage_level: '220kV', part_type: '隔离开关触头', temp_delta: 33, abs_temp: 58 },
          },
        ],
      }
    },
  }

  const result = await runAgentTurn({
    model,
    tools: createToolRegistry(),
    messages: [{ role: 'user', content: '测试' }],
    cwd: process.cwd(),
    maxSteps: 2,
    trace: silent(),
  })

  assert.equal(result.outcome, 'max_steps')
  assert.equal(result.toolCalls, 2)
})

test('空响应自愈重试：前两次空响应后给出最终答案', async () => {
  let calls = 0
  const model: ModelAdapter = {
    async next() {
      calls += 1
      if (calls <= 2) return { type: 'assistant', content: '' }
      return { type: 'assistant', content: '最终报告' }
    },
  }

  const result = await runAgentTurn({
    model,
    tools: createToolRegistry(),
    messages: [{ role: 'user', content: '测试' }],
    cwd: process.cwd(),
    trace: silent(),
  })

  assert.equal(result.outcome, 'final')
  assert.equal(calls, 3)
  assert.equal(lastAssistant(result.messages)?.content, '最终报告')
})

test('工具执行异常捕获并回填错误信息', async () => {
  const brokenTool: ToolDefinition = {
    name: 'boom',
    description: '会抛异常的工具',
    inputSchema: { type: 'object', properties: {}, required: [] },
    schema: z.object({}),
    async run() {
      throw new Error('boom')
    },
  }

  const model: ModelAdapter = {
    async next(messages) {
      const hasResult = messages.some((m) => m.role === 'tool_result')
      if (!hasResult) {
        return { type: 'tool_calls', calls: [{ id: 'b1', toolName: 'boom', input: {} }] }
      }
      return { type: 'assistant', content: 'done' }
    },
  }

  const registry = createToolRegistry()
  registry.add(brokenTool)

  const result = await runAgentTurn({
    model,
    tools: registry,
    messages: [{ role: 'user', content: '测试' }],
    cwd: process.cwd(),
    trace: silent(),
  })

  assert.equal(result.outcome, 'final')
  const toolResult = findToolResult(result.messages, 'boom')
  assert.ok(toolResult)
  assert.equal(toolResult.isError, true)
  assert.match(toolResult.content, /boom/)
})
