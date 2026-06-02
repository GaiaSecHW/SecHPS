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
  ├─ PHASE 2.5 (新增): Report 产物验证
  │     ├── skipReportCheck=true → reportReady=true（跳过验证）
  │     ├── exitCode≠0 → 快照收集一次，不轮询（避免7天空转浪费semaphore）
  │     └── exitCode=0 → waitForReport() 轮询 Report 目录（含取消检查）
  │           ├── Report 目录有有效 json/md 文件 → reportReady=true
  │           └── 超时仍无 / 任务被取消 → reportReady=false
  ├─ 状态判定:
  │     ├── cancelled → failed
  │     ├── exitCode≠0 → failed
  │     ├── reportReady=true + exitCode=0 → 检查 stderr critical → completed/failed
  │     ├── reportReady=false + reportContent非空 + stdout有实质性输出 → completed（兜底）
  │     └── 其他 → failed
  ├─ collectReport() → 收集内容用于上报（1个报告路径 + 5种扩展名）
  └─ postResult() → Server 侧接收后：
        ├── finalState=completed → 触发漏洞解析管道
        └─ finalState=failed + reportContent非空 → 兜底触发漏洞解析管道
```

### Report 候选路径

与 Server 侧 `findReportFolder`（`src/lib/minio-vulnerability.ts`）**完全一致**（含 `TASK_INPUT_DIR` 子目录），**同时统一 `daemon.ts` 原有的 `collectReport` 方法**（原来只查 `Report/`）：

```
{workspace}/Report
```

> **注意**：`TASK_INPUT_DIR` 环境变量默认值为 `vlu_scan_code`（与 Server 侧 `minio-vulnerability.ts` 一致）。Worker 和 Server 必须使用相同的 `TASK_INPUT_DIR` 值，否则路径不对齐会导致 Worker 漏检 Report。

### 新增环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REPORT_WAIT_TIMEOUT_MS` | `604800000`（7×24 小时） | 等待 Report 的最长时间，与任务整体超时一致 |
| `REPORT_POLL_INTERVAL_MS` | `60000`（600 秒） | 轮询间隔 |

### 伪代码

