# 任务完成检测设计方案

## 问题描述

ClaudeCode / opencode 引擎任务存在"虚假完成"现象：任务状态显示已完成，但 Report 目录为空，实际产物未就绪。

### 根因

ACP 协议的 `end_turn` 信号表示"本轮回复结束"，不代表任务产物已生成。Agent 可能在说完"我来开始扫描"后立即发送 `end_turn`，此时 Worker 误判任务完成，destroy 掉引擎进程并上报 `completed`，Report 目录仍为空。

两种引擎（opencode / claudecode）走同一套 `end_turn` 分支，问题相同。Worker 代码中有 **两个 `end_turn` 出口** 都会直接返回 `exitCode=0`：

- **出口 A**（process-manager.ts 第332行）：正常 prompt 完成
- **出口 B**（process-manager.ts 第444行）：续推 cancel 流程中 Agent 实际完成

---

## 方案：runAgent 返回后 daemon 层轮询 Report 目录

### 设计决策：为什么放在 daemon.ts 而不是 process-manager.ts

| 维度 | process-manager.ts（原方案） | daemon.ts（本方案） |
|------|---------------------------|-------------------|
| 关注点 | Agent 生命周期（ACP 协议） | 任务全流程（环境→执行→验证→上报） |
| 与续推机制 | 复杂：waitForReport 在续推 while 循环内，需处理 taskTimeoutPromise timer 未清理导致 UnhandledPromiseRejection | 无干扰：runAgent 已返回，续推循环已结束 |
| Client 生命周期 | Agent 已 end_turn（ACP session 结束），client 留着没用 | runAgent 已 destroy client，清干净了 |
| 覆盖范围 | 只覆盖出口 A，漏了出口 B（cancel 流程的 end_turn） | 统一覆盖：无论哪个出口返回 exitCode=0，daemon 层都验证 Report |
| 超时交互 | waitForReport 与 effectiveTimeoutMs 交互复杂，需额外处理 | executeTask 有 taskTimeoutMs 可用，计算 remaining = taskTimeoutMs - elapsed 即可 |
| 已有基础设施 | 无 Report 相关代码 | 已有 collectReport()，只需扩展成轮询版 |

**核心逻辑**：Agent 发 `end_turn` 说明 ACP session 结束了。Report 是 Agent spawn 的外部工具（扫描器）写入的，这些工具是独立进程，不依赖 ACP client 存活。因此 `waitForReport` 不需要 client 还活着，放 daemon.ts 完全可行且更干净。

### 改动位置

`codeswarm/packages/worker/src/daemon.ts`，`executeTask` 方法内，在 `runAgent` 返回后新增 PHASE 2.5。

process-manager.ts **不改** — `end_turn` 保持原逻辑返回 `exitCode=0`，由 daemon 层统一验证。

### 流程

```
executeTask()
  ├─ PHASE 1: build 环境
  ├─ PHASE 1.5: codedmap（并行）
  ├─ PHASE 2: runAgent() → 返回 { exitCode, stdout, stderr }
  ├─ PHASE 2.5 (新增): waitForReport()  ← 轮询 Report 目录
  │     ├── Report 目录有 json/md 文件 → reportReady = true
  │     └── 超时仍无 → reportReady = false
  ├─ 状态判定: exitCode=0 && reportReady → completed; 否则 → failed
  ├─ collectReport() → 收集内容用于上报
  └─ postResult()
```

### Report 候选路径

与 Server 侧 `findReportFolder`（`src/lib/minio-vulnerability.ts`）保持一致，**同时统一 `daemon.ts` 原有的 `collectReport` 方法**（原来只查 `Report/`，现在扩展到6个候选）：

```
{workspace}/Report
{workspace}/report
{workspace}/reports
{workspace}/cc_agent/reports
{workspace}/.security
{workspace}/code/reports
```

