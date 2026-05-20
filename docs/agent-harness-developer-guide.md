# Agent 应用开发手册

> **版本**: v2.0  
> **适用对象**: Agent 开发者  
> **文档性质**: 开发指南

---

## 第一章 概述

### 1.1 什么是 AgentHarness

AgentHarness 是开发者交付给平台的 **Agent 工程包**。它是一个 ZIP 压缩包（或文件夹），包含 Agent 运行所需的全部文件：配置、Skills、脚本、提示词等。

平台接收 AgentHarness 后：
1. 将文件存储到对象存储（MinIO）
2. 自动扫描并注册其中的 Skills
3. 在任务执行时将工程包下载到工作空间，启动 Agent 进程

### 1.2 支持的执行引擎

| 引擎 | 说明 | 适用场景 |
|------|------|---------|
| `claudecode` | 基于 Claude Code CLI 的 Agent | 通用代码分析、安全审计 |
| `opencode` | 基于 OpenCode 的 Agent | 需要自定义 Agent 配置的场景 |
| `agentflow` | AgentFlow 可视化管道 | 多步骤编排工作流 |

---

## 第二章 工程包结构

### 2.1 claudecode 引擎（推荐）

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

### 2.2 opencode 引擎

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

### 2.3 agentflow 引擎

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

## 第三章 平台输入管理

### 3.1 输入来源

任务执行时，Agent 工作空间包含以下内容：

```
{workspacePath}/
├── <AgentHarness 全部文件>     # 从 MinIO 下载
├── <用户上传的待扫描文件包>    # ZIP 解压后的文件，与 Harness 并列
└── instruction.txt             # 执行指令（如存在）
```

用户上传的 ZIP 文件会被**直接解压**到工作空间根目录，与 AgentHarness 文件并列。

### 3.2 启动命令（startCommand）

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
请对工作空间中的代码进行全面的安全审计，重点关注 OWASP Top 10 漏洞。
审计完成后，将结果写入 AUDIT_REPORT.md。
```

**建议写法（opencode 引擎）：**
```
请使用 sql-injection-detector skill 分析工作空间中的所有 Java 文件，
找出所有 SQL 注入风险点，输出到 reports.jsonl。
```

### 3.3 输入文件校验（inputRequirements）

如果你的 Agent 对输入文件有特定要求，可以在 `inputRequirements` 字段填写自然语言描述。平台会在任务创建时用 LLM 自动校验用户上传的文件结构。

**示例：**
```
必须包含 pom.xml 或 build.gradle，以及 src/ 目录。
不接受纯前端项目（仅含 package.json 无 Java 源码）。
```

校验失败时，任务创建会被拒绝，并向用户返回 LLM 给出的原因。

**注意：** 如果平台未配置文件校验模型，此字段会被忽略，任务照常创建。

**技术细节：**
- 平台从系统配置的 `opencodeConfig.fileValidationModel` 获取校验模型
- 校验模型支持 Anthropic（`/v1/messages`）和 OpenAI 兼容格式（`/chat/completions`）
- 推理模型（如 MiniMax-M2.5）的 `<think>...</think>` 思考标签会被自动剥离
- `max_tokens` 设置为 1024，确保推理过程有足够空间输出 YES/NO 判断
- 空 ZIP 包（无文件）会被直接判定为不合格

### 3.4 默认智能体名称（defaultAgentName）

对于 `opencode` 引擎，此字段对应 `opencode.json` 中的 `default_agent`，用于 ACP 协议的 `createSession()` 调用。

对于 `claudecode` 引擎，此字段对应 `.claude/agents/{name}.md` 文件名（自动识别），用于指定默认 Agent。

### 3.5 租户绑定

创建 Agent 应用时，管理员和 ICSL 租户用户需要选择绑定租户：
- 选择具体租户 → 仅该租户可见
- 选择"所有租户共享" → 对所有租户公开（`isPublic=true`）
- 普通用户创建的应用自动绑定到自己的租户

### 3.6 模型配置

Agent 使用的模型**由用户在创建任务时选择**，与 AgentApp 本身无关。AgentApp 不包含模型配置字段。

**模型来源：**

平台管理员在 **模型管理** 页面配置 `ModelConfig`，每条配置包含：

| 字段 | 说明 |
|------|------|
| API 地址（apiBaseUrl） | 模型服务端点，如 `https://api.anthropic.com` |
| API Key（apiKey） | 调用凭证，存储在平台数据库中 |
| 模型列表（models） | 该配置下可用的模型名称，如 `["claude-sonnet-4-6"]` |
| 默认（isDefault） | 勾选后在任务创建时自动预选 |

