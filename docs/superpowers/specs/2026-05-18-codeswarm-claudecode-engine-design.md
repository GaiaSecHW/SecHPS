# CodeSwarm Worker Claude Code 引擎适配设计

> 日期: 2026-05-18
> 状态: Draft
> 范围: Worker 引擎层 + 平台调试页 + 日志补全

## 1. 背景

CodeSwarm Worker 目前仅支持 OpenCode 作为 AI Agent 执行引擎。需要增加 Claude Code 引擎支持，使平台能够根据任务配置选择不同的 Agent 引擎执行。

**现状问题：**
- `TaskPayloadSchema` 已定义 `engine: z.enum(['opencode', 'claudecode'])`，但 Worker 始终走 opencode 路径
- `ACPClient` 硬编码 spawn `opencode acp`（line 100 的 args 固定）
- `ACPClientConfig` 已有 `command` 字段但 args 不可配置
- `EnvironmentFactory` 仅生成/读取 `opencode.json`
- 调试面板无引擎选择器
- `ModelConfig.apiBaseUrl` 未传递到 Worker（execute route select 未包含）

## 2. 技术方案

### 2.1 核心决策：复用 ACP 协议

使用 `@zed-industries/claude-code-acp`（Zed 官方维护，npm v0.16.2）作为 Claude Code 的 ACP agent 进程，复用现有 `ACPClient`（基于 `@agentclientprotocol/sdk`）的全部协议逻辑。

**理由：**
- ACP 是标准协议，`opencode acp` 和 `claude-code-acp` 发出相同的事件类型
- 现有 `ACPClient` 已预留 `command` 参数（`acp/src/index.ts:42`），只需新增 args 覆盖
- 避免新建 ClaudeCodeClient + stream-json 解析（省 ~300 行代码）
- 未来扩展 Codex 等引擎只需加一行映射

**各引擎 ACP 启动方式：**

| Engine | command | args |
|--------|---------|------|
| opencode | `opencode` | `['acp', '--pure', '--print-logs', '--log-level', 'DEBUG', '--cwd', dir]` |
| claudecode | `claude-code-acp` | `['--cwd', dir]` |

### 2.2 模型注入方案

采用环境变量注入（进程级隔离），在 `ProcessManager.runAgent()` 中构造 `mergedEnv` 后传入 `ACPClient.start({ env })`：

| 配置项 | 环境变量 | 来源 | 注入位置 |
|--------|----------|------|----------|
| API Key | `ANTHROPIC_API_KEY` | `payload.apiKey` | `process-manager.ts` mergedEnv |
| Model | `ANTHROPIC_MODEL` | `payload.model` | `process-manager.ts` mergedEnv |
| Base URL | `ANTHROPIC_BASE_URL` | `payload.apiBaseUrl`（新增） | `process-manager.ts` mergedEnv |

**为什么不用 settings.json：**
- 不碰工作区文件，多 Worker 并行无冲突（每个 spawn 是独立进程，env 互不干扰）
- 进程结束即消失，无副作用
- Claude Code 不支持运行时模型切换，启动前注入已足够

### 2.3 apiBaseUrl 端到端数据流

当前 `ModelConfig.apiBaseUrl` 存在于数据库但未传递到 Worker。需要补全整条链路：

```
ModelConfig.apiBaseUrl (DB)
  → execute/route.ts: ModelConfig select 新增 apiBaseUrl: true
    → CodeswarmTask INSERT 新增 apiBaseUrl 字段
      → dispatch/route.ts: 从 task 记录读取传入 payload
        → TaskPayloadSchema: 新增 apiBaseUrl 字段
          → daemon.ts → processManager.runAgent(): 读取 payload.apiBaseUrl
            → mergedEnv.ANTHROPIC_BASE_URL = apiBaseUrl
              → ACPClient.start({ env: mergedEnv })
```

### 2.4 事件流兼容性

`claude-code-acp` 作为 ACP 兼容 agent，应发出标准 ACP 事件：
- `agent_message_chunk` → 前端实时日志
- `tool_call` → 工具调用展示
- `tool_call_update` → 工具结果
- `usage_update` → token 用量

**兜底处理：** `ACPClient.handleSessionUpdate()` 的 `default` 分支已有 `console.log`，增加 `raw` 事件回调上报，使未知事件类型也能出现在前端日志中（方便调试 claude-code-acp 的事件差异）。

