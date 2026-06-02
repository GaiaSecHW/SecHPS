# Agent 应用开发手册

> **版本**: v3.0  
> **适用对象**: Agent 开发者  
> **文档性质**: 开发指南

---

## 第一章 输入输出规范（核心契约）

**这是 Agent 开发者必须遵守的硬性约定。违反以下规范将导致任务无法正常完成。**

### 1.1 输入规范

任务执行时，Agent 工作空间包含以下内容：

```
{workspacePath}/
├── vlu_scan_code/                # 用户上传的待扫描文件（TASK_INPUT_DIR，默认 vlu_scan_code）
│   ├── <解压后的源码文件>
│   └── ...
├── <AgentHarness 全部文件>      # 从 MinIO 下载（opencode.json 等）
└── instruction.txt              # 执行指令（如存在）
```

**关键规则：**

- 用户上传的 ZIP 文件会被**解压到 `vlu_scan_code/` 子目录**（可通过环境变量 `TASK_INPUT_DIR` 配置），与 AgentHarness 文件隔离
- Agent 必须在 `vlu_scan_code/` 目录中查找待分析的源码
- 不要在工作空间根目录或其他位置寻找用户代码

### 1.2 输出规范：任务完成判定

**`Report/AUDIT_REPORT*.json/.md` 是任务完成的唯一判定信号。没有这个文件，任务将被判定为 failed。**

Agent 必须将最终报告输出到工作空间的 `Report/` 目录，文件名和格式必须满足以下条件：

| 规则 | 说明 |
|------|------|
| **目录** | `Report/`（大写 R） — 小写 `report/` 不会触发完成判定 |
| **文件名前缀** | 必须以 `AUDIT_REPORT` 开头（前缀匹配） |
| **后缀** | 仅限 `.json` 或 `.md` — `.html`、`.txt`、`.tmp`、`.partial`、`.lock` 等其他后缀**不会被接受** |
| **文件大小** | 必须非空（size > 0） |
| **文件稳定性** | 文件写入必须稳定后才会判定完成（连续两次检查 size 和 mtimeMs 不变） |

**接受的文件名示例：**

```
Report/AUDIT_REPORT.json          ✅
Report/AUDIT_REPORT.md            ✅
Report/AUDIT_REPORT_v2.json       ✅
Report/AUDIT_REPORT_20260601.md   ✅
```

**不被接受的文件名示例：**

```
report/AUDIT_REPORT.md            ❌  小写 r，不触发完成判定
Report/audit_report.json          ❌  小写前缀
Report/AUDIT_REPORT.html          ❌  后缀不是 .json/.md
Report/AUDIT_REPORT.txt           ❌  后缀不是 .json/.md
Report/AUDIT_REPORT.tmp           ❌  临时文件后缀
reports.jsonl                     ❌  不在 Report/ 目录，不是 AUDIT_REPORT 前缀
```

### 1.3 输出规范：报告格式

#### AUDIT_REPORT.md 格式

Markdown 格式报告推荐遵循以下结构：

```text
1. 执行摘要
2. 发现统计（按严重度：Critical/High/Medium/Low）
3. 漏洞详情（每个发现包含证据链）
4. 攻击链分析
5. 修复优先级建议（P0/P1/P2/P3）
6. 已验证有效的安全控制
```

**发现编号规则：** `C-XX`（严重）、`H-XX`（高危）、`M-XX`（中危）、`L-XX`（低危）

**置信度标签：**
- `[已验证]` — 存在完整可利用链路或运行时证明
- `[高置信度]` — 存在完整证据链但无完整利用证明
- `[中置信度]` — 代码证据较强但缺少关键验证环节
- `[待验证]` — 仅可疑模式

**证据链要求（Sink 链）：** 每个中危及以上发现必须包含明确的证据链：

```
[SINK-CHAIN] Source → Transform → Sink
├── Source: {file}:{line} | {code_snippet}
├── Transform/Check: {file}:{line} | {code_snippet} | 说明
└── Sink: {file}:{line} | {code_snippet} | 危险函数/缺失防护
```

**语言要求：** AUDIT_REPORT.md 必须为中文（代码、路径、接口名保持原文）。

#### AUDIT_REPORT.json 格式