### 新增环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REPORT_WAIT_TIMEOUT_MS` | `604800000`（7×24 小时） | 等待 Report 的最长时间，与任务整体超时一致 |
| `REPORT_POLL_INTERVAL_MS` | `60000`（60 秒） | 轮询间隔 |

### 伪代码

```typescript
// ====== daemon.ts 新增辅助函数 ======

/** 查找 Report 候选目录，与 Server 侧 findReportFolder 保持一致 */
private findReportFolder(workspace: string): string | null {
  const candidates = [
    'Report', 'report', 'reports',
    'cc_agent/reports', '.security', 'code/reports',
  ];
  for (const rel of candidates) {
    const p = path.join(workspace, rel);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return null;
}

/** 检查目录中是否存在 json 或 md 文件 */
private hasReportFile(folder: string): string | null {
  const entries = fs.readdirSync(folder);
  for (const f of entries) {
    const fullPath = path.join(folder, f);
    if (!fs.statSync(fullPath).isFile()) continue;
    const ext = path.extname(f).toLowerCase();
    if (ext === '.json' || ext === '.md') return fullPath;
  }
  return null;
}

/**
 * 轮询等待 Report 产物就绪。
 * 超时上限 = min(REPORT_WAIT_TIMEOUT_MS, 任务剩余整体超时时间)
 * 超时不会无限等待。
 */
private async waitForReport(
  workspace: string,
  taskStartTime: number,
  taskTimeoutMs: number,
  onEvent?: (event: AgentEvent) => void,
): Promise<boolean> {
  const REPORT_WAIT_TIMEOUT_MS = parseInt(process.env.REPORT_WAIT_TIMEOUT_MS || '604800000');
  const REPORT_POLL_INTERVAL_MS = parseInt(process.env.REPORT_POLL_INTERVAL_MS || '60000');

  // 超时上限 = 环境配置 与 任务剩余时间 取较小值，防止超出整体超时
  const remainingMs = taskTimeoutMs - (Date.now() - taskStartTime);
  const timeoutMs = Math.min(REPORT_WAIT_TIMEOUT_MS, remainingMs);
  const deadline = Date.now() + timeoutMs;

  logger.info(LOG_MODULES.DAEMON, `waitForReport: timeout=${timeoutMs/1000}s, remaining=${remainingMs/1000}s`);

  while (Date.now() < deadline) {
    const folder = this.findReportFolder(workspace);
    if (folder && this.hasReportFile(folder)) {
      logger.info(LOG_MODULES.DAEMON, `Report ready: ${folder}`);
      return true;
    }
    await new Promise(r => setTimeout(r, REPORT_POLL_INTERVAL_MS));
    onEvent?.({
      type: 'log_chunk',
      message: `等待 Report 目录中的 json/md 文件...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });
  }

  logger.warn(LOG_MODULES.DAEMON, `Report wait timeout (${timeoutMs/1000}s), no json/md deliverable found`);
  return false;
}

// ====== executeTask 方法改动 ======

