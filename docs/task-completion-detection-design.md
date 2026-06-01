# 任务完成检测设计方案

## 问题描述

ClaudeCode / opencode 引擎任务存在"虚假完成"现象：任务状态显示已完成，但 Report 目录为空，实际产物未就绪。

### 根因

ACP 协议的 `end_turn` 信号表示"本轮回复结束"，不代表任务产物已生成。Agent 可能在说完"我来开始扫描"后立即发送 `end_turn`，此时 Worker 误判任务完成，destroy 掉引擎进程并上报 `completed`，Report 目录仍为空。

两种引擎（opencode / claudecode）走同一套 `end_turn` 分支，问题相同。

---

## 方案：end_turn 后 Worker 侧轮询 Report 目录

### 改动位置

`codeswarm/packages/worker/src/process-manager.ts`，`end_turn` 分支（约第 332 行）。

### 流程

```
收到 end_turn
    ↓
轮询 workspace 下的 Report 候选目录
    ├── 每 REPORT_POLL_INTERVAL_MS 检查一次
    ├── 目录存在且有文件 → destroy client，return exitCode=0（成功）
    └── 超过 REPORT_WAIT_TIMEOUT_MS 仍无文件 → destroy client，return exitCode=1（失败）
```

### Report 候选路径

与 Server 侧 `findReportFolder`（`src/lib/minio-vulnerability.ts`）保持一致：

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
| `REPORT_WAIT_TIMEOUT_MS` | `600000`（10 分钟） | 等待 Report 的最长时间 |
| `REPORT_POLL_INTERVAL_MS` | `10000`（10 秒） | 轮询间隔 |

### 伪代码

```typescript
// 在 process-manager.ts 顶部新增辅助函数
function findReportFolder(workspace: string): string | null {
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

async function waitForReport(
  workspace: string,
  onEvent?: AgentEventCallback,
): Promise<number> {
  const timeout = parseInt(process.env.REPORT_WAIT_TIMEOUT_MS || '600000');
  const interval = parseInt(process.env.REPORT_POLL_INTERVAL_MS || '10000');
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const folder = findReportFolder(workspace);
    if (folder) {
      const hasFile = fs.readdirSync(folder).some(
        f => fs.statSync(path.join(folder, f)).isFile()
      );
      if (hasFile) {
        logger.info(LOG_MODULES.PROCESS, `Report ready: ${folder}`);
        return 0;
      }
    }
    await new Promise(r => setTimeout(r, interval));
    onEvent?.({ type: 'log_chunk', message: `等待 Report 目录...`, timestamp: new Date().toISOString() });
  }

  logger.warn(LOG_MODULES.PROCESS, `Report wait timeout (${timeout}ms), no deliverable found`);
  return 1;
}

// end_turn 分支改为：
if (stopReason === 'end_turn') {
  logger.info(LOG_MODULES.PROCESS, 'end_turn - waiting for report deliverable');
  const reportExitCode = await waitForReport(workspace, onEvent);
  await client!.destroy();
  logger.info(LOG_MODULES.PROCESS, `========== RUN AGENT ${reportExitCode === 0 ? 'COMPLETE' : 'FAILED (no report)'} ==========`);
  return { exitCode: reportExitCode, stdout: state.stdout, stderr: state.stderr };
}
```

### 改动范围

- `process-manager.ts`：新增 `findReportFolder` + `waitForReport` 两个函数（约 35 行），修改 `end_turn` 分支（3 行）
- 不引入外部依赖，不改动 Server 侧代码

---

## 注意事项

- **开发规范约束**：所有需要产物校验的任务，Agent 必须将报告写入上述候选路径之一。不产生 Report 的任务（纯代码生成等）不在此方案覆盖范围内，由开发规范约束。
- **超时失败**：`REPORT_WAIT_TIMEOUT_MS` 超时后 `exitCode=1`，任务标记为失败，Worker slot 正常释放。
- **与任务整体超时的关系**：`waitForReport` 的等待时间计入任务整体超时（`effectiveTimeoutMs`），不会无限等待。
