/**
 * 运行配置加载。
 *
 * 模型 API 配置支持任意标准 OpenAI 兼容接口；未配置 API Key 时，
 * 引擎自动退化为内置确定性「脚本模型」，保证离线演示与自动化测试可运行。
 */

export type ModelConfig = {
  baseUrl: string
  apiKey?: string
  model: string
  maxOutputTokens?: number
}

export type ApprovalMode = 'interactive' | 'auto' | 'reject'

export function loadModelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const baseUrl = (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').trim().replace(/\/+$/, '')
  const apiKey = (env.OPENAI_API_KEY ?? env.API_KEY ?? '').trim() || undefined
  const model = (env.OPENAI_MODEL ?? 'gpt-4o-mini').trim()
  const rawTokens = env.MAX_OUTPUT_TOKENS
  const maxOutputTokens =
    rawTokens && Number.isFinite(Number(rawTokens)) && Number(rawTokens) > 0
      ? Math.floor(Number(rawTokens))
      : undefined

  return { baseUrl, apiKey, model, maxOutputTokens }
}

export function hasRealModelConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.OPENAI_API_KEY ?? env.API_KEY ?? '').trim())
}

export function loadMaxSteps(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DEFECT_AGENT_MAX_STEPS
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8
}

export function loadApprovalMode(env: NodeJS.ProcessEnv = process.env): ApprovalMode {
  const mode = (env.DEFECT_APPROVAL_MODE ?? 'interactive').trim().toLowerCase()
  if (mode === 'auto') return 'auto'
  if (mode === 'reject') return 'reject'
  return 'interactive'
}