private async executeTask(payload: TaskPayload): Promise<void> {
  const { taskId, engine: payloadEngine, agent, apiKey, model, apiBaseUrl, env, timeoutSec } = payload;
  const engine: 'opencode' | 'claudecode' = payloadEngine || 'opencode';
  const taskTimeoutMs = timeoutSec ? timeoutSec * 1000 : this.config.taskTimeoutMs;
  const taskStartTime = Date.now();  // ← 新增：记录任务开始时间
  let buildResult = null;
  let codedmapPromise: Promise<void> | null = null;

  try {
    // ... PHASE 1, 1.5, 2 与现有代码相同 ...

    const result = await this.processMgr.runAgent(/* ... */);

    // ========== PHASE 2.5: 等待 Report 产物就绪 ==========  ← 新增
    onEvent({
      type: 'phase_start',
      phase: 'report_waiting',
      message: '等待 Report 产物就绪...',
      timestamp: new Date().toISOString(),
    });

    const reportReady = await this.waitForReport(
      workspacePath,
      taskStartTime,
      taskTimeoutMs,
      onEvent,
    );

    onEvent({
      type: 'phase_complete',
      phase: 'report_waiting',
      success: reportReady,
      message: reportReady ? 'Report 产物已就绪' : 'Report 等待超时，无产物',
      timestamp: new Date().toISOString(),
    });

    // ========== 状态判定 ==========  ← 修改：reportReady 优先
    const reportContent = this.collectReport(workspacePath);
    const isCancelled = this.cancelledTasks.has(taskId);
    let status: TaskResultStatus;
    if (isCancelled) {
      status = 'failed';
    } else if (result.exitCode === 0 && reportReady) {
      // Report 产物就绪 + exitCode=0 → 一定是 completed
      status = 'completed';
    } else if (result.exitCode !== 0) {
      status = 'failed';
    } else {
      // exitCode=0 但无 Report（waitForReport 超时）
      // 这里不会走到，因为 waitForReport 返回 false 时 exitCode=0 也判 failed
      // 但作为防御性兜底保留
      status = 'failed';
    }

    // ... 后续 postResult 等与现有代码相同 ...
  } catch (error) {
    // ... 与现有代码相同 ...
  } finally {
    // ... 与现有代码相同 ...
  }
}

// ====== collectReport 修改：扩展搜索范围和文件类型 ======

/** 从 workspace 中读取 Report 文件内容（用于上报）。搜索范围与 findReportFolder 一致。 */
private collectReport(workspace: string): string | undefined {
  const candidates = [
    'Report', 'report', 'reports',
    'cc_agent/reports', '.security', 'code/reports',
  ];
  const reportFileExts = ['.json', '.md'];

  for (const rel of candidates) {
    const reportDir = path.join(workspace, rel);
    if (!fs.existsSync(reportDir) || !fs.statSync(reportDir).isDirectory()) continue;

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
  }

  return undefined;
}
```

### 改动范围

- **daemon.ts**：
  - 新增 `findReportFolder` + `hasReportFile` + `waitForReport` 三个私有方法（约 50 行）
  - 修改 `executeTask`：新增 PHASE 2.5（约 20 行），修改状态判定逻辑（约 10 行）
  - 修改 `collectReport`：扩展搜索范围从 1 个目录到 6 个候选，文件类型从 5 种缩减为 `.json/.md`
  - executeTask 方法顶部新增 `taskStartTime` 变量（1 行）
- **process-manager.ts**：**不改**，`end_turn` 保持原逻辑返回 `exitCode=0`
- 不引入外部依赖，不改动 Server 侧代码

---

## 注意事项

- **开发规范约束**：所有需要产物校验的任务，Agent 必须将报告写入上述候选路径之一。不产生 Report 的任务（纯代码生成等）不在此方案覆盖范围内，由开发规范约束。
- **超时上限**：`waitForReport` 的实际等待时间 = `min(REPORT_WAIT_TIMEOUT_MS, 任务剩余整体超时)`，不会超出任务整体超时（`taskTimeoutMs`），不会无限等待。
- **判定条件**：只有 Report 目录中出现 `.json` 或 `.md` 文件才视为产物就绪，其他文件类型（如临时日志、lock 文件、`.txt`、`.html`）不算。
- **两个 end_turn 出口统一覆盖**：无论从正常 prompt 完成（出口 A）还是 cancel 流程完成（出口 B），daemon 层都做同样的 Report 验证，不需要分别处理。
- **与 collectReport 的统一**：原有 `collectReport` 只查 `Report/` 目录且接受 5 种文件类型，现统一为6个候选目录 + 只接受 `.json/.md`，与 `waitForReport` 的判定条件完全一致。
- **不影响不产生 Report 的任务**：对于纯代码生成等不写 Report 的任务，`waitForReport` 会超时返回 `false`，导致 `exitCode=0` 也被判 `failed`。这些任务应通过 Agent 配置或指令明确声明"不预期 Report 产物"，后续可考虑增加 `skipReportCheck` 标记来跳过此验证。