/**
 * 测试用例执行脚本：驱动两组模拟输入，输出完整执行链路日志。
 *
 * 运行：npx tsx src/run-cases.ts [--case 1|2|all] [--reject]
 * 日志产物写入 logs/ 目录（case1-general.log / case2-critical.log / demo.log）。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runDiagnosis } from './app.js'
import { TEST_CASES } from './cases.js'

type CaseDef = {
  no: number
  name: string
  file: string
  text: string
}

const CASES: CaseDef[] = [
  { no: 1, name: '一般缺陷带电维护场景', file: 'case1-general.log', text: TEST_CASES[0] },
  { no: 2, name: '沿海特高压危急过热缺陷场景', file: 'case2-critical.log', text: TEST_CASES[1] },
]

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  let selected = 'all'
  let reject = false
  let outDir = 'logs'

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--case' || arg === '-c') selected = argv[++i] ?? 'all'
    else if (arg === '--reject') reject = true
    else if (arg === '--out-dir') outDir = argv[++i] ?? 'logs'
  }

  const targets = selected === 'all' ? CASES : CASES.filter((c) => String(c.no) === selected)
  if (targets.length === 0) {
    process.stderr.write(`未知用例: ${selected}（可选 1 / 2 / all）\n`)
    process.exitCode = 1
    return
  }

  await mkdir(outDir, { recursive: true })
  const transcripts: string[] = []

  for (const c of targets) {
    process.stdout.write(`\n\n########## 测试用例 ${c.no}：${c.name} ##########\n`)
    const { logger } = await runDiagnosis({
      text: c.text,
      mock: true,
      approvalMode: reject ? 'reject' : 'auto',
    })

    const transcript = logger.transcript()
    transcripts.push(transcript)

    const filePath = path.join(outDir, c.file)
    await writeFile(filePath, `${transcript}\n`, 'utf8')
    process.stdout.write(`\n[用例 ${c.no} 日志已写入] ${path.resolve(filePath)}\n`)
  }

  if (targets.length === CASES.length) {
    const demoPath = path.join(outDir, 'demo.log')
    await writeFile(
      demoPath,
      `电气设备发热缺陷智能诊断与工单分流 Agent 引擎 —— 完整测试链路日志\n\n${transcripts.join('\n\n')}\n`,
      'utf8',
    )
    process.stdout.write(`\n[汇总日志已写入] ${path.resolve(demoPath)}\n`)
  }
}

main().catch((error) => {
  process.stderr.write(`[执行失败] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