**模型流转链路：**

```
用户在任务创建时选择模型
        │
        ▼
TaskInstance.modelId + modelName（存储选择快照）
        │
        ▼
执行时读取 ModelConfig.apiKey + apiBaseUrl
        │
        ▼
Worker 注入环境变量：
  ANTHROPIC_MODEL    = modelName
  ANTHROPIC_API_KEY  = apiKey
  ANTHROPIC_BASE_URL = apiBaseUrl
        │
        ▼
Agent 进程使用上述环境变量调用模型
```

**注意：** 如果任务未关联任何模型配置，Agent 进程会回退到其自身的默认模型。

### 3.7 任务名称（自动生成）

任务名称由系统自动生成，格式为：`{用户名}_{租户名}_{时间戳}`，用户不可修改。
例如：`admin_public_1747707000000`

---

## 第四章 平台输出管理

平台有两条独立的输出收集机制，互不冲突，可同时使用。

### 4.1 任务报告摘要（Worker 直接读取）

Agent 进程退出后，Worker 收集 stdout 全部输出作为 `executionResult`，在任务详情页展示。

### 4.2 漏洞结构化入库（平台异步解析）

任务完成后，平台会异步触发漏洞解析流程，将漏洞信息结构化写入漏洞数据库，可在 **漏洞管理** 页面查看。

**解析流程：**

```
Agent 完成 → Worker 回调 /api/codeswarm/worker/result
        │
        ▼
平台扫描 {workspace}/Report/ 或 {workspace}/report/ 目录
将目录内所有文件上传到 MinIO（vulnerability-report 桶）
路径: {productName}/{taskName}/report/
        │
        ▼
Phase 1: 调用 opencode run --agent build "执行 audit-report-parser skill"
解析报告内容，提取结构化漏洞数据
        │
        ▼（Phase 1 失败时）
Phase 2: Fallback → opencode run --agent build "读取报告提取JSON"
通用 AI 解析，输出包含 title, type, description 等字段的 JSON
        │
        ▼
上传漏洞原始文件到 MinIO（vulnerability-file 桶）
        │
        ▼
POST /api/v1/vulnerabilities 写入漏洞数据库
更新 CodeswarmTask.reportContent 为解析结果摘要
```

**关键约定：**

- Agent 必须将报告文件输出到工作空间的 **`Report/`** 目录（大写 R）或 **`report/`** 目录（小写 r），平台才能发现并上传
- 目录内文件格式不限，平台通过 `audit-report-parser` skill 调用 LLM 解析，支持 Markdown、JSON、纯文本等
- 每条漏洞需包含以下字段供 LLM 提取：

| 字段 | 说明 |
|------|------|
| `title` | 漏洞标题（必须） |
| `type` | 漏洞类型（必须） |
| `description` | 漏洞描述 |
| `severity` | 严重程度：`HIGH` / `MEDIUM` / `LOW` / `INFO` |
| `cwe` | CWE 编号，如 `CWE-89` |
| `location` | 漏洞位置（文件名 + 行号） |
| `POC` | 漏洞验证代码或步骤 |
| `fixSuggestion` | 修复建议 |
| `rawReport` | 原始报告文件路径（分号分隔，会自动上传到 MinIO） |
| `vulnerable` | 是否确认为漏洞（boolean） |

**解析容错：** 平台采用两阶段解析策略，Phase 1 使用 `audit-report-parser` skill，Phase 2 使用通用 AI 直接解析报告文件。任一阶段成功即可入库。