**验证计划：** 在 Worker 节点安装 `claude-code-acp` 后，通过 TaskDebugPanel 提交一个简单指令，观察 SSE 事件流是否正常到达前端。如果事件格式有差异，在 `handleSessionUpdate()` 中适配。

### 2.5 LocalTestPanel 设计决策

`LocalTestPanel` 是**绕过 Worker 的本地测试工具**，不走 ACP 协议，直接 spawn agent CLI。这是现有设计（opencode 也是直接 spawn `opencode run --command`）。因此 claudecode 模式也直接 spawn `claude` CLI：

| LocalTest 引擎 | spawn 命令 |
|----------------|------------|
| opencode | `opencode run --agent build "指令"` |
| claudecode | `claude -p "指令" --output-format stream-json --verbose` |

这与 Worker 端的 ACP 方案不同，但保持了 LocalTestPanel 的定位一致性（轻量级本地测试，不依赖 Worker 基础设施）。

## 3. 改动清单

### 3.1 Worker 端

#### 3.1.1 `codeswarm/packages/acp/src/index.ts` — ACPClient args 可配置化

改动点：
- `ACPClientConfig` 接口新增 `args?: string[]`
- `start()` 方法 line 85-100：当 `config.args` 存在时使用自定义 args，否则走 opencode 默认值
- Windows 平台：`claude-code-acp` 通过 npm global 安装，在 Windows 下的路径为 `APPDATA/npm/claude-code-acp.cmd`，需在 line 91-96 的 Windows 分支中增加 claudecode 路径解析
- `handleSessionUpdate()` line 288-291：default 分支增加 `this.eventHandlers.raw?.(JSON.stringify(update))`

#### 3.1.2 `codeswarm/packages/worker/src/process-manager.ts` — 引擎分支 + 环境变量注入

改动点：
- `runAgent()` line 124-204：根据 engine 参数构造不同的 ACPClientConfig：
  - opencode: `command` 不传, `args` 不传（走 ACPClient 默认值）
  - claudecode: `command: 'claude-code-acp'`, `args: ['--cwd', workspace]`
- line 126-137 的 mergedEnv 构造中增加：
  ```
  if (model) mergedEnv.ANTHROPIC_MODEL = model;
  if (apiBaseUrl) mergedEnv.ANTHROPIC_BASE_URL = apiBaseUrl;
  ```
  注意：`apiBaseUrl` 需要从 `runAgent()` 参数传入（新增参数）
- 移除 line 202-203 的 `@ts-expect-error`，改为使用正式的 `command`/`args` 字段

#### 3.1.3 `codeswarm/packages/worker/src/environment.ts` — claudecode 环境适配

改动点：
- `build()` 签名新增 `engine?: 'opencode' | 'claudecode'` 参数（从 payload.engine 传入）
- claudecode 模式下的行为变化：
  - NFS passthrough 模式：跳过 opencode.json 读写（line 98-191 的整块），不修改工作区配置文件
  - Local workspace 模式：跳过 opencode.json 生成（line 236-258），不创建 `.opencode/skills/` 目录
  - instruction.txt 读取逻辑保持不变（两种引擎共用）
- `BuildResult` 新增 `engine?: 'opencode' | 'claudecode'`

#### 3.1.4 `codeswarm/packages/worker/src/daemon.ts` — 传递 engine + apiBaseUrl

改动点：
- `executeTask()` line 219：`envFactory.build(payload, onProgress, payload.engine || 'opencode')`
- `executeTask()` line 306：`processMgr.runAgent()` 新增 `apiBaseUrl` 参数，从 `payload.apiBaseUrl` 传入
- 日志补全：engine 选择、apiBaseUrl 注入的日志

### 3.2 类型定义

#### 3.2.1 `codeswarm/packages/types/src/index.ts` — TaskPayloadSchema 扩展

新增字段：
```
apiBaseUrl: z.string().optional()
```

### 3.3 平台端 API

#### 3.3.1 `src/app/api/task-builder/tasks/[id]/execute/route.ts` — 补全 apiBaseUrl

- line 54-58 ModelConfig select 新增 `apiBaseUrl: true`
- TaskPayload 构造时传入 `apiBaseUrl: agentApp?.ModelConfig?.apiBaseUrl || undefined`
- CodeswarmTask INSERT 语句新增 `apiBaseUrl` 字段

