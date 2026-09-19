import { ToolRegistry } from '../tool.js'
import { getDefectCriteriaTool } from './get-defect-criteria.js'
import { queryMaterialSpecTool } from './query-material-spec.js'
import { generateDispatchOrderTool } from './generate-dispatch-order.js'
import { loadDomainRulesTool } from './load-domain-rules.js'

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry([
    getDefectCriteriaTool,
    queryMaterialSpecTool,
    generateDispatchOrderTool,
    loadDomainRulesTool,
  ])
}
