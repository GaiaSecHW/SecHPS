# 任务完成检测设计方案

## 问题描述

ClaudeCode / opencode 引擎任务存在"虚假完成"现象：任务状态显示已完成，但 Report 目录为空，实际产物未就绪。

### 根因

ACP 协议的 `end_turn` 信号表示"本轮对话结束"，**不代表任务产物已生成**。这在主流系统中是一致共识：

| 系统 | `end_turn` / `stop` 的官方语义 |
|------|------------------------------|
| Anthropic Claude API | "Claude finished its response naturally" — 回应级信号 |
| OpenAI API | `finish_reason: "stop"` — 生成级信号 |
| ACP 协议 | "The language model finishes responding without requesting more tools" |
| Claude Agent SDK | `ResultMessage.subtype` 区分 success/error — end_turn 只是 loop 退出条件 |
| SWE-agent | 用 `<<SUBMISSION>>` 哨兵信号区分"对话结束"和"任务完成" |
| Devin | session 状态 `exit` + structured output 轮询独立验证交付物 |

Agent 可能在说完"我来开始扫描"后立即发送 `end_turn`，此时 Worker 误判任务完成，destroy 掉引擎进程并上报 `completed`，Report 目录仍为空。

### 进程生命周期关键事实

扫描器（CodeMap/Joern 等）是 Agent 进程的**子进程**（非 detached），不是独立进程：

```
Worker 进程
  └─ spawn('opencode acp') ← ACPClient，无 detached: true
      └─ Agent (opencode) 进程
          └─ 工具调用 (shell commands)
              └─ CodeMap/Joern 子进程 ← Agent 内部 spawn，非 detached
```

- **所有 spawn 调用都没有 `detached: true`**（全局搜索确认）
- ACPClient.destroy() 发 SIGTERM → 5秒后 SIGKILL，**只杀 Agent 进程本身，不杀进程组**
- Agent 被杀后，扫描器子进程成为孤儿进程，**最终也会消亡**
- **结论：Agent 进程必须保持存活，扫描器才能继续运行并写入 Report**

ACP 协议中 `end_turn` 后 **session 不关闭**，可以在同一 session 继续发送 prompt。当前代码 `end_turn → client.destroy()` 是过早销毁。

---

## 方案：end_turn 后保留 session，转入 Report 产物轮询模式

### 核心思路

`end_turn` 不再是任务完成的终点，而是**对话轮次结束的中间事件**。任务完成的唯一判定标准：**Report 目录有内容非空的 .json/.md 文件**。

### 关键判断点

| 事件 | 判断逻辑 | 行为 |
|------|---------|------|
| **end_turn 出现** | Agent 说"这轮对话结束了"，不代表任务完成 | **不 destroy client，不退出 runAgent**，转入 Report 轮询 |
| **Report 有内容非空的 .json/.md** | 扫描器已产出有效报告 → 任务真正完成 | destroy client → completed |
| **15分钟无 Agent 活动 + 无 Report** | Agent 虚假完成（扫描器没启动） | 同 session 发续推 prompt → Agent 继续工作 |
| **7天超时仍无 Report** | 任务彻底失败 | destroy client → failed |
| **任务被取消** | 用户主动取消 | destroy client → failed |

### 设计决策：process-manager.ts 必须改

| 维度 | 旧方案（不改 process-manager） | 新方案（改 process-manager） |
|------|-------------------------------|---------------------------|
| end_turn 处理 | destroy client + 返回 exitCode=0 | **不 destroy，不返回，转入轮询** |
| Agent 进程 | end_turn 后立刻死亡 | **保持存活**（扫描器子进程需要） |
| ACP session | end_turn 后立刻关闭 | **保持存活**（可同 session 续推） |
| Report 轮询时机 | 进程死后轮询（无意义） | **进程活着时轮询**（有意义） |
| 续推方式 | 仅在不活跃超时时触发 | end_turn 后也触发（15分钟无 Report → 续推） |

### 流程

