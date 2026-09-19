import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import { recommendMaterial } from '../rules/material-spec.js'

type Input = {
  environment: string
  temp_max: number
  material_pairing: string
  voltage_level?: string
}

export const queryMaterialSpecTool: ToolDefinition<Input> = {
  name: 'query_material_spec',
  description:
    '根据工况（环境、最高温度、材质配对、可选电压等级）推荐消缺防护材料与工艺说明。' +
    '沿海/重盐雾/铜铝过渡场景必须返回 SGIET-300；特高压/高温场景必须返回 SGIET-200；常规场景返回 SGIET-100。',
  inputSchema: {
    type: 'object',
    properties: {
      environment: { type: 'string', description: '工况环境，如 沿海重盐雾/室内/常规户外' },
      temp_max: { type: 'number', description: '接头最高温度（℃）' },
      material_pairing: { type: 'string', description: '材质配对，如 铜质/铜铝过渡/铝质' },
      voltage_level: { type: 'string', description: '可选，电压等级，如 ±800kV / 220kV' },
    },
    required: ['environment', 'temp_max', 'material_pairing'],
  },
  schema: z.object({
    environment: z.string(),
    temp_max: z.number(),
    material_pairing: z.string(),
    voltage_level: z.string().optional(),
  }),
  async run(input) {
    const result = recommendMaterial({
      environment: input.environment,
      temp_max: input.temp_max,
      material_pairing: input.material_pairing,
      voltage_level: input.voltage_level,
    })

    return {
      ok: true,
      output: JSON.stringify(
        {
          environment: input.environment,
          temp_max: input.temp_max,
          material_pairing: input.material_pairing,
          ...result,
        },
        null,
        2,
      ),
    }
  },
}
