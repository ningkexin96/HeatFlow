/**
 * 确定性「脚本模型」适配器（离线降级 / 自动化测试）。
 *
 * 它模拟真实 LLM 的「思考 → 工具调用 → 观察 → 下一步」推理过程：
 * 从巡检文本中结构化抽取字段，按既定计划依次驱动工具调用，
 * 最后汇总工具返回结果生成中文综合研判报告。
 *
 * 该实现使 Agent Loop、工具闭环、Guardrail 审批等核心机制
 * 在不依赖任何外部 API 的情况下即可完整演示与回归测试。
 */
import type { AgentStep, ChatMessage, ModelAdapter, ModelRequestOptions } from '../types.js'
import { classifyDefect } from '../rules/defect-criteria.js'
import { recommendMaterial } from '../rules/material-spec.js'
import { parseInspection } from '../rules/parse-inspection.js'

type PlanStep = {
  tool: string
  input: Record<string, unknown>
  thought: string
}

function lastOriginalUserMessage(messages: ChatMessage[]): Extract<ChatMessage, { role: 'user' }> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === 'user' && message.internal !== 'continuation') return message
  }
  return undefined
}

function calledToolNames(messages: ChatMessage[]): Set<string> {
  const names = new Set<string>()
  for (const message of messages) {
    if (message.role === 'assistant_tool_call') names.add(message.toolName)
  }
  return names
}

function findToolResult(messages: ChatMessage[], toolName: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === 'tool_result' && message.toolName === toolName) return message.content
  }
  return undefined
}

function safeParse(content: string | undefined): Record<string, any> {
  if (!content) return {}
  try {
    const parsed = JSON.parse(content)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function buildPlan(text: string): PlanStep[] {
  const info = parseInspection(text)
  const defect = classifyDefect(info.temp_delta, info.abs_temp)
  const material = recommendMaterial({
    environment: info.environment_cn,
    temp_max: info.abs_temp,
    material_pairing: info.material_pairing_cn,
    voltage_level: info.voltage_level,
  })

  const supplementary = material.supplementary_materials.length
    ? `，叠加 ${material.supplementary_materials.join('、')}`
    : ''
  const solution = [
    `${defect.response}。`,
    `物料：${material.primary_material}${supplementary}。`,
    `工艺：${material.process_steps.join('；')}。`,
    material.must_not_use.length ? `禁止：${material.must_not_use.join('；')}。` : '',
  ]
    .filter(Boolean)
    .join('')

  return [
    {
      tool: 'load_domain_rules',
      input: {
        voltage_level: info.voltage_level,
        part_type: info.part_type,
        environment: info.environment,
      },
      thought: `解析巡检记录：电压等级 ${info.voltage_level}，设备 ${info.part_type_cn}，环境 ${info.environment_cn}，材质 ${info.material_pairing_cn}，温升 ΔT=${info.temp_delta}℃，绝对温度 ${info.abs_temp}℃。先按设备/电压/环境渐进式加载专属业务规则。`,
    },
    {
      tool: 'get_defect_criteria',
      input: {
        voltage_level: info.voltage_level,
        part_type: info.part_type_cn,
        temp_delta: info.temp_delta,
        abs_temp: info.abs_temp,
      },
      thought: '已加载业务规则，现在依据核心判定矩阵（DL/T 664 简化）研判缺陷等级。',
    },
    {
      tool: 'query_material_spec',
      input: {
        environment: info.environment_cn,
        temp_max: info.abs_temp,
        material_pairing: info.material_pairing_cn,
        voltage_level: info.voltage_level,
      },
      thought: '已确定缺陷等级，结合工况（环境/最高温/材质/电压）推荐消缺物料与工艺。',
    },
    {
      tool: 'generate_dispatch_order',
      input: {
        defect_level: defect.level,
        equipment_id: info.equipment_id,
        solution,
        requires_outage: defect.requires_outage,
        defect_desc: `温升 ΔT=${info.temp_delta}℃，绝对温度 ${info.abs_temp}℃，${info.material_pairing_cn}，${info.environment_cn}`,
        part_type: info.part_type_cn,
        environment: info.environment_cn,
        temp_delta: info.temp_delta,
        abs_temp: info.abs_temp,
        material: material.primary_material,
      },
      thought: defect.requires_outage
        ? '缺陷为危急/需停电，生成工单时将触发高危审批拦截，等待人工确认后落盘。'
        : '生成标准化消缺工单草案（无需停电，常规签发）。',
    },
  ]
}

function buildFinalReport(messages: ChatMessage[], text: string): string {
  const criteria = safeParse(findToolResult(messages, 'get_defect_criteria'))
  const material = safeParse(findToolResult(messages, 'query_material_spec'))
  const dispatch = safeParse(findToolResult(messages, 'generate_dispatch_order'))
  const rules = safeParse(findToolResult(messages, 'load_domain_rules'))

  const packs = Array.isArray(rules.matched_rule_packs)
    ? rules.matched_rule_packs.map((p: { name?: string }) => p.name).join('、')
    : '无'

  const defectLevelCn = criteria.defect_level_cn ?? '未知'
  const threshold = criteria.threshold_hit ?? '—'
  const response = criteria.response ?? '—'

  const primary = material.primary_material ?? '—'
  const supplementary = Array.isArray(material.supplementary_materials)
    ? material.supplementary_materials.join('、')
    : ''
  const mustNotUse = Array.isArray(material.must_not_use) ? material.must_not_use.join('；') : ''
  const process = Array.isArray(material.process_steps) ? material.process_steps : []

  let orderStatus: string
  if (dispatch.issued === true) {
    orderStatus = `已签发 ${dispatch.order_no ?? ''}（${dispatch.approval === 'human-approved' ? '人工审批通过' : '免审批直接签发'}），落盘 ${dispatch.file_path ?? ''}`
  } else if (dispatch.rejected === true) {
    orderStatus = `工单 ${dispatch.order_no ?? ''} 被人工审批拒绝，未落盘（${dispatch.note ?? ''}）`
  } else {
    orderStatus = '未生成'
  }

  return [
    '【缺陷等级】' + defectLevelCn + `（${criteria.defect_level ?? 'unknown'}）`,
    '【判定依据】' + threshold,
    '【加载规则】' + packs,
    '【物料与工艺】主材料：' + primary + (supplementary ? `；叠加：${supplementary}` : '') +
      (mustNotUse ? `；严禁：${mustNotUse}` : '') +
      '。工艺步骤：' + process.map((s: string, i: number) => `${i + 1}) ${s}`).join('；'),
    '【处置建议】' + response,
    '【工单状态】' + orderStatus,
  ].join('\n')
}

export class ScriptedModelAdapter implements ModelAdapter {
  async next(messages: ChatMessage[], _options?: ModelRequestOptions): Promise<AgentStep> {
    const original = lastOriginalUserMessage(messages)
    const text = original?.content ?? ''
    const plan = buildPlan(text)
    const called = calledToolNames(messages)

    const nextStep = plan.find((step) => !called.has(step.tool))
    if (nextStep) {
      return {
        type: 'tool_calls',
        content: nextStep.thought,
        calls: [
          {
            id: `scripted-${Date.now()}-${nextStep.tool}`,
            toolName: nextStep.tool,
            input: nextStep.input,
          },
        ],
      }
    }

    return { type: 'assistant', kind: 'final', content: buildFinalReport(messages, text) }
  }
}
