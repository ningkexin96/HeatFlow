import { runTui } from './index.js'

runTui().catch((error) => {
  process.stderr.write(`[TUI 启动失败] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