```
executeTask()
  ├─ PHASE 1: build 环境
  ├─ PHASE 1.5: codedmap（并行）
  ├─ PHASE 2: runAgent() 运行 Agent（改造为事件驱动）
  │     │
  │     ├─ [正常交互] Agent 发 tool_use → 执行工具，继续
  │     │
  │     ├─ [对话轮结束] Agent 发 end_turn（出口 A 或出口 B）
  │     │     ├── 不 destroy client，不退出 runAgent
  │     │     ├── 启动 Report 轮询（每10分钟）
  │     │     │     ├── Report 有 .json/.md → destroy → 返回 { exitCode: 0, reportReady: true }
  │     │     │     ├── 15分钟无 Agent 活动 + 无 Report → 同 session 续推
  │     │     │     │     ├── Agent 继续 → 可能又发 end_turn → 继续轮询
  │     │     │     │     ├── Agent 不响应 → destroy → 返回 { exitCode: 0, reportReady: false }
  │     │     │     ├── 任务被取消 → destroy → 返回 { exitCode: 0, reportReady: false }
  │     │     │     └── 7天超时 → destroy → 返回 { exitCode: 0, reportReady: false }
  │     │
  │     └─ [不活跃超时] 15分钟无事件
  │           ├── 现有续推机制：cancel(方案A) → destroy(方案B)
  │           ├── 续推成功 → Agent 继续 → 可能发 end_turn → 进入轮询
  │           └── 续推失败（超过 CONTINUE_MAX_ATTEMPTS）→ destroy → exitCode=1
  │
  ├─ 状态判定:
  │     ├── cancelled → failed
  │     ├── exitCode ≠ 0 → failed
  │     ├── reportReady=true → 检查 stderr critical → completed/failed
  │     ├── reportReady=false + reportContent非空 + stdout有实质性输出 → completed（兜底）
  │     └── 其他 → failed
  ├─ collectReport() → 收集内容用于上报（仅 Report 目录 + .json/.md）
  └─ postResult() → Server 侧接收后：
        ├── finalState=completed → 触发漏洞解析管道
        └─ finalState=failed + reportContent非空 → 兜底触发漏洞解析管道
```

### Report 候选路径

与 Server 侧 `findReportFolder`（`src/lib/minio-vulnerability.ts`）**完全一致**：

```
{workspace}/Report
```

### 新增/修改环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REPORT_WAIT_TIMEOUT_MS` | `604800000`（7×24 小时） | Report 轮询最长时间，与任务整体超时一致 |
| `REPORT_POLL_INTERVAL_MS` | `600000`（10 分钟） | Report 轮询间隔 |
| `INACTIVITY_TIMEOUT_MS` | `900000`（15 分钟） | Agent 不活跃超时（现有，end_turn 后也适用） |
| `CONTINUE_MAX_ATTEMPTS` | `5` | 最大续推次数（现有） |

---

## 伪代码

### process-manager.ts 改动

#### 出口 A 改造（原第 332-337 行）

**旧逻辑**：
```typescript
if (stopReason === 'end_turn') {
  await client!.destroy();
  return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
}
```

**新逻辑**：
```typescript
if (stopReason === 'end_turn') {
  // end_turn = "本轮对话结束"，不代表任务完成
  // 不 destroy client，不退出 runAgent
  // 进入 Report 产物轮询模式，同时保留续推能力
  logger.info(LOG_MODULES.PROCESS, 'end_turn received - entering Report polling mode');

  // 启动 Report 轮询，与续推并行
  // 轮询期间 Agent 进程存活（扫描器子进程需要）
  // 如果 15 分钟无 Report 且无 Agent 活动 → 同 session 续推
  const reportResult = await this.waitForReportOrContinue(
    workspace, taskStartTime, taskTimeoutMs, taskId, state, client, ctx, onEvent
  );

  if (reportResult.reportReady) {
    logger.info(LOG_MODULES.PROCESS, `Report found: ${reportResult.reportPath}`);
    await client!.destroy();
    return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
  }

  // Report 轮询超时或取消 → 任务失败
  logger.warn(LOG_MODULES.PROCESS, 'Report polling ended without deliverable');
  await client!.destroy();
  return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
}
```

#### 出口 B 改造（原第 444-452 行）

**旧逻辑**：
```typescript
if (cancelStopReason === 'end_turn') {
  logger.info(LOG_MODULES.PROCESS, 'Cancel returned end_turn - task actually completed');
  await client.destroy();
  return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
}
```

**新逻辑**：同出口 A — 不 destroy，进入 Report 轮询模式。

#### 新增方法：waitForReportOrContinue

