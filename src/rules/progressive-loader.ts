/**
 * 方案 B：业务规则渐进式检索/加载机制（Progressive Rules Loading）。
 *
 * 设计目标：不在系统 Prompt 中一次性塞入全量规范，而是仅注入一个
 * 「规则索引」，由 Agent 根据初步识别的电压等级 / 设备类型 / 环境
 * 动态调用 load_domain_rules 工具，按需加载专属规则子集，控制上下文 Token 膨胀。
 */

export type RulePack = {
  id: string
  name: string
  /** 匹配条件：任一命中即视为相关。 */
  matches: {
    voltage_kv_min?: number
    device_types?: string[]
    environments?: string[]
  }
  content: string
}

export const RULE_PACKS: RulePack[] = [
  {
    id: 'distribution-indoor',
    name: '常规配电/室内接头工艺',
    matches: { environments: ['indoor', 'outdoor'], voltage_kv_min: 0 },
    content: [
      '常规配电/室内接头：表面打磨除氧化层，涂覆通用型防护材料 SGIET-100。',
      '处置流程：外观检查 → 表面处理 → 涂覆防护材料 → 紧固力矩校核 → 复测温升。',
    ].join('\n'),
  },
  {
    id: 'disconnector-contact',
    name: '隔离开关触头过热专项',
    matches: { device_types: ['disconnector', '隔离开关触头'] },
    content: [
      '隔离开关触头过热：重点关注触指弹簧压力、接触电阻与表面氧化。',
      '带电处理时应先确认触头分合闸到位，防止因接触压力不足导致的持续过热。',
    ].join('\n'),
  },
  {
    id: 'lead-clamp',
    name: '套管引线线夹过热专项',
    matches: { device_types: ['lead_clamp', '引线线夹'] },
    content: [
      '套管引线线夹过热：重点核查压接质量、线夹与引线材质匹配。',
      '铜铝过渡连接部应使用过渡线夹或专用防腐复合脂，避免电偶腐蚀。',
    ].join('\n'),
  },
  {
    id: 'busbar-joint',
    name: '母排搭接面过热专项',
    matches: { device_types: ['busbar_joint', '母排搭接面'] },
    content: [
      '母排搭接面过热：重点核查搭接面平整度与紧固力矩。',
      '必要时重新打磨搭接面并按规定力矩复紧。',
    ].join('\n'),
  },
  {
    id: 'uhv-special',
    name: '特高压/超宽温区/重载专项',
    matches: { voltage_kv_min: 800 },
    content: [
      '特高压/超宽温区/重载接头：温度变化剧烈，传统导电膏易流淌干结。',
      '必须选用高温无流淌特性的防护材料 SGIET-200。',
    ].join('\n'),
  },
  {
    id: 'coastal-corrosion',
    name: '沿海/重盐雾/电偶腐蚀专项',
    matches: { environments: ['coastal', 'coastal_salt_spray'] },
    content: [
      '沿海/重盐雾/电偶腐蚀环境（如铜铝过渡面）：',
      '必须选用耐盐雾 ≥1440h 的专用复合脂 SGIET-300，严禁使用普通导电膏。',
    ].join('\n'),
  },
]

export class RuleRegistry {
  constructor(private readonly packs: RulePack[] = RULE_PACKS) {}

  /** 供系统 Prompt 注入的紧凑索引（仅名称与触发条件，不含完整规范正文）。 */
  listIndex(): string {
    return this.packs
      .map((pack) => {
        const conditions = [
          pack.matches.voltage_kv_min !== undefined
            ? `电压 ≥ ${pack.matches.voltage_kv_min}kV`
            : undefined,
          pack.matches.device_types?.length
            ? `设备类型: ${pack.matches.device_types.join('/')}`
            : undefined,
          pack.matches.environments?.length
            ? `环境: ${pack.matches.environments.join('/')}`
            : undefined,
        ]
          .filter(Boolean)
          .join(', ')
        return `- [${pack.id}] ${pack.name}（${conditions || '通用'}）`
      })
      .join('\n')
  }

  /** 按电压等级 / 设备类型 / 环境加载匹配的规则子集。 */
  load(voltageKv: number, deviceType: string, environment: string): RulePack[] {
    return this.packs.filter((pack) => {
      const kvMatch =
        pack.matches.voltage_kv_min === undefined || voltageKv >= pack.matches.voltage_kv_min
      const deviceMatch =
        !pack.matches.device_types?.length ||
        pack.matches.device_types.some((d) => deviceType.includes(d) || d.includes(deviceType))
      const envMatch =
        !pack.matches.environments?.length ||
        pack.matches.environments.some((e) => environment.includes(e) || e.includes(environment))
      return kvMatch && deviceMatch && envMatch
    })
  }
}
