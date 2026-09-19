/** TUI 启动入口：装配真实终端 + TuiApp，并处理非 TTY 兜底与退出恢复。 */
import { loadApprovalMode, loadMaxSteps } from '../config.js'
import { TuiApp, type TuiApprovalMode } from './app.js'
import { ProcessTerminal } from './terminal.js'

export type RunTuiOptions = {
  cwd?: string
  mock?: boolean
}

export async function runTui(options: RunTuiOptions = {}): Promise<void> {
  const term = new ProcessTerminal()

  if (!term.isTTY()) {
    process.stderr.write(
      'HeatFlow TUI 需要交互式终端（TTY）。请直接在终端中运行 `npm run tui`，或改用 CLI：npx tsx src/cli.ts --case 1\n',
    )
    process.exitCode = 1
    return
  }

  const app = new TuiApp({
    terminal: term,
    cwd: options.cwd,
    mock: options.mock,
    maxSteps: loadMaxSteps(),
    approvalMode: loadApprovalMode() as TuiApprovalMode,
  })

  const restore = () => {
    try {
      term.exit()
    } catch {
      // 忽略恢复失败
    }
  }
  process.once('exit', restore)

  try {
    await app.start()
  } finally {
    process.off('exit', restore)
  }
}