JSON 格式报告应包含 `vulnerabilities` 数组，每条漏洞包含以下字段：

```json
{
  "vulnerabilities": [
    {
      "title": "SQL注入漏洞（必填）",
      "type": "SQL Injection（必填）",
      "description": "漏洞描述",
      "severity": "critical | high | medium | low | info",
      "cwe": "CWE-89",
      "location": "vlu_scan_code/src/main.java:42",
      "POC": "漏洞验证代码或步骤",
      "fixSuggestion": "修复建议",
      "rawReport": "报告文件绝对路径（分号分隔）",
      "vulnerable": true
    }
  ]
}
```

| 字段 | 是否必填 | 说明 |
|------|---------|------|
| `title` | **必填** | 漏洞标题 |
| `type` | **必填** | 漏洞类型 |
| `description` | 可选 | 漏洞描述 |
| `severity` | 可选 | 严重程度：`critical`/`high`/`medium`/`low`/`info` |
| `cwe` | 可选 | CWE 编号，如 `CWE-89` |
| `location` | 可选 | 漏洞所在源码位置（文件名 + 行号） |
| `POC` | 可选 | 漏洞验证代码或步骤 |
| `fixSuggestion` | 可选 | 修复建议 |
| `rawReport` | 可选 | 原始报告文件路径（分号分隔） |
| `vulnerable` | 可选 | 是否确认为漏洞（`false` 时该条目被排除） |

### 1.4 输出规范：漏洞入库（异步）

任务完成后，平台会异步触发漏洞解析流程，与完成判定是两条独立链路：

```
Agent 完成 → Worker 检测到 Report/AUDIT_REPORT*.json/.md → 任务标记 completed
         │
         ▼（异步，不影响完成判定）
平台扫描 Report/ 目录 → 上传到 MinIO → 解析漏洞 → 写入漏洞数据库
```

**解析流程：**
1. Phase 1：调用 `audit-report-parser` skill 解析报告，提取结构化漏洞数据
2. Phase 2（Phase 1 失败时）：通用 AI 解析，输出包含 title/type 等字段的 JSON
3. 解析结果写入漏洞数据库，可在 **漏洞管理** 页面查看

---

## 第二章 概述

### 2.1 什么是 AgentHarness

AgentHarness 是开发者交付给平台的 **Agent 工程包**。它是一个 ZIP 压缩包（或文件夹），包含 Agent 运行所需的全部文件：配置、Skills、脚本、提示词等。

平台接收 AgentHarness 后：
1. 将文件存储到对象存储 S3 桶
2. 自动扫描并注册其中的 Skills
3. 在任务执行时将工程包下载到工作空间，启动 Agent 进程

### 2.2 支持的执行引擎

| 引擎 | 说明 | 适用场景 |
|------|------|---------|
| `claudecode` | 基于 Claude Code CLI 的 Agent | 通用代码分析、安全审计 |
| `opencode` | 基于 OpenCode 的 Agent | 需要自定义 Agent 配置的场景 |
| `agentflow` | AgentFlow 可视化管道 | 多步骤编排工作流（对接中，暂不支持） |

---

## 第三章 工程包结构

### 3.1 claudecode 引擎（推荐）

```
my-agent.zip
├── skills/                     # Skill 目录（自动注册）
│   ├── sql-injection/
│   │   ├── SKILL.md            # 必须：Skill 定义文件
│   │   └── examples/           # 可选：示例文件
│   └── xss-detection/
│       └── SKILL.md
└── .claude/                    # 可选：Claude Code 配置
    ├── CLAUDE.md               # Agent 行为指令（项目级）
    ├── agents/                 # 可选：自定义 Agent 定义
    │   └── security-auditor.md # 自动识别为默认智能体
    └── commands/               # 可选：自定义命令
        └── nazhua-audit.md     # 自动识别为启动命令
```

**自动识别机制：** 上传 ZIP 或文件夹时，平台会自动扫描 `.claude/agents/*.md` 和 `.claude/commands/*.md`，填充"默认智能体名称"和"启动命令"字段。

`claudecode` 引擎不需要 `opencode.json`。Agent 名称和启动指令通过平台的"默认智能体名称"和"启动命令"字段配置。

### 3.2 opencode 引擎

