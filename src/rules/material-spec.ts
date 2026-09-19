/**
 * 消缺物料与工艺推荐逻辑。
 *
 * 规则来源（任务书简化）：
 *  - 常规配电/室内接头：打磨除氧化 + SGIET-100 通用防护材料。
 *  - 特高压/超宽温区/重载接头（温度变化剧烈、易流淌干结）：
 *    必须选用高温无流淌防护材料 SGIET-200。
 *  - 沿海/重盐雾/电偶腐蚀环境（如铜铝过渡面）：
 *    必须选用耐盐雾 ≥1440h 的专用复合脂 SGIET-300，严禁普通导电膏。
 */

export type MaterialPairing = 'copper' | 'aluminum' | 'copper-aluminum' | 'other'

export type EnvironmentProfile = {
  isCoastal: boolean
  isSaltSpray: boolean
  isIndoor: boolean
}

export type MaterialQuery = {
  environment: string
  temp_max: number
  material_pairing: string
  voltage_level?: string
  voltage_kv?: number
}

export type MaterialRecommendation = {
  primary_material: string
  supplementary_materials: string[]
  process_steps: string[]
  must_not_use: string[]
  reasons: string[]
  notes: string[]
}

const UHV_KV_THRESHOLD = 800

export function normalizePairing(raw: string): MaterialPairing {
  const s = raw.trim().toLowerCase()
  if (/铜铝|铜-铝|copper[-_\s]?alum|alum[-_\s]?copper|cu[-_\s]?al|al[-_\s]?cu/.test(s)) {
    return 'copper-aluminum'
  }
  if (/铜|copper|\bcu\b/.test(s)) return 'copper'
  if (/铝|alum|\bal\b/.test(s)) return 'aluminum'
  return 'other'
}

export function parseVoltageKv(raw: string): number | undefined {
  const m = /([±]?\s*\d+(?:\.\d+)?)\s*[kK][vV]/.exec(raw.trim())
  if (!m) return undefined
  const n = Number(m[1].replace(/\s/g, '').replace('±', ''))
  return Number.isFinite(n) ? n : undefined
}

export function isUHV(kv: number | undefined): boolean {
  // 简化阈值：±800kV 直流及以上、1000kV 交流及以上视为特高压工况。
  return kv !== undefined && kv >= UHV_KV_THRESHOLD
}

export function classifyEnvironment(raw: string): EnvironmentProfile {
  const s = raw.trim().toLowerCase()
  const isCoastal = /沿海|海洋|海边|coastal|seaside/.test(s)
  const isSaltSpray = /盐雾|高盐|salt[\s_-]?spray|salt/.test(s)
  const isIndoor = /室内|配电室|配电房|indoor|室内型/.test(s)
  return { isCoastal, isSaltSpray, isIndoor }
}

export function recommendMaterial(query: MaterialQuery): MaterialRecommendation {
  const env = classifyEnvironment(query.environment)
  const pairing = normalizePairing(query.material_pairing)
  const kv = query.voltage_kv ?? parseVoltageKv(query.voltage_level ?? '')
  const isHighTemp = query.temp_max >= 80 || isUHV(kv)

  const corrosionRisk = env.isCoastal || env.isSaltSpray || pairing === 'copper-aluminum'

  const reasons: string[] = []
  const must_not_use: string[] = []
  const notes: string[] = []
  let primary = ''
  const supplementary: string[] = []

  if (corrosionRisk) {
    primary = 'SGIET-300（耐盐雾 ≥1440h 专用复合脂）'
    reasons.push(
      env.isCoastal || env.isSaltSpray
        ? `现场为${env.isCoastal ? '沿海' : ''}${env.isCoastal && env.isSaltSpray ? '/' : ''}${env.isSaltSpray ? '重盐雾' : ''}环境，存在电偶腐蚀风险`
        : '接头为铜铝过渡面，存在电偶腐蚀风险',
    )
    must_not_use.push('普通导电膏（严禁使用）')
  }

  if (isHighTemp) {
    if (!primary) {
      primary = 'SGIET-200（高温无流淌防护材料）'
    } else {
      supplementary.push('SGIET-200（高温无流淌防护材料）')
    }
    reasons.push(
      `最高温度 ${query.temp_max}℃${isUHV(kv) ? `，且为特高压工况（${kv}kV）` : ''}，传统导电膏易流淌干结，必须选用高温无流淌材料`,
    )
  }

  if (!primary) {
    primary = 'SGIET-100（通用型防护材料）'
    reasons.push('常规配电/室内接头，温升未达高温/腐蚀专项条件')
  }

  const process: string[] = []
  process.push('停电/带电安全措施确认（按现场规程执行）')
  process.push('接触面表面打磨除氧化层，清除油污与灰尘')
  process.push(`涂覆 ${primary}${supplementary.length > 0 ? '，并按需叠加 ' + supplementary.join('、') : ''}`)
  process.push('恢复连接后按标准紧固力矩校核')
  if (isHighTemp || corrosionRisk) {
    process.push('处理后复测红外温度，验证温升下降至合格范围')
  }

  if (corrosionRisk && isHighTemp) {
    notes.push(
      '需同时满足抗电偶腐蚀与高温无流淌双重要求：优先选用 SGIET-300 并确认其耐温等级覆盖现场最高温度；若耐温不足，以 SGIET-200 高温工艺为主、SGIET-300 防腐层为辅。',
    )
  }

  return {
    primary_material: primary,
    supplementary_materials: supplementary,
    process_steps: process,
    must_not_use,
    reasons,
    notes,
  }
}
