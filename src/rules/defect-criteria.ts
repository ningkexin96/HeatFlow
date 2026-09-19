/**
 * 缺陷等级判定矩阵（简化行业导则 DL/T 664）。
 *
 * 判定依据为相对环境温升 ΔT 与绝对温度：
 *  - 一般缺陷：15℃ ≤ ΔT < 40℃
 *  - 严重缺陷：40℃ ≤ ΔT < 80℃
 *  - 危急缺陷：ΔT ≥ 80℃ 或 绝对温度 ≥ 110℃
 */

export const DEFECT_LEVELS = ['normal', 'general', 'serious', 'critical'] as const
export type DefectLevel = (typeof DEFECT_LEVELS)[number]

export type DefectAssessment = {
  level: DefectLevel
  temp_delta: number
  abs_temp: number
  /** 命中的判定条件描述（用于可解释性）。 */
  threshold_hit: string
  /** 响应时限与处置策略。 */
  response: string
  /** 是否需要紧急停电 / 限制负荷。 */
  requires_outage: boolean
}

const CRITICAL_DELTA = 80
const CRITICAL_ABS = 110
const SERIOUS_DELTA = 40
const GENERAL_DELTA = 15

export function classifyDefect(tempDelta: number, absTemp: number): DefectAssessment {
  if (tempDelta >= CRITICAL_DELTA) {
    return {
      level: 'critical',
      temp_delta: tempDelta,
      abs_temp: absTemp,
      threshold_hit: `温升 ΔT=${tempDelta}℃ ≥ ${CRITICAL_DELTA}℃`,
      response: '立即汇报调度，限制负荷或申请停电紧急消缺',
      requires_outage: true,
    }
  }

  if (absTemp >= CRITICAL_ABS) {
    return {
      level: 'critical',
      temp_delta: tempDelta,
      abs_temp: absTemp,
      threshold_hit: `绝对温度 ${absTemp}℃ ≥ ${CRITICAL_ABS}℃`,
      response: '立即汇报调度，限制负荷或申请停电紧急消缺',
      requires_outage: true,
    }
  }

  if (tempDelta >= SERIOUS_DELTA) {
    return {
      level: 'serious',
      temp_delta: tempDelta,
      abs_temp: absTemp,
      threshold_hit: `${SERIOUS_DELTA}℃ ≤ 温升 ΔT=${tempDelta}℃ < ${CRITICAL_DELTA}℃`,
      response: '72 小时内安排带电处理或消缺，防止恶化',
      requires_outage: false,
    }
  }

  if (tempDelta >= GENERAL_DELTA) {
    return {
      level: 'general',
      temp_delta: tempDelta,
      abs_temp: absTemp,
      threshold_hit: `${GENERAL_DELTA}℃ ≤ 温升 ΔT=${tempDelta}℃ < ${SERIOUS_DELTA}℃`,
      response: '纳入常规检修计划，加强测温巡视监控',
      requires_outage: false,
    }
  }

  return {
    level: 'normal',
    temp_delta: tempDelta,
    abs_temp: absTemp,
    threshold_hit: `温升 ΔT=${tempDelta}℃ < ${GENERAL_DELTA}℃，未达缺陷标准`,
    response: '保持正常巡视，持续跟踪测温数据',
    requires_outage: false,
  }
}

export const DEFECT_LEVEL_LABELS: Record<DefectLevel, string> = {
  normal: '正常',
  general: '一般缺陷',
  serious: '严重缺陷',
  critical: '危急缺陷',
}