**超时保护：** 解析流程超时时间为 600 秒，超时后强制终止。

**注意：** 漏洞入库依赖平台配置的 `build` agent 及 `audit-report-parser` skill，如未配置则跳过此步骤。

### 4.3 漏洞模式库关联（attack_pattern）

SKILL 创建时可选择关联到漏洞模式库的一个叶子节点。模式库数据存储在 `attack_pattern` 表中，支持多级层级结构（最多 5 层）：

```
Level 1 (根分类)    Level 2 (子分类)    Level 3 (具体类型)    Level 4 (场景)    Level 5 (攻击模式)
├─ OWASP Top 10     ├─ A03 注入         ├─ SQL 注入          ├─ 基于错误的     ├─ OR 1=1 绕过
│                   │                    │                    │               └─ UNION SELECT 绕过
│                   │                    └─ 命令注入          ├─ OS 命令注入
│                   │                                        └─ SSTI 模板注入
├─ MITRE ATT&CK     ├─ 初始访问          ├─ 供应链攻击        ├─ 依赖注入攻击   ├─ NPM 包投毒
│                   │                    │                    │               └─ Maven 依赖劫持
│                   │                    └─ 网络钓鱼          ├─ 鱼叉式钓鱼     └─ 鱼叉式钓鱼-附件
└─ CWE 漏洞库       ├─ CWE-79 XSS       ├─ 存储型 XSS        ├─ 评论区         ├─ 恶意 HTML 注入
                    │                    │                    └─ 用户资料       └─ SVG 事件处理器
                    └─ CWE-89 SQL 注入  └─ Tautology SQL 注入 └─ 登录绕过
```

SKILL 必须关联到叶子节点（Level 3/4/5），非叶子节点不可选择。

---

## 第五章 上传 AgentHarness

### 5.1 通过平台 UI 上传

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
| 租户 | 管理员/ICSL 用户选择绑定租户或公开共享 |

4. 点击 **创建**，平台自动解析并注册 Skills

### 5.2 通过 API 上传

```bash
curl -X POST https://{platform}/api/agent-apps \
  -H "Authorization: Bearer {token}" \
  -F "name=java-security-auditor" \
  -F "engine=claudecode" \
  -F "defaultAgentName=security-auditor" \
  -F "startCommand=/security-audit" \
  -F "inputRequirements=必须包含 pom.xml 和 src/ 目录" \
  -F "isPublic=false" \
  -F "agentHarnessFileType=archive" \
  -F "agentHarnessFile=@./my-agent.zip"
```

响应：
```json
{
  "app": {
    "id": "app-xxxx",
    "name": "java-security-auditor",
    "engine": "claudecode",
    "agentHarnessPath": "app-xxxx/",
    "createdAt": "2026-05-19T..."
  }
}
```

### 5.3 更新工程包

```bash
curl -X PUT https://{platform}/api/agent-apps/{appId} \
  -H "Authorization: Bearer {token}" \
  -F "name=java-security-auditor" \
  -F "engine=claudecode" \
  -F "agentHarnessFileType=archive" \
  -F "agentHarnessFile=@./my-agent-v2.zip"
```

更新时，旧的 MinIO 文件会被删除并替换。

---

## 第六章 执行流程详解

### 6.1 完整执行链路

```
用户上传源码包 → 创建任务
        │
        ▼
平台从 MinIO 下载 AgentHarness 到工作空间
解压用户源码到同一工作空间
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
Worker 收集 stdout + 报告文件
回调平台 /api/codeswarm/worker/result
        │
        ▼
平台异步触发漏洞解析（Phase 1: skill 解析 → Phase 2: AI fallback）
漏洞报告上传到 MinIO，结构化数据写入漏洞数据库
任务状态更新为 completed
```

### 6.2 工作空间环境变量

Agent 进程启动时，平台注入以下环境变量：

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | 模型 API Key |
| `ANTHROPIC_MODEL` | 模型名称，如 `claude-sonnet-4-6` |
| `ANTHROPIC_BASE_URL` | 自定义 API 地址（如有） |