```typescript
/**
 * end_turn 后的核心逻辑：轮询 Report 产物，同时保留续推能力。
 *
 * 判断流程：
 * 1. 每 REPORT_POLL_INTERVAL_MS 检查 Report 目录是否有 .json/.md
 * 2. 如果 Report 出现 → 任务完成，返回 reportReady=true
 * 3. 如果 15 分钟无 Agent 活动 + 无 Report → 同 session 续推
 *    - 续推 prompt 告知 Agent "扫描器是否已启动？如果没有请继续"
 *    - Agent 可能继续工作 → 又发 end_turn → 轮询继续
 * 4. 如果续推后 Agent 不响应 → destroy，返回 reportReady=false
 * 5. 如果 7 天超时 → destroy，返回 reportReady=false
 * 6. 如果任务被取消 → destroy，返回 reportReady=false
 */
private async waitForReportOrContinue(
  workspace: string,
  taskStartTime: number,
  taskTimeoutMs: number,
  taskId: string,
  state: AgentState,
  client: ACPClient,
  ctx: ContinuationContext,
  onEvent?: AgentEventCallback,
): Promise<{ reportReady: boolean; reportPath: string | null }> {
  const REPORT_WAIT_TIMEOUT_MS = parseInt(process.env.REPORT_WAIT_TIMEOUT_MS || '604800000');
  const REPORT_POLL_INTERVAL_MS = parseInt(process.env.REPORT_POLL_INTERVAL_MS || '600000');
  const INACTIVITY_TIMEOUT_MS = parseInt(process.env.INACTIVITY_TIMEOUT_MS || '900000');

  const remainingMs = taskTimeoutMs - (Date.now() - taskStartTime);
  const timeoutMs = Math.min(REPORT_WAIT_TIMEOUT_MS, remainingMs);
  const deadline = Date.now() + timeoutMs;

  logger.info(LOG_MODULES.PROCESS,
    `waitForReportOrContinue: timeout=${timeoutMs/1000}s, pollInterval=${REPORT_POLL_INTERVAL_MS/1000}s`);

  let lastActivityTime = Date.now();  // end_turn 时间作为基准

  while (Date.now() < deadline) {
    // ===== 判断点 1: 任务是否被取消 =====
    if (this.cancelledTasks.has(taskId)) {
      logger.info(LOG_MODULES.PROCESS, `Report polling cancelled for task ${taskId}`);
      return { reportReady: false, reportPath: null };
    }

    // ===== 判断点 2: Report 目录是否有内容非空的 .json/.md =====
    const folder = this.findReportFolder(workspace);
    if (folder) {
      const reportFile = this.hasReportFile(folder);
      if (reportFile) {
        // Report 产物就绪 → 任务完成
        return { reportReady: true, reportPath: reportFile };
      }
    }

    // ===== 判断点 3: 是否超过 15 分钟无 Agent 活动 + 无 Report =====
    // 如果超过不活跃阈值，尝试同 session 续推
    const inactiveMs = Date.now() - lastActivityTime;
    if (inactiveMs >= INACTIVITY_TIMEOUT_MS) {
      logger.info(LOG_MODULES.PROCESS,
        `No Report and no Agent activity for ${inactiveMs/1000}s - sending continuation prompt`);

      onEvent?.({
        type: 'log_chunk',
        message: `15分钟无产物且无活动，发送续推 prompt...`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });

      // 同 session 续推 — ACP session 在 end_turn 后仍然存活
      const continuationPrompt = buildContinuationPrompt(ctx);
      try {
        const stopReason = await client.sendPrompt(continuationPrompt);

        if (stopReason === 'end_turn') {
          // Agent 又说"这轮对话结束了" → 继续轮询 Report
          lastActivityTime = Date.now();  // 重置不活跃计时
          logger.info(LOG_MODULES.PROCESS, 'Continuation returned end_turn - continue polling');
          continue;
        }
        // stopReason === 'cancelled' → 重置计数，继续
        // 其他 → 退出轮询
      } catch (err) {
        logger.warn(LOG_MODULES.PROCESS, `Continuation prompt failed: ${err}`);
        // 续推失败 → Agent 不响应，返回 reportReady=false
        return { reportReady: false, reportPath: null };
      }

      lastActivityTime = Date.now();  // 续推成功，重置不活跃计时
    }

    // 等待下一个轮询周期
    await new Promise(r => setTimeout(r, Math.min(REPORT_POLL_INTERVAL_MS, INACTIVITY_TIMEOUT_MS)));

    onEvent?.({
      type: 'log_chunk',
      message: `等待 Report 目录中的 .json/.md 文件...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });
  }

  // ===== 判断点 4: 7天超时 =====
  logger.warn(LOG_MODULES.PROCESS, `Report polling timeout (${timeoutMs/1000}s)`);
  return { reportReady: false, reportPath: null };
}
```

#### 辅助方法（与 daemon.ts 共用逻辑）

```typescript
/** 查找 Report 目录 */
private findReportFolder(workspace: string): string | null {
  const p = path.join(workspace, 'Report');
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  return null;
}