#### 3.3.2 `src/app/api/codeswarm/tasks/[taskId]/dispatch/route.ts` — 传递 apiBaseUrl

- 从 task 记录读取 `apiBaseUrl` 传入 payload

### 3.4 前端调试页面

#### 3.4.1 `src/components/codeswarm/TaskDebugPanel.tsx` — 引擎选择器

- form state 新增 `engine: 'opencode'`
- 引擎下拉选择 UI：`opencode` / `claudecode`
- command 模式预览文本根据引擎切换：
  - opencode: `opencode run --command ...`
  - claudecode: `claude -p ...`
- payload 传入 `engine` 字段

#### 3.4.2 `src/components/codeswarm/LocalTestPanel.tsx` — 引擎选择

- state 新增 `engine: 'opencode'`
- 新增引擎选择 UI
- 传递 `engine` 参数到 local-test API

#### 3.4.3 `src/app/api/codeswarm/local-test/route.ts` — claudecode 分支

- `LocalTestRequest` 新增 `engine?: 'opencode' | 'claudecode'`
- `executeTaskAsync()` 根据 engine 分支：
  - opencode: 现有逻辑不变
  - claudecode: spawn `claude -p "指令" --output-format stream-json --verbose`，解析 stream-json 输出

## 4. 文件改动总览

| # | 文件 | 类型 | 改动量 |
|---|------|------|--------|
| 1 | `codeswarm/packages/acp/src/index.ts` | 修改 | ~30行 |
| 2 | `codeswarm/packages/worker/src/process-manager.ts` | 修改 | ~25行 |
| 3 | `codeswarm/packages/worker/src/environment.ts` | 修改 | ~15行 |
| 4 | `codeswarm/packages/worker/src/daemon.ts` | 修改 | ~15行 |
| 5 | `codeswarm/packages/types/src/index.ts` | 修改 | ~2行 |
| 6 | `src/app/api/task-builder/tasks/[id]/execute/route.ts` | 修改 | ~8行 |
| 7 | `src/app/api/codeswarm/tasks/[taskId]/dispatch/route.ts` | 修改 | ~3行 |
| 8 | `src/components/codeswarm/TaskDebugPanel.tsx` | 修改 | ~30行 |
| 9 | `src/components/codeswarm/LocalTestPanel.tsx` | 修改 | ~20行 |
| 10 | `src/app/api/codeswarm/local-test/route.ts` | 修改 | ~50行 |

## 5. Worker 端安装要求

Claude Code 引擎的 Worker 节点需安装：
```bash
npm i -g @anthropic-ai/claude-code         # Claude Code CLI（claude-code-acp 的依赖）
npm i -g @zed-industries/claude-code-acp   # ACP 桥接（spawn 的目标进程）
```

**安装验证：**
```bash
claude --version                           # 验证 Claude Code CLI
npx @zed-industries/claude-code-acp --help  # 验证 ACP 桥接
```

**未安装时的错误提示：**
ACPClient spawn 失败时（ENOENT），应返回明确错误：`"claude-code-acp not found. Install: npm i -g @zed-industries/claude-code-acp"`

## 6. 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| `claude-code-acp` 事件类型与 opencode 不完全一致 | `handleSessionUpdate` default 分支兜底 + raw 事件上报；上线前做事件流验证 |
| `claude-code-acp` 版本更新导致 API 变化 | 锁定版本，测试后升级 |
| `apiBaseUrl` 为空时注入 undefined | 仅在 apiBaseUrl 有值时设置 ANTHROPIC_BASE_URL |
| Windows 路径问题 | claude-code-acp 的 Windows npm 路径需实测确认；fallback 使用 shell:true |
| Claude Code CLI 未安装 | ACPClient spawn 失败时返回明确错误信息和安装指引 |

## 7. 本次不做的范围（Future Work）

- **Worker 引擎能力声明**：在 `AgentNodeSchema` 增加 `supportedEngines` 字段，使调度器能根据 Worker 安装的引擎分配任务
- **MCP 配置传递**：Claude Code 的 MCP 配置方式（settings.json vs CLI args）需进一步调研，本次仅通过 env 注入模型配置
- **运行时模型切换**：Claude Code 不支持，如需要必须重建进程，本次不做
- **Codex 引擎支持**：架构已预留，待需要时加一行映射即可