对于 `claudecode` 引擎，还会合并 `~/.claude/settings.json` 中的 `env` 配置。

### 6.3 实时事件流

任务执行期间，可通过 SSE 接口订阅实时事件：

```
GET /api/codeswarm/tasks/{taskId}/stream
```

事件格式：
```json
{"type": "agent_message_chunk", "data": {"content": "正在分析..."}, "timestamp": "..."}
{"type": "task_complete", "state": "completed", "result": "审计完成，发现 3 个漏洞"}
```

### 6.4 任务报告文件下载

任务完成后，可通过 API 获取漏洞报告文件的 MinIO 下载链接：

```
GET /api/task-builder/tasks/{taskId}/report-files
```

响应：
```json
{
  "hasReport": true,
  "files": [
    { "url": "https://minio-server/vulnerability-report/.../report.md?X-Amz-...", "name": "report.md" }
  ]
}
```

---

## 第七章 opencode.json 配置参考

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
      "template": "你是一名专业的代码安全审计专家。请分析工作空间中的代码，找出所有安全漏洞。",
      "description": "安全审计 Agent"
    }
  }
}
```

**注意：** `api_key` 和 `model` 字段会在运行时被平台注入的环境变量覆盖，无需在文件中硬编码真实值。

---

## 第八章 常见问题

### Q1: 任务执行时找不到工程包文件

平台在执行时会从 MinIO 重新下载工程包。如果下载失败，检查：
- AgentApp 是否正常创建（`agentHarnessPath` 字段不为空）
- MinIO 连接是否正常

### Q2: 输入文件校验总是失败

- 检查 `inputRequirements` 描述是否过于严格
- 确认平台已配置文件校验模型（`opencodeConfig.fileValidationModel`）
- 临时清空 `inputRequirements` 字段可跳过校验
- 空 ZIP 包会被直接判定为不合格

### Q3: 报告没有被解析入库

- 确认报告文件输出到了工作空间的 `Report/` 或 `report/` 目录（注意大小写）
- 目录必须存在且包含文件，平台才会触发解析
- 检查平台是否配置了 `build` agent 及 `audit-report-parser` skill（漏洞解析依赖此组合）
- 解析有两阶段：Phase 1 使用 skill，Phase 2 AI 兜底，任一成功即可入库

### Q4: claudecode 引擎如何使用 CLAUDE.md

将 `.claude/CLAUDE.md` 放在工程包根目录，Claude Code 会自动加载它作为项目级指令。这是配置 Agent 行为的推荐方式。

### Q5: claudecode 如何配置多个 Agent

在 `.claude/agents/` 目录下放置多个 `.md` 文件，每个文件定义一个 Agent。上传时平台会自动识别并列出所有 Agent，供选择作为默认 Agent。

### Q6: claudecode 如何配置自定义命令

在 `.claude/commands/` 目录下放置 `.md` 文件，上传时平台会自动识别并建议启动命令格式为 `/project:{commandName}`。

---

## 附录：快速检查清单

上传前确认：

- [ ] 工程包为 ZIP 格式（或通过文件夹上传，支持 .zip/.rar/.7z/.tar.gz）
- [ ] Skills 位于 `skills/{name}/SKILL.md` 路径
- [ ] 每个 SKILL.md 包含 `name` 和 `description`（frontmatter 或正文）
- [ ] `startCommand` 已填写（任务指令）
- [ ] `claudecode` 引擎：`.claude/CLAUDE.md` 已配置 Agent 行为
- [ ] `claudecode` 引擎：`.claude/agents/` 和 `.claude/commands/` 已配置（可被自动识别）
- [ ] `opencode` 引擎：`opencode.json` 已配置 `default_agent`
- [ ] 租户绑定已选择（或设置为公开共享）
- [ ] 报告摘要输出到 `reports.jsonl`（工作空间根目录，任务详情页展示）
- [ ] 漏洞报告文件输出到 `Report/` 目录（触发平台异步解析入库）