```
my-agent.zip
├── opencode.json               # 必须：Agent 配置文件
├── instruction.txt             # 可选：默认指令（可被平台覆盖）
├── skills/
│   └── <skill-name>/
│       └── SKILL.md
└── scripts/                    # 可选：辅助脚本
    └── setup.sh
```

平台会自动从 `opencode.json` 中读取 `default_agent` 字段作为默认智能体名称。

### 3.3 agentflow 引擎（对接中，暂不支持）

```
my-pipeline.zip
├── pipeline.py                 # 默认管道入口（或自定义名称）
├── requirements.txt
└── skills/
    └── <skill-name>/
        └── SKILL.md
```

启动命令格式：`agentflow run pipeline.py`

---

## 第四章 平台交互说明

### 4.1 启动命令（startCommand）

`startCommand` 是 Agent 收到的**初始提示词**，即任务的核心指令。

**优先级：**
```
AgentApp.startCommand > 用户创建任务时填写的 notes
```

**建议写法（claudecode 引擎）：**
```
/security-audit
```
或
```
请对 vlu_scan_code 目录中的代码进行全面的安全审计，重点关注 OWASP Top 10 漏洞。
审计完成后，将结果写入 Report/AUDIT_REPORT.md。
```

**建议写法（opencode 引擎）：**
```
请使用 sql-injection-detector skill 分析 vlu_scan_code 目录中的所有 Java 文件，
找出所有 SQL 注入风险点，输出到 Report/AUDIT_REPORT.json。
```

### 4.2 输入文件校验（inputRequirements）

如果你的 Agent 对输入文件有特定要求，可以在 `inputRequirements` 字段填写自然语言描述。平台会在任务创建时用 LLM 自动校验用户上传的文件结构。

**示例：**

```
必须包含 pom.xml 或 build.gradle，以及 src/ 目录。
不接受纯前端项目（仅含 package.json 无 Java 源码）。
注意：如非必要，尽量不要在此处限制过于严格；一些校验规则优先在Harness工程中写代码实现，如文件格式过滤等，减小模型负载
```

校验失败时，任务创建会被拒绝，并向用户返回 LLM 给出的原因。

**注意：** 如果平台未配置文件校验模型，此字段会被忽略，任务照常创建。

### 4.3 默认智能体名称（defaultAgentName）

对于 `opencode` 引擎，此字段对应 `opencode.json` 中的 `default_agent`，用于 ACP 协议的 `createSession()` 调用。

对于 `claudecode` 引擎，此字段对应 `.claude/agents/{name}.md` 文件名（自动识别），用于指定默认 Agent。

### 4.4 上传 AgentHarness

1. 进入 **Agent应用开发** 页面
2. 点击 **创建新应用**
3. 填写表单：

| 字段 | 说明 |
|------|------|
| 应用名称 | 唯一标识，如 `java-security-auditor` |
| 使用引擎 | 选择 `claudecode` / `opencode` / `agentflow` |
| AgentHarness 文件 | 上传 ZIP 文件或选择文件夹（支持 .zip/.rar/.7z/.tar.gz） |
| 默认智能体名称 | 自动识别：opencode 从 `opencode.json` 读取，claudecode 从 `.claude/agents/*.md` 提取 |
| 启动命令 | 任务指令，claudecode 支持从 `.claude/commands/*.md` 自动建议 |
| 文件结构要求 | 可选，用于文件结构校验（自然语言描述） |

4. 点击 **创建**，平台自动解析并注册 Skills

---

## 第五章 执行流程

### 5.1 完整执行链路

```
用户上传源码包 → 创建任务
        │
        ▼
平台从 MinIO 下载 AgentHarness 到工作空间根目录
解压用户源码到工作空间的 vlu_scan_code/ 子目录（与 Harness 隔离）
（可选）LLM 校验文件结构是否符合 inputRequirements
        │
        ▼
任务进入执行队列（Redis Stream）
        │
        ▼
Worker 节点接收任务
注入环境变量（ANTHROPIC_API_KEY、ANTHROPIC_MODEL 等）
启动 Agent 进程（claudecode 或 opencode）
通过 ACP 协议发送 instruction
        │
        ▼
Agent 在工作空间中执行
读取源码、调用 Skills、生成报告
        │
        ▼
Agent 进程退出
Worker 检测 Report/AUDIT_REPORT*.json/.md
        │
        ├─ 检测到稳定报告 → terminate 残留进程 → 任务标记 completed
        └─ 未检测到报告 → 任务标记 failed
        │
        ▼（completed 后异步触发）
平台解析 Report/ 目录 → 漏洞入库
```

