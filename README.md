# HeatFlow —— 电气设备发热缺陷智能诊断与工单分流 Agent 引擎

一个轻量级、可扩展的 **自主决策 Agent 引擎**，用于电网运维场景下的电气接头过热缺陷智能研判与检修工单分流。系统参考 [MiniCode](https://github.com/LiuMengxuan04/MiniCode) 的 Agent Loop / ToolRegistry / ModelAdapter 架构模式，采用 TypeScript 从零实现。

## 1. 核心能力

| 模块 | 说明 |
| :--- | :--- |
| **Agent 主调度循环** | 驱动模型完成「思考 → 工具调用 → 观察回传 → 下一步决策」多轮闭环 |
| **ToolRegistry** | 工具注册中心，统一元数据（JSON Schema）与运行时参数校验（zod） |
| **模型驱动层** | 支持任意 OpenAI 兼容 API；未配置 Key 时自动降级为离线脚本模型 |
| **高危审批 Guardrail** | 停电 / 危急缺陷工单签发前输出 Diff 并等待人工确认 |
| **渐进式规则加载** | 仅注入规则索引，按需调用工具加载专属规则子集，控制 Token 膨胀 |
| **可观测性** | 全过程打印 Step 编号、思考摘要、工具入参/返回、审批与最终报告 |

## 2. 业务规则（内置参考）

### 缺陷等级判定矩阵（简化 DL/T 664）

| 缺陷等级 | 判定阈值 | 响应时限与处置策略 |
| :--- | :--- | :--- |
| 一般缺陷 | 15℃ ≤ ΔT < 40℃ | 纳入常规检修计划，加强测温巡视 |
| 严重缺陷 | 40℃ ≤ ΔT < 80℃ | 72 小时内带电处理或消缺 |
| 危急缺陷 | ΔT ≥ 80℃ 或 绝对温度 ≥ 110℃ | 立即汇报调度，限制负荷或申请停电紧急消缺 |

### 消缺物料与工艺推荐

- **常规配电/室内**：打磨除氧化 + `SGIET-100` 通用防护材料。
- **特高压/超宽温区/重载**：必须选用高温无流淌材料 `SGIET-200`。
- **沿海/重盐雾/电偶腐蚀（铜铝过渡）**：必须选用耐盐雾 ≥1440h 专用复合脂 `SGIET-300`，**严禁普通导电膏**。

## 3. 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                        Agent Loop (agent-loop.ts)             │
│   Thought → Action(Tool Call) → Observation → 下一步决策        │
│   异常保护：Max Steps / 空响应自愈 / 模型异常重试 / 工具错误回填   │
└───────┬───────────────────────┬───────────────────────┬───────┘
        │                       │                       │
┌───────▼────────┐      ┌───────▼────────┐      ┌───────▼────────┐
│  ModelAdapter   │      │  ToolRegistry   │      │   Guardrail     │
│ (OpenAI / Mock) │      │ 4 个业务工具    │      │  Diff & Approval │
└───────┬────────┘      └───────┬────────┘      └───────┬────────┘
        │                       │                       │
        └───────────┬───────────┴───────────┬───────────┘
                    ▼                       ▼
          ┌──────────────────┐     ┌──────────────────────┐
          │  业务规则层 rules/ │     │  可观测性 observability │
          │ 缺陷矩阵/物料/解析/ │     │  TraceLogger / 事件流   │
          │ 渐进规则/工单      │     └──────────────────────┘
          └──────────────────┘
```

### 目录结构

```
├── src/
│   ├── agent-loop.ts            # Agent 主调度循环
│   ├── tool.ts                  # ToolRegistry / ToolDefinition
│   ├── guardrails.ts            # 高危操作 Diff & Approval
│   ├── observability.ts         # 执行链路追踪
│   ├── prompt.ts                # 系统提示词（含规则索引）
│   ├── config.ts                # 环境配置加载
│   ├── diff.ts                  # 极简统一 Diff（LCS）
│   ├── types.ts                 # 核心协议类型
│   ├── app.ts                   # 应用装配层
│   ├── cli.ts                   # 命令行入口
│   ├── run-cases.ts             # 测试用例日志生成脚本
│   ├── cases.ts                 # 任务书两组测试用例
│   ├── rules/                   # 业务规则层
│   │   ├── defect-criteria.ts   #   缺陷等级判定矩阵
│   │   ├── material-spec.ts     #   物料工艺推荐
│   │   ├── parse-inspection.ts  #   巡检文本结构化解析
│   │   ├── dispatch-order.ts    #   工单构造与落盘
│   │   └── progressive-loader.ts#   渐进式规则加载
│   ├── tools/                   # 工具实现
│   │   ├── get-defect-criteria.ts
│   │   ├── query-material-spec.ts
│   │   ├── generate-dispatch-order.ts
│   │   ├── load-domain-rules.ts
│   │   └── index.ts
│   └── model/                   # 模型驱动层
│       ├── openai-adapter.ts    #   真实 OpenAI 兼容适配器
│       ├── mock-adapter.ts      #   离线确定性脚本模型
│       └── index.ts
├── test/                        # 单元 + 端到端测试
├── logs/                        # 测试链路日志产物（运行 demo 后生成）
├── package.json
└── tsconfig.json
```

## 4. 快速开始

### 环境要求

- Node.js ≥ 18（推荐 20+，已在 Node 24 验证）

### 安装

```bash
# 1) 获取代码
git clone https://github.com/ningkexin96/HeatFlow.git
cd HeatFlow

# 2) 安装依赖（zod / typescript / tsx 等会自动安装，无需任何全局工具）
npm install

# 3) 可选：编译到 dist/（质量检查，或需要以编译后的 JS 运行）
npm run build
```

### 运行内置测试用例（离线，无需 API Key）

```bash
# 用例 1：一般缺陷带电维护场景
npm run case1

# 用例 2：沿海特高压危急过热缺陷场景
npm run case2

# 同时运行两个用例，并生成 logs/ 下的完整执行链路日志
npm run demo
```

### 交互式 CLI

```bash
# 使用内置用例
npx tsx src/cli.ts --case 1
npx tsx src/cli.ts --case 2 --auto-approve     # 高危工单自动放行
npx tsx src/cli.ts --case 2 --reject           # 高危工单自动拒绝

# 传入自定义巡检文本
npx tsx src/cli.ts --text "220kV 某变电站母排搭接面，环境温度 20℃，表面温度 95℃（温升 75℃）……"
```

> 默认审批模式为 `interactive`：遇到高危工单时，会在命令行打印 Diff 并等待输入 `y/n` 确认后才落盘。

### 运行测试

```bash
npm test        # 单元 + 端到端测试
npm run typecheck
npm run build
```

## 5. 模型 API 配置

支持任意标准 **OpenAI 兼容** 接口（OpenAI、DeepSeek、通义、Moonshot 等，以及经网关转换为 OpenAI 格式的 Anthropic 服务）。

复制 `.env.example` 为 `.env` 并配置：

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxxx
OPENAI_MODEL=gpt-4o-mini
```

也可通过环境变量注入：

```bash
OPENAI_API_KEY=sk-xxxx OPENAI_MODEL=gpt-4o-mini npx tsx src/cli.ts --case 1
```

- **未配置** `OPENAI_API_KEY` 时，引擎自动降级为内置的确定性「脚本模型」，用于离线演示与自动化测试。
- 配置后即走真实 LLM 推理，模型驱动层会自动把工具注册中心的 JSON Schema 转换为 Function Calling 参数并解析返回的工具调用。

## 6. 高危审批流程（方案 A：Diff & Approval Guardrail）

当 Agent 决策调用 `generate_dispatch_order`，且满足以下任一条件时，系统会**阻塞自动执行**：

- `requires_outage === true`（申请停电）
- `defect_level === 'critical'`（危急缺陷）

此时系统输出拟落盘文件的统一 Diff 与拦截原因，等待人工确认（`y/n`），**确认通过后**才落盘到 `orders/` 目录。审批拒绝则工单不落盘，拒绝信息回填到上下文。

## 7. 渐进式规则加载（方案 B：Progressive Rules Loading）

系统 Prompt 中只注入：

1. 核心缺陷判定矩阵（体积小、始终必需）；
2. 业务规则**索引**（仅名称与触发条件）。

Agent 在首轮调用 `load_domain_rules(voltage_level, part_type, environment)` 按需加载专属规则子集（如 `uhv-special`、`coastal-corrosion`、`disconnector-contact`），从而控制上下文 Token 膨胀。

## 8. 测试日志产物

运行 `npm run demo` 后，`logs/` 目录会生成：

- `case1-general.log` —— 用例 1 完整执行链路日志
- `case2-critical.log` —— 用例 2 完整执行链路日志（含高危审批 Diff）
- `demo.log` —— 汇总日志

日志包含：系统提示词、用户输入、各 Step 思考摘要、工具调用入参、工具返回结果、审批拦截与决策、最终综合研判报告、回合结果。

## 9. 评估关注点对照

1. **Agent 架构纯度与健壮性**：`agent-loop.ts` 实现真正的多轮自驱动闭环，含 Max Steps、空响应/模型异常自愈重试、工具错误回填。
2. **抽象与解耦设计**：`ToolRegistry`、`ModelAdapter`、`GuardrailPolicy`、提示词模板与业务规则相互解耦，均可独立替换。
3. **安全与工程约束意识**：高危工单写入前强制 Diff + 人工审批，审批通过才落盘。
4. **代码工程水准**：严格 TypeScript 类型、分层目录、JSON Schema + zod 双重参数校验、完备自动化测试。
