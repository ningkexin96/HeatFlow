import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runDiagnosis } from './app.js'
import { TEST_CASES } from './cases.js'
import { loadApprovalMode, loadMaxSteps } from './config.js'

const USAGE = `HeatFlow · 电气设备发热缺陷智能诊断与工单分流 Agent 引擎

用法:
  npx tsx src/cli.ts [选项] ["巡检反馈文本"]

选项:
  -t, --text <文本>      巡检反馈文本（可省略，改为传位置参数）
  -c, --case <1|2>       使用任务书内置测试用例
      --mock             强制使用离线脚本模型（默认：无 API Key 自动降级）
      --auto-approve     高危工单自动放行（仅演示）
      --reject           高危工单自动拒绝
      --tui              启动全屏 TUI 交互界面
  -o, --out <文件>       将执行链路日志写入文件
  -h, --help             显示帮助

示例:
  npx tsx src/cli.ts --case 1
  npx tsx src/cli.ts --case 2 --auto-approve
  npx tsx src/cli.ts --text "220kV 隔离开关触头温升 55℃ ..."
  npx tsx src/cli.ts --tui
`

async function readStdin(): Promise<string> {
  let data = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    data += chunk
  }
  return data.trim()
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const options = {
    text: '',
    caseNo: 0,
    mock: false,
    autoApprove: false,
    reject: false,
    out: '',
    help: false,
    tui: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--text':
      case '-t':
        options.text = argv[++i] ?? ''
        break
      case '--case':
      case '-c':
        options.caseNo = Number(argv[++i] ?? 0)
        break
      case '--mock':
      case '--offline':
        options.mock = true
        break
      case '--auto-approve':
      case '--approve':
        options.autoApprove = true
        break
      case '--reject':
        options.reject = true
        break
      case '--out':
      case '-o':
        options.out = argv[++i] ?? ''
        break
      case '--tui':
        options.tui = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        if (!arg.startsWith('-')) options.text = arg
    }
  }

  if (options.help) {
    process.stdout.write(USAGE)
    return
  }

  if (options.tui) {
    const { runTui } = await import('./tui/index.js')
    await runTui({ cwd: process.cwd(), mock: options.mock })
    return
  }

  let text = options.text
  if (!text && options.caseNo >= 1 && options.caseNo <= TEST_CASES.length) {
    text = TEST_CASES[options.caseNo - 1]
  }
  if (!text && !process.stdin.isTTY) {
    text = await readStdin()
  }
  if (!text) {
    process.stdout.write(USAGE)
    process.exitCode = 1
    return
  }

  const approvalMode = options.autoApprove ? 'auto' : options.reject ? 'reject' : loadApprovalMode()
  const { result, logger } = await runDiagnosis({
    text,
    mock: options.mock,
    maxSteps: loadMaxSteps(),
    approvalMode,
  })

  if (options.out) {
    await mkdir(path.dirname(path.resolve(options.out)), { recursive: true })
    await writeFile(options.out, `${logger.transcript()}\n`, 'utf8')
    process.stdout.write(`\n[日志已写入] ${path.resolve(options.out)}\n`)
  }

  if (result.outcome !== 'final' && result.error) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  process.stderr.write(`[启动失败] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
