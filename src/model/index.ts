import type { ModelAdapter } from '../types.js'
import { hasRealModelConfig, loadModelConfig } from '../config.js'
import { OpenAICompatibleAdapter } from './openai-adapter.js'
import { ScriptedModelAdapter } from './mock-adapter.js'

export type CreateModelOptions = {
  /** 强制使用离线脚本模型（默认：未配置 API Key 时自动降级）。 */
  mock?: boolean
}

export function createModelAdapter(options: CreateModelOptions = {}): ModelAdapter {
  if (options.mock || !hasRealModelConfig()) {
    return new ScriptedModelAdapter()
  }
  return new OpenAICompatibleAdapter(() => loadModelConfig())
}