```typescript
// ====== daemon.ts 新增辅助函数 ======

/** 查找 Report 候选目录，与 Server 侧 findReportFolder 保持一致 */
private findReportFolder(workspace: string): string | null {
  const taskInputDir = process.env.TASK_INPUT_DIR || 'vlu_scan_code';
  const candidates = [
    'Report', 'report', 'reports',
    'cc_agent/reports', '.security', 'code/reports',
    path.join(taskInputDir, 'Report'),
    path.join(taskInputDir, 'report'),
    path.join(taskInputDir, 'reports'),
  ];
  for (const rel of candidates) {
    const p = path.join(workspace, rel);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return null;
}

/** 检查目录中是否存在有效（内容非空）的 json 或 md 文件 */
private hasReportFile(folder: string): string | null {
  const entries = fs.readdirSync(folder);
  for (const f of entries) {
    const fullPath = path.join(folder, f);
    if (!fs.statSync(fullPath).isFile()) continue;
    const ext = path.extname(f).toLowerCase();
    if (ext === '.json' || ext === '.md') {
      // 与 collectReport 验证标准一致：检查内容非空
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (content.trim().length > 0) return fullPath;
      } catch { continue; }
    }
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
  taskId: string,  // 传入 taskId 用于取消检查
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
    // 检查任务是否已被取消，避免已取消任务继续占用 semaphore
    if (this.cancelledTasks.has(taskId)) {
      logger.info(LOG_MODULES.DAEMON, `waitForReport cancelled for task ${taskId}`);
      return false;
    }

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
    // 仅对预期产出 Report 的任务执行验证
    // 设计决策：waitForReport 独立为 PHASE 2.5 而非融合到 PHASE 2 (runAgent) 内，
    // 因为 Report 是 Agent spawn 的扫描器子进程写入的（独立进程），Agent 继续对话无法加速扫描器产出。
    // 放在 daemon 层做文件系统轮询是零 API 消耗、零 Agent 交互的最优方式。
    let reportReady: boolean;
    if (payload.skipReportCheck) {
      reportReady = true;  // 跳过验证，视为已就绪
      logger.info(LOG_MODULES.DAEMON, `skipReportCheck=true, skipping waitForReport`);
    } else if (result.exitCode !== 0) {
      // Agent 崩溃：跳过7天轮询，只做一次快照收集
      // 理由：Agent 已死，扫描器大概率也未启动。7天轮询白白占用 semaphore slot。
      // 但仍做 collectReport 快照：如果扫描器在 Agent 崩溃前已产出部分结果，可以附带上报。
      reportReady = !!this.collectReport(workspacePath);
      logger.info(LOG_MODULES.DAEMON, `exitCode=${result.exitCode}, skip waitForReport polling, snapshot reportReady=${reportReady}`);
    } else {
      onEvent({
        type: 'phase_start',
        phase: 'report_waiting',
        message: '等待 Report 产物就绪...',
        timestamp: new Date().toISOString(),
      });

      reportReady = await this.waitForReport(
        workspacePath,
        taskStartTime,
        taskTimeoutMs,
        taskId,  // 传入 taskId 用于取消检查
        onEvent,
      );

      onEvent({
        type: 'phase_complete',
        phase: 'report_waiting',
        success: reportReady,
        message: reportReady ? 'Report 产物已就绪' : 'Report 等待超时，无产物',
        timestamp: new Date().toISOString(),
      });
    }

    // ========== 状态判定 ==========  ← 修改：reportReady 优先，保留 stderr critical 检查
    const reportContent = this.collectReport(workspacePath);
    const isCancelled = this.cancelledTasks.has(taskId);
    let status: TaskResultStatus;
    if (isCancelled) {
      status = 'failed';
    } else if (result.exitCode !== 0) {
      status = 'failed';
    } else if (reportReady) {
      // Report 产物就绪 + exitCode=0 → completed（但需排除 stderr critical errors）
      const stderrLines = (result.stderr || '').split('\n').filter(l => l.trim());
      const hasCriticalStderr = stderrLines.some(line => {
        const classified = classifyAcpError(line);
        return classified.isCritical;
      });
      status = hasCriticalStderr ? 'failed' : 'completed';
    } else if (reportContent && hasSubstantialOutput(result.stdout)) {
      // Report 目录未就绪（waitForReport 超时），但 collectReport 找到内容且有实质性输出
      // 兜底：可能 Agent 在 stdout 中输出了分析结果，Report 文件是空的或格式不符
      status = 'completed';
    } else {
      // exitCode=0 但无 Report + 无实质性输出 → failed
      status = 'failed';
    }

    // ... 后续 postResult 等与现有代码相同 ...
  } catch (error) {
    // ... 与现有代码相同 ...
  } finally {
    // ... 与现有代码相同 ...
  }
}

// ====== collectReport 修改：扩展搜索范围（与 findReportFolder 一致），上报范围保留原 5 种扩展名 ======

/** 从 workspace 中读取 Report 文件内容（用于上报）。搜索范围与 findReportFolder 一致。
 *  注意：上报范围保留 .json/.md/.jsonl/.txt/.html 5 种扩展名（与 waitForReport 的验证职责不同）。
 *  waitForReport 验证"Report 是否就绪"只需 .json/.md；
 *  collectReport 收集"上报内容"应覆盖更多格式，避免丢失有效报告。 */
private collectReport(workspace: string): string | undefined {
  const taskInputDir = process.env.TASK_INPUT_DIR || 'vlu_scan_code';
  const candidates = [
    'Report', 'report', 'reports',
    'cc_agent/reports', '.security', 'code/reports',
    path.join(taskInputDir, 'Report'),
    path.join(taskInputDir, 'report'),
    path.join(taskInputDir, 'reports'),
  ];
  const reportFileExts = ['.json', '.md', '.jsonl', '.txt', '.html'];

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

### skipReportCheck — 非 Report 任务跳过验证

**问题**：不产生 Report 的合法任务（纯代码生成、重构、文档编写等）会被 `waitForReport` 阻塞轮询直到超时（默认最长 7 天），占用 Worker semaphore slot，最终被判 `failed`。这不是边缘场景 — `engine: 'opencode' | 'claudecode'` 支持多种 Agent，其中很多不写 Report。

**方案**：在 `TaskPayload` 中增加 `skipReportCheck` 标记，Worker 侧据此跳过 PHASE 2.5。

#### 1. TaskPayload Schema 变更

`codeswarm/packages/types/src/index.ts`：

```typescript
export const TaskPayloadSchema = z.object({
  // ... 现有字段 ...
  // 跳过 Report 产物验证（用于不预期产出 Report 的任务，如代码生成、重构等）
  skipReportCheck: z.boolean().optional().default(false),
});
```

#### 2. daemon.ts executeTask 逻辑变更

```typescript
// ========== PHASE 2.5: 等待 Report 产物就绪 ==========
// 仅对预期产出 Report 的任务执行验证，skipReportCheck=true 时跳过
let reportReady: boolean;
if (payload.skipReportCheck) {
  reportReady = true;  // 跳过验证，视为已就绪
  logger.info(LOG_MODULES.DAEMON, `skipReportCheck=true, skipping waitForReport`);
} else {
  onEvent({
    type: 'phase_start',
    phase: 'report_waiting',
    message: '等待 Report 产物就绪...',
    timestamp: new Date().toISOString(),
  });

  reportReady = await this.waitForReport(
    workspacePath,
    taskStartTime,
    taskTimeoutMs,
    taskId,  // 传入 taskId 用于取消检查
    onEvent,
  );

  onEvent({
    type: 'phase_complete',
    phase: 'report_waiting',
    success: reportReady,
    message: reportReady ? 'Report 产物已就绪' : 'Report 等待超时，无产物',
    timestamp: new Date().toISOString(),
  });
}
```

- 

---

## Server 侧协调变更

### 漏洞解析兜底 — failed + reportContent 时仍触发解析

**问题**：现有 `worker/result/route.ts` 中，漏洞解析管道只在 `finalState === 'completed'` 时触发。如果 Worker 误判 `failed`（如 waitForReport 超时但 Report 实际存在），即使 `reportContent` 有内容，漏洞解析也不会执行，导致功能损失。

**方案**：在 `worker/result/route.ts` 的漏洞解析触发逻辑中，增加兜底条件：

```typescript
// 原逻辑：仅在 completed 时触发
// if (finalState === 'completed') { executeVulnerabilityParseAsync(...) }

// 新逻辑：completed 时触发，或 failed 但有 reportContent 时兜底触发
if (finalState === 'completed' || (finalState === 'failed' && reportContent)) {
  executeVulnerabilityParseAsync(taskId, projectPath, taskInstanceId, { productName, taskName });
}
```

**理由**：`reportContent` 非空说明 Worker 的 `collectReport` 找到了文件内容，即使 `waitForReport` 超时或状态判定为 `failed`，漏洞数据仍然存在。解析管道不应因状态标记问题而丢失数据。

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

**关键交互**：Worker `waitForReport` 超时返回 `failed` 时总会附带 `error`（如 "Report wait timeout"），Server 的修正条件 `reportContent && !error` 无法触发修正。因此：
1. Worker 侧的 `collectReport` 必须尽力查找所有候选路径（含 TASK_INPUT_DIR），确保 `reportContent` 非空
2. Server 侧的漏洞解析兜底（`failed + reportContent`）确保即使状态未修正，漏洞数据仍入库
3. 两层防御互补，不依赖单一路径