---

## 第六章 常见问题

### Q1: 任务执行时找不到工程包文件

平台在执行时会从 MinIO 重新下载工程包。如果下载失败，检查：
- AgentApp 是否正常创建（`agentHarnessPath` 字段不为空）
- MinIO 连接是否正常

### Q2: 输入文件校验总是失败

- 检查 `inputRequirements` 描述是否过于严格
- 确认平台已配置文件校验模型（`opencodeConfig.fileValidationModel`）
- 临时清空 `inputRequirements` 字段可跳过校验
- 空 ZIP 包会被直接判定为不合格

### Q3: 任务完成后但漏洞没有被解析入库

- 确认报告文件输出到了工作空间的 `Report/` 目录
- 目录必须存在且包含文件，平台才会触发解析
- 检查平台是否配置了 `build` agent 及 `audit-report-parser` skill
- 解析有两阶段：Phase 1 使用 skill，Phase 2 AI 兜底，任一成功即可入库

### Q4: 任务一直处于 running 状态不完成

- **最常见原因：** Agent 未输出 `Report/AUDIT_REPORT*.json/.md`
- 确认 Agent 的启动命令中包含生成报告的指令
- 确认报告目录是 `Report/`（大写 R），不是 `report/`
- 确认文件名以 `AUDIT_REPORT` 开头，后缀是 `.json` 或 `.md`
- 确认文件非空且已完全写入（文件正在写入时不判定完成）

### Q5: claudecode 引擎如何使用 CLAUDE.md

将 `.claude/CLAUDE.md` 放在工程包根目录，Claude Code 会自动加载它作为项目级指令。这是配置 Agent 行为的推荐方式。

### Q6: claudecode 如何配置多个 Agent

在 `.claude/agents/` 目录下放置多个 `.md` 文件，每个文件定义一个 Agent。上传时平台会自动识别并列出所有 Agent，供选择作为默认 Agent。

### Q7: claudecode 如何配置自定义命令

在 `.claude/commands/` 目录下放置 `.md` 文件，上传时平台会自动识别并建议启动命令格式为 `/project:{commandName}`。

---

## 附录：opencode.json 配置参考

仅 `opencode` 引擎需要此文件。

```json
{
  "default_agent": "security-auditor",
  "provider": {
    "anthropic": {
      "api_key": "${ANTHROPIC_API_KEY}"
    }
  },
  "model": "${ANTHROPIC_MODEL}",
  "command": {
    "security-auditor": {
      "template": "你是一名专业的代码安全审计专家。请分析 vlu_scan_code 目录中的代码，找出所有安全漏洞。审计完成后，将结果写入 Report/AUDIT_REPORT.md。",
      "description": "安全审计 Agent"
    }
  }
}
```

**注意：** `api_key` 和 `model` 字段会在运行时被平台注入的环境变量覆盖，无需在文件中硬编码真实值。

---

## 附录：快速检查清单

上传前确认：

- [ ] 工程包为 ZIP 格式（或通过文件夹上传，支持 .zip/.rar/.7z/.tar.gz）
- [ ] Skills 位于 `skills/{name}/SKILL.md` 路径
- [ ] 每个 SKILL.md 包含 `name` 和 `description`（frontmatter 或正文）
- [ ] `startCommand` 已填写（包含生成 AUDIT_REPORT 的指令）
- [ ] `claudecode` 引擎：`.claude/CLAUDE.md` 已配置 Agent 行为
- [ ] `claudecode` 引擎：`.claude/agents/` 和 `.claude/commands/` 已配置（可被自动识别）
- [ ] `opencode` 引擎：`opencode.json` 已配置 `default_agent`
- [ ] **报告输出到 `Report/` 目录（大写 R）**
- [ ] **文件名以 `AUDIT_REPORT` 开头**
- [ ] **后缀为 `.json` 或 `.md`（其他后缀不触发完成判定）**
- [ ] Agent 指令中引用待扫描代码时使用 `vlu_scan_code/` 目录