/** 检查 Report 目录是否有内容非空的 .json/.md 文件 */
private hasReportFile(folder: string): string | null {
  const entries = fs.readdirSync(folder);
  for (const f of entries) {
    const fullPath = path.join(folder, f);
    if (!fs.statSync(fullPath).isFile()) continue;
    const ext = path.extname(f).toLowerCase();
    if (ext === '.json' || ext === '.md') {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (content.trim().length > 0) return fullPath;
      } catch { continue; }
    }
  }
  return null;
}
```

### daemon.ts 改动

#### executeTask 状态判定

```typescript
private async executeTask(payload: TaskPayload): Promise<void> {
  const { taskId, engine: payloadEngine, agent, apiKey, model, apiBaseUrl, env, timeoutSec } = payload;
  const engine: 'opencode' | 'claudecode' = payloadEngine || 'opencode';
  const taskTimeoutMs = timeoutSec ? timeoutSec * 1000 : this.config.taskTimeoutMs;
  const taskStartTime = Date.now();

  try {
    // ... PHASE 1, 1.5 与现有代码相同 ...

    const result = await this.processMgr.runAgent(
      taskId, workspacePath, engine, agentName, apiKey, model, env, instruction, onEvent, apiBaseUrl, taskTimeoutMs
    );

    // runAgent 现在在 end_turn 后不立即返回，而是轮询 Report 直到产物出现或超时
    // 返回的 result.exitCode 仍为 0（正常退出）或 1（续推失败/崩溃）
    // 但 reportReady 信息已通过 runAgent 内部的 waitForReportOrContinue 处理

    const reportContent = this.collectReport(workspacePath);
    const isCancelled = this.cancelledTasks.has(taskId);

    // ========== 状态判定 ==========

    // ===== 判断点 1: 任务被取消 =====
    let status: TaskResultStatus;
    if (isCancelled) {
      status = 'failed';
    }
    // ===== 判断点 2: Agent 进程崩溃（exitCode ≠ 0） =====
    else if (result.exitCode !== 0) {
      status = 'failed';
    }
    // ===== 判断点 3: Report 产物就绪 =====
    // runAgent 内部 waitForReportOrContinue 已确认 Report 存在
    // 但仍需检查 stderr 是否有 critical errors（认证失败、配额超限等）
    else if (reportContent) {
      const stderrLines = (result.stderr || '').split('\n').filter(l => l.trim());
      const hasCriticalStderr = stderrLines.some(line => {
        const classified = classifyAcpError(line);
        return classified.isCritical;
      });
      status = hasCriticalStderr ? 'failed' : 'completed';
    }
    // ===== 判断点 4: Report 轮询超时，但 stdout 有实质性输出 =====
    // 兜底：Agent 可能未写正式 Report 文件但在 stdout 中输出了分析结果
    else if (hasSubstantialOutput(result.stdout)) {
      status = 'completed';
    }
    // ===== 判断点 5: 无 Report + 无实质性输出 =====
    else {
      status = 'failed';
    }

    // ... 后续 postResult 等与现有代码相同 ...
  } catch (error) {
    // ... 与现有代码相同 ...
  } finally {
    // ... 与现有代码相同 ...
  }
}
```

#### collectReport（保持与之前一致）

```typescript
/** 从 workspace 中读取 Report 文件内容（用于上报）。搜索范围仅 Report 目录，扩展名仅 .json/.md。 */
private collectReport(workspace: string): string | undefined {
  const reportDir = path.join(workspace, 'Report');
  if (!fs.existsSync(reportDir) || !fs.statSync(reportDir).isDirectory()) return undefined;

  const reportFileExts = ['.json', '.md'];

  try {
    const entries = fs.readdirSync(reportDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!reportFileExts.includes(ext)) continue;
      const filePath = path.join(reportDir, entry.name);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.trim().length > 0) return content;
      } catch { continue; }
    }
  } catch { /* ignore */ }

  return undefined;
}
```

---

## 改动范围

- **process-manager.ts**（核心改动）：
  - 改造 Exit A（第 332 行）：`end_turn` 不再 destroy + return，转入 `waitForReportOrContinue`
  - 改造 Exit B（第 444 行）：cancel 返回 `end_turn` 同样转入 `waitForReportOrContinue`
  - 新增 `waitForReportOrContinue` 方法（约 80 行）：end_turn 后的 Report 轮询 + 同 session 续推
  - 新增 `findReportFolder` + `hasReportFile` 辅助方法（约 20 行）
  - 续推逻辑调整：end_turn 后的不活跃超时触发同 session 续推（而非 cancel + destroy）
- **daemon.ts**：
  - 修改 `executeTask` 状态判定：简化为 reportContent → 检查 stderr → completed/failed
  - `collectReport` 保持不变（仅 Report 目录 + .json/.md）
- **Server 侧 `worker/result/route.ts`**：新增漏洞解析兜底 — `failed + reportContent` 时仍触发解析管道

---

## 注意事项

- **核心原则：end_turn ≠ 任务完成**。这是 Anthropic 官方、OpenAI、SWE-agent、Devin 等主流系统的共识。`end_turn` 是"本轮对话结束"的回应级信号，任务完成必须由**产物验证**驱动。
- **Agent 进程必须保持存活**：扫描器（CodeMap/Joern）是 Agent 的子进程（非 detached）。Agent 被 SIGTERM 杀死后，扫描器子进程不会收到信号，最终也会消亡。因此 Agent 进程必须在 Report 产出前保持存活。
- **ACP session 在 end_turn 后仍然可用**：`end_turn` 只是 stop_reason，不关闭 session。可以在同一 session 继续发送 prompt。当前代码 `end_turn → client.destroy()` 是过早销毁。
- **15 分钟续推覆盖两种场景**：
  - 场景 A：Agent 启动了扫描器后说"我先停了" → Report 会在轮询中出现，不需要续推
  - 场景 B：Agent 虚假完成（扫描器没启动） → 无 Report + 15 分钟无活动 → 续推触发 → Agent 继续工作

- **不活跃超时的实际判断机制**（当前代码 `process-manager.ts`）：

  超时判定的主体是 **Worker 端**，不是 ACP 协议层。Worker 通过事件驱动计时器来判断 Agent 是否活跃：

  1. Worker 为每个 prompt 发送启动一个 15 分钟的 `inactivityTimer`
  2. 每次收到以下 **任一类型** 的 ACP 事件，计时器**重置**为 15 分钟：

     | 事件类型 | 触发时机 | 代码位置 |
     |---------|---------|---------|
     | `text` | Agent 发文本消息 | `registerEventHandlers` 内 |
     | `toolCall` | Agent 调用工具 | 同上 |
     | `toolCallUpdate` | 工具执行有输出 | 同上 |
     | `error` | Agent 报错误 | 同上 |
     | `stderr` | Agent stderr 输出 | 同上 |
     | `raw` (`__alive__`) | Agent 心跳信号 | 同上 |

  3. **15 分钟内没有任何上述事件 → 计时器到期 → 触发 `handleInactivityTimeout`**
  4. 超时触发后，`inactivityPromise` reject → `Promise.race` 中率先完成 → 进入续推逻辑

  **关键细节**：Agent 正常工作时（如扫描器在后台运行），即使不主动发 `text/toolCall` 等事件，也会发送 `__alive__` 心跳信号。只要 Worker 收到心跳，计时器就重置。因此**只有 Agent 进程真的卡死/假死（连心跳都不发）才会触发不活跃超时**，不是简单的"15分钟没收到回应"。

  超时后的续推策略：

  | 步骤 | 方案 | 说明 |
  |------|------|------|
  | 方案 A | `client.cancel()` → 等待 10s | cancel 返回 `cancelled` → 同 session 续推；返回 `end_turn` → 任务完成 |
  | 方案 B（降级） | destroy client → 重建 session | cancel 无响应时触发；下次循环重建 client |
  | 终止 | 超过 `CONTINUE_MAX_ATTEMPTS`（5 次） | destroy → exitCode=1（任务失败） |
- **Report 轮询与 Agent 续推并行**：轮询每 10 分钟检查一次 Report 目录。续推在不活跃 15 分钟后触发。两者互不干扰：轮询是文件系统检查（零 API 消耗），续推是 ACP prompt（有 API 消耗但仅在必要时触发）。
- **超时上限**：`waitForReportOrContinue` 的实际等待时间 = `min(REPORT_WAIT_TIMEOUT_MS, 任务剩余整体超时)`，不会超出任务整体超时，不会无限等待。
- **判定条件统一**：`waitForReportOrContinue` 和 `collectReport` 都只认 `.json/.md`，职责一致。
- **与 Server 侧候选路径一致**：Worker 的 `findReportFolder` 仅检查 `Report` 目录，与 Server 侧 `minio-vulnerability.ts` 一致。
- **取消支持**：Report 轮询中检查 `cancelledTasks`，已取消任务立即返回 `reportReady=false`。
- **主流方案参考**：
  - SWE-agent：`handle_submission` 读取 `/root/model.patch` 验证实际产出，不信任 Agent 声明
  - Devin：session 状态轮询 + structured output 独立验证交付物
  - OpenAI Codex：`process/exited` 独立通知机制，后台进程完成与 Agent turn 解耦
  - accomplish-ai：`CompletionEnforcer` 区分 end_turn 和 completeTask，没调用 completeTask → 继续续推

---

## Server 侧协调变更

### 漏洞解析兜底 — failed + reportContent 时仍触发解析

**问题**：现有 `worker/result/route.ts` 中，漏洞解析管道只在 `finalState === 'completed'` 时触发。如果 Worker 误判 `failed`（如 Report 轮询超时但 Report 实际存在），即使 `reportContent` 有内容，漏洞解析也不会执行，导致数据丢失。

**方案**：在 `worker/result/route.ts` 的漏洞解析触发逻辑中，增加兜底条件：

```typescript
// 原逻辑：仅在 completed 时触发
// if (finalState === 'completed') { executeVulnerabilityParseAsync(...) }

