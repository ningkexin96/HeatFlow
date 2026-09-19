/**
 * 方案 A：高危操作写入审查与审批流程（Diff & Approval Guardrail）。
 *
 * 当 Agent 决策调用 generate_dispatch_order，且满足以下任一条件时，
 * 系统会阻塞自动执行、输出「新增文件 Diff」并等待人工确认：
 *  - requires_outage === true（申请停电）
 *  - defect_level === 'critical'（危急缺陷）
 *
 * Guardrail 只做「判定 + 生成拟落盘内容」，不落盘；是否执行由 Agent Loop
 * 根据人工审批结果决定，从而将业务工具与安全策略解耦。
 */
import { unifiedDiff } from './diff.js'
import {
  buildDispatchOrder,
  formatOrderJson,
  orderFileName,
  type DispatchOrder,
  type DispatchOrderInput,
} from './rules/dispatch-order.js'

export type ApprovalRequest = {
  toolName: string
  reason: string
  riskLevel: 'high' | 'critical'
  /** 拟落盘文件的统一 Diff。 */
  diff: string
  input: unknown
  /** 预构建的工单对象，审批通过后由工具直接落盘，保证 Diff 与落盘内容一致。 */
  proposedOrder: DispatchOrder
}

export type ApprovalAnswer = {
  approved: boolean
  note?: string
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalAnswer>

export type GuardrailDecision =
  | { allowed: true }
  | {
      allowed: false
      reason: string
      riskLevel: 'high' | 'critical'
      diff: string
      proposedOrder: DispatchOrder
    }

export interface GuardrailPolicy {
  evaluate(toolName: string, input: unknown): GuardrailDecision
}

export class DispatchOrderGuardrail implements GuardrailPolicy {
  evaluate(toolName: string, input: unknown): GuardrailDecision {
    if (toolName !== 'generate_dispatch_order') {
      return { allowed: true }
    }

    const orderInput = input as DispatchOrderInput
    const isCritical = orderInput.defect_level === 'critical'
    const requiresOutage = orderInput.requires_outage === true

    if (!isCritical && !requiresOutage) {
      return { allowed: true }
    }

    const order = buildDispatchOrder(orderInput)
    const diff = unifiedDiff('', formatOrderJson(order), {
      from: '/dev/null',
      to: `orders/${orderFileName(order)}`,
    })

    const reasons = [
      isCritical ? '危急缺陷' : null,
      requiresOutage ? '申请停电' : null,
    ].filter(Boolean)

    return {
      allowed: false,
      reason: `含「${reasons.join('」「')}」，属于高危工单签发`,
      riskLevel: isCritical ? 'critical' : 'high',
      diff,
      proposedOrder: order,
    }
  }
}
