/**
 * 标准化检修工单的构造与持久化。
 *
 * 该模块是「工单内容」的唯一事实来源：工具与高危审批 Guardrail
 * 都调用同一构造逻辑，保证审批 Diff 与最终落盘内容完全一致。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type DispatchOrderInput = {
  defect_level: string
  equipment_id: string
  solution: string
  requires_outage: boolean
  defect_desc?: string
  part_type?: string
  environment?: string
  temp_delta?: number
  abs_temp?: number
  material?: string
  response_deadline?: string
}

export type DispatchOrder = {
  order_no: string
  equipment_id: string
  defect_level: string
  defect_desc: string
  requires_outage: boolean
  response_deadline: string
  solution: string
  material: string
  process_steps: string[]
  safety_notes: string[]
  status: 'draft' | 'approved' | 'rejected'
  created_at: string
  approved_at?: string
  approved_by?: string
}

const RESPONSE_DEADLINE: Record<string, string> = {
  normal: '按计划巡视',
  general: '纳入常规检修计划',
  serious: '72 小时内',
  critical: '立即（限制负荷 / 申请停电）',
}

export function buildOrderNo(): string {
  const ts = new Date()
  const stamp = ts.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `WO-${stamp}-${rand}`
}

export function buildDispatchOrder(input: DispatchOrderInput): DispatchOrder {
  const level = input.defect_level
  const now = new Date().toISOString()
  return {
    order_no: buildOrderNo(),
    equipment_id: input.equipment_id,
    defect_level: level,
    defect_desc: input.defect_desc ?? '',
    requires_outage: Boolean(input.requires_outage),
    response_deadline: input.response_deadline ?? RESPONSE_DEADLINE[level] ?? '按计划巡视',
    solution: input.solution,
    material: input.material ?? '',
    process_steps: [],
    safety_notes:
      input.requires_outage || level === 'critical'
        ? ['停电作业须办理工作票并经调度许可', '作业前验电、挂接地线']
        : ['带电作业须保持安全距离并设专人监护'],
    status: 'draft',
    created_at: now,
  }
}

export function orderFileName(order: DispatchOrder): string {
  return `${order.order_no}.json`
}

export function orderFilePath(order: DispatchOrder, ordersDir: string): string {
  return path.join(ordersDir, orderFileName(order))
}

export function formatOrderJson(order: DispatchOrder): string {
  return JSON.stringify(order, null, 2)
}

export async function persistOrder(
  order: DispatchOrder,
  ordersDir: string,
  approver?: string,
): Promise<string> {
  const filePath = orderFilePath(order, ordersDir)
  await mkdir(ordersDir, { recursive: true })

  const finalOrder: DispatchOrder = {
    ...order,
    status: 'approved',
    approved_at: new Date().toISOString(),
    approved_by: approver ?? 'human',
  }

  await writeFile(filePath, `${formatOrderJson(finalOrder)}\n`, 'utf8')
  return filePath
}
