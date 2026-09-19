import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import { DEFECT_LEVEL_LABELS, classifyDefect } from '../rules/defect-criteria.js'

type Input = {
  voltage_level: string
  part_type: string
  temp_delta: number
  abs_temp: number
}

export const getDefectCriteriaTool: ToolDefinition<Input> = {
  name: 'get_defect_criteria',
  description:
    '查询缺陷等级标准。根据接头相对环境温升 ΔT 与绝对温度判定缺陷等级（一般/严重/危急），并给出响应时限与处置策略。',
  inputSchema: {
    type: 'object',
    properties: {
      voltage_level: { type: 'string', description: '电压等级，如 220kV / ±800kV' },
      part_type: { type: 'string', description: '设备接头类型，如 隔离开关触头/引线线夹/母排搭接面' },
      temp_delta: { type: 'number', description: '相对环境温升 ΔT（℃）' },
      abs_temp: { type: 'number', description: '红外实测表面绝对温度（℃）' },
    },
    required: ['voltage_level', 'part_type', 'temp_delta', 'abs_temp'],
  },
  schema: z.object({
    voltage_level: z.string(),
    part_type: z.string(),
    temp_delta: z.number(),
    abs_temp: z.number(),
  }),
  async run(input) {
    const result = classifyDefect(input.temp_delta, input.abs_temp)
    return {
      ok: true,
      output: JSON.stringify(
        {
          voltage_level: input.voltage_level,
          part_type: input.part_type,
          temp_delta: input.temp_delta,
          abs_temp: input.abs_temp,
          defect_level: result.level,
          defect_level_cn: DEFECT_LEVEL_LABELS[result.level],
          threshold_hit: result.threshold_hit,
          response: result.response,
          requires_outage: result.requires_outage,
        },
        null,
        2,
      ),
    }
  },
}
