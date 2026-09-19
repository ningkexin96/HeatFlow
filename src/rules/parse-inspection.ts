/**
 * 巡检文本结构化解析器。
 *
 * 用于「确定性脚本模型」从自然语言巡检记录中抽取结构化字段，
 * 驱动 Agent Loop 完成多轮工具调用（模拟真实 LLM 的阅读理解）。
 * 真实接入 LLM 后，该解析仅作为脚本模型的离线降级实现保留。
 */

export type InspectionInfo = {
  voltage_level: string
  voltage_kv: number
  part_type: string
  part_type_cn: string
  abs_temp: number
  ambient_temp: number
  temp_delta: number
  environment: string
  environment_cn: string
  material_pairing: string
  material_pairing_cn: string
  equipment_id: string
  raw: string
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (m?.[1]) return m[1].trim()
  }
  return undefined
}

function toNumber(s: string | undefined): number | undefined {
  if (s === undefined) return undefined
  const n = Number(s.replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

export function parseInspection(text: string): InspectionInfo {
  const raw = text.trim()

  const voltageMatch = /([±]?\s*\d{2,4})\s*[kK][vV]/.exec(raw)
  const voltageLevel = voltageMatch ? `${voltageMatch[1].replace(/\s/g, '')}kV` : '未知'
  const voltageKv = toNumber(voltageMatch?.[1]) ?? 0

  const ambient = toNumber(
    firstMatch(raw, [
      /环境温度\s*(?:为|达|约|在|是)?\s*(\d+(?:\.\d+)?)\s*℃/,
      /环境\s*(?:温度\s*)?(?:为|达|约|在)?\s*(\d+(?:\.\d+)?)\s*℃/,
    ]),
  ) ?? 0

  const abs =
    toNumber(
      firstMatch(raw, [
        /表面(?:最高)?温度\s*(?:为|达|约|在|是)?\s*(\d+(?:\.\d+)?)\s*℃/,
        /最高温度\s*(?:为|达|约|在|是)?\s*(\d+(?:\.\d+)?)\s*℃/,
        /实测(?:表面)?温度\s*(?:为|达|约|在|是)?\s*(\d+(?:\.\d+)?)\s*℃/,
        /温度(?:达|为|约|在)\s*(\d+(?:\.\d+)?)\s*℃/,
      ]),
    ) ?? 0

  const delta =
    toNumber(
      firstMatch(raw, [
        /温升(?:高达|高?达|为|约|在|是)?\s*(\d+(?:\.\d+)?)\s*℃/,
        /相对温差\s*(?:为|达|约)?\s*(\d+(?:\.\d+)?)\s*℃/,
      ]),
    ) ?? (abs > 0 && ambient >= 0 ? Math.max(0, abs - ambient) : 0)

  const partTypeCn = detectPartType(raw)
  const partType = partTypeCn === '隔离开关触头' ? 'disconnector'
    : partTypeCn === '引线线夹' ? 'lead_clamp'
    : partTypeCn === '母排搭接面' ? 'busbar_joint'
    : 'other'

  const environmentCn = detectEnvironment(raw)
  const environment = environmentCn === '沿海重盐雾' || environmentCn === '沿海' ? 'coastal_salt_spray'
    : environmentCn === '室内' ? 'indoor'
    : 'outdoor'

  const pairingCn = detectPairing(raw)
  const materialPairing = pairingCn === '铜铝过渡' ? 'copper-aluminum'
    : pairingCn === '铜质' ? 'copper'
    : pairingCn === '铝质' ? 'aluminum'
    : 'unknown'

  const equipmentId = buildEquipmentId(raw, voltageLevel, partTypeCn, abs)

  return {
    voltage_level: voltageLevel,
    voltage_kv: voltageKv,
    part_type: partType,
    part_type_cn: partTypeCn,
    abs_temp: abs,
    ambient_temp: ambient,
    temp_delta: delta,
    environment,
    environment_cn: environmentCn,
    material_pairing: materialPairing,
    material_pairing_cn: pairingCn,
    equipment_id: equipmentId,
    raw,
  }
}

function detectPartType(text: string): string {
  if (/隔离开关|刀闸|闸刀/.test(text)) return '隔离开关触头'
  if (/套管|线夹|引线/.test(text)) return '引线线夹'
  if (/母排|搭接面|汇流排/.test(text)) return '母排搭接面'
  if (/触头/.test(text)) return '触头'
  return '未知接头'
}

function detectEnvironment(text: string): string {
  if (/盐雾|沿海|海洋|海边|高盐雾/.test(text)) {
    return /沿海/.test(text) ? '沿海重盐雾' : '重盐雾'
  }
  if (/室内|配电室|配电房/.test(text)) return '室内'
  return '常规户外'
}

function detectPairing(text: string): string {
  if (/铜铝|铜-铝|铜\.铝/.test(text)) return '铜铝过渡'
  if (/铜质|纯铜|铜排|铜触头/.test(text)) return '铜质'
  if (/铝质|铝排|铝线夹/.test(text)) return '铝质'
  return '未知'
}

function buildEquipmentId(
  text: string,
  voltageLevel: string,
  partTypeCn: string,
  absTemp: number,
): string {
  const station = /([^\s，。；,;：:]*?(?:变电站|换流站|配电房|配电室|开关站))/.exec(text)?.[1] ?? ''
  const main = firstMatch(text, [/(\d+\s*号\s*主变)/])?.replace(/\s+/g, '') ?? ''
  const phase = firstMatch(text, [/([ABCabc]\s*相)/])?.replace(/\s+/g, '') ?? ''
  const parts = [voltageLevel, station, main, phase, partTypeCn].filter(Boolean)
  const id = parts.join('-').replace(/\s+/g, '')
  return id || `EQ-${partTypeCn}-${absTemp}℃`
}