// 新逻辑：completed 时触发，或 failed 但有 reportContent 时兜底触发
if (finalState === 'completed' || (finalState === 'failed' && reportContent)) {
  executeVulnerabilityParseAsync(taskId, projectPath, taskInstanceId, { productName, taskName });
}
```

**理由**：`reportContent` 非空说明 Worker 的 `collectReport` 找到了文件内容，即使 Report 轮询超时或状态判定为 `failed`，漏洞数据仍然存在。解析管道不应因状态标记问题而丢失数据。

### Server 侧状态修正机制 — 与 Worker 侧判定逻辑协调

Server 侧 `worker/result/route.ts` 已有状态修正逻辑：

```typescript
// Worker may send status='failed' due to stderr misclassification
const finalState = (status === 'completed' || (reportContent && !error)) ? 'completed' : 'failed';
```

**协调要点**：

| Worker 报告 | Server 修正条件 | 最终状态 | 是否正确 |
|------------|----------------|---------|---------|
| `completed` | 不修正 | `completed` | ✅ |
| `failed` + `reportContent` + **无** `error` | 修正为 `completed` | `completed` | ✅（stderr 误分类场景） |
| `failed` + `reportContent` + **有** `error` | 不修正（有 error） | `failed` | ⚠️ 需配合漏洞解析兜底 |
| `failed` + 无 `reportContent` + 有 `error` | 不修正 | `failed` | ✅ |

**关键交互**：Worker Report 轮询超时返回 `failed` 时总会附带 `error`（如 "Report polling timeout"），Server 的修正条件 `reportContent && !error` 无法触发修正。因此：
1. Worker 侧的 `collectReport` 必须尽力查找 `Report` 目录中的 `.json/.md` 文件，确保 `reportContent` 非空
2. Server 侧的漏洞解析兜底（`failed + reportContent`）确保即使状态未修正，漏洞数据仍入库
3. 两层防御互补，不依赖单一路径