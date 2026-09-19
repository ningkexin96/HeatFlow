import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import { parseVoltageKv } from '../rules/material-spec.js'
import { RuleRegistry } from '../rules/progressive-loader.js'

type Input = {
  voltage_level: string
  part_type: string
  environment?: string
}

export const loadDomainRulesTool: ToolDefinition<Input> = {
  name: 'load_domain_rules',
  description:
    '按电压等级、设备类型、环境渐进式加载专属业务规则子集，避免在系统提示词中一次性塞入全量规范。',
  inputSchema: {
    type: 'object',
    properties: {
      voltage_level: { type: 'string', description: '电压等级，如 220kV / ±800kV' },
      part_type: { type: 'string', description: '设备接头类型，如 disconnector/lead_clamp/busbar_joint' },
      environment: { type: 'string', description: '环境，如 outdoor/indoor/coastal_salt_spray' },
    },
    required: ['voltage_level', 'part_type'],
  },
  schema: z.object({
    voltage_level: z.string(),
    part_type: z.string(),
    environment: z.string().optional(),
  }),
  async run(input) {
    const registry = new RuleRegistry()
    const kv = parseVoltageKv(input.voltage_level) ?? 0
    const packs = registry.load(kv, input.part_type, input.environment ?? '')

    return {
      ok: true,
      output: JSON.stringify(
        {
          voltage_level: input.voltage_level,
          part_type: input.part_type,
          environment: input.environment ?? '',
          matched_rule_packs: packs.map((pack) => ({ id: pack.id, name: pack.name })),
          rules: packs.map((pack) => pack.content).join('\n\n'),
        },
        null,
        2,
      ),
    }
  },
}
