import path from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from '../tool.js'
import {
  buildDispatchOrder,
  formatOrderJson,
  persistOrder,
  type DispatchOrder,
  type DispatchOrderInput,
} from '../rules/dispatch-order.js'

export function resolveOrdersDir(cwd: string): string {
  return path.join(cwd, 'orders')
}

export const generateDispatchOrderTool: ToolDefinition<DispatchOrderInput> = {
  name: 'generate_dispatch_order',
  description:
    '生成标准化检修工单草案并落盘。当 requires_outage=true 或 defect_level=critical 时，' +
    '系统会触发高危审批拦截，须经人工确认后方可落盘。',
  inputSchema: {
    type: 'object',
    properties: {
      defect_level: {
        type: 'string',
        enum: ['normal', 'general', 'serious', 'critical'],
        description: '缺陷等级',
      },
      equipment_id: { type: 'string', description: '设备标识' },
      solution: { type: 'string', description: '处置方案描述（含物料与工艺）' },
      requires_outage: { type: 'boolean', description: '是否需要停电' },
      defect_desc: { type: 'string', description: '缺陷现象描述（可选）' },
      part_type: { type: 'string', description: '设备接头类型（可选）' },
      environment: { type: 'string', description: '环境（可选）' },
      temp_delta: { type: 'number', description: '温升 ΔT（可选）' },
      abs_temp: { type: 'number', description: '绝对温度（可选）' },
      material: { type: 'string', description: '推荐材料（可选）' },
      response_deadline: { type: 'string', description: '响应时限（可选）' },
    },
    required: ['defect_level', 'equipment_id', 'solution', 'requires_outage'],
  },
  schema: z.object({
    defect_level: z.string(),
    equipment_id: z.string(),
    solution: z.string(),
    requires_outage: z.boolean(),
    defect_desc: z.string().optional(),
    part_type: z.string().optional(),
    environment: z.string().optional(),
    temp_delta: z.number().optional(),
    abs_temp: z.number().optional(),
    material: z.string().optional(),
    response_deadline: z.string().optional(),
  }),
  async run(input, context: ToolContext) {
    // 高危工单经人工审批通过后，Agent Loop 注入预构建的工单对象，
    // 保证审批展示的 Diff 与最终落盘内容完全一致。
    const preApproved = context.approvedPayload as DispatchOrder | undefined
    const order = preApproved ?? buildDispatchOrder(input)
    const ordersDir = resolveOrdersDir(context.cwd)

    const filePath = await persistOrder(order, ordersDir, preApproved ? 'human-approved' : 'auto')

    return {
      ok: true,
      output: JSON.stringify(
        {
          issued: true,
          order_no: order.order_no,
          equipment_id: order.equipment_id,
          defect_level: order.defect_level,
          requires_outage: order.requires_outage,
          response_deadline: order.response_deadline,
          solution: order.solution,
          material: order.material,
          file_path: filePath,
          approval: preApproved ? 'human-approved' : 'auto-no-approval-required',
          content: formatOrderJson(order),
        },
        null,
        2,
      ),
    }
  },
}
