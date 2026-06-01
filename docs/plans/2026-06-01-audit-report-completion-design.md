# 任务完成判定：基于 Report/AUDIT_REPORT 产物的设计方案

## 背景

生产环境发现一个假完成问题：任务状态已经被标记为 `completed`，但进入任务工作区观察时，智能体仍在运行，工作区文件仍在持续写入。

现有链路中，Worker 主要依赖 ACP `end_turn`、进程 `exitCode`、`stderr` 分类和 `reportContent` 来判断任务是否完成。这些信号可以说明智能体协议层或进程层的状态，但不能可靠代表业务扫描任务已经真正结束。

因此，任务完成判定需要从“协议/进程信号”调整为“业务产物信号”。

## 目标

以实际工作区中的最终扫描报告作为任务是否完成的唯一业务信号：

```text
{workspacePath}/Report/AUDIT_REPORT.*
```

其中：

- 文件必须位于 `Report` 目录下
- 文件 basename 必须是 `AUDIT_REPORT`
- 后缀不限，例如 `.json`、`.md`、`.html`、`.txt`
- 文件必须非空
- 文件写入必须稳定后才能认为任务完成

## 非目标

本方案不要求：

- 修改智能体内部协议
- 依赖 ACP `end_turn` 作为最终完成信号
- 依赖 `exitCode=0` 作为最终完成信号
- 强制 `reportContent` 读取 `AUDIT_REPORT.*`

`AUDIT_REPORT.*` 只作为完成判定信号；`reportContent` 保持现有逻辑，继续由 Worker 从 `Report/` 目录中收集报告内容。

## 完成判定规则

### completed

满足以下条件时，任务最终标记为 `completed`：

```text
Report/AUDIT_REPORT.* 存在
且文件 size > 0
且文件写入稳定
且 Worker 已主动收束主智能体进程
```

如果智能体进程返回 `exitCode != 0`，Worker 不进入长轮询等待；只允许立即检查一次 `Report/AUDIT_REPORT.*`。由于主智能体进程已经异常退出，此时不再要求连续两次稳定检查：若立即检查时存在 `AUDIT_REPORT.*` 且文件非空，则可认为报告已落盘；若没有非空报告，应直接判定为 `failed`。

原因：`exitCode != 0` 表示智能体已异常结束，后续报告大概率不会再产生，继续等待只会浪费 Worker slot。

### failed

满足以下任一条件时，任务最终标记为 `failed`：

```text
exitCode != 0
且立即检查时未发现非空的 Report/AUDIT_REPORT.*
```

或：

```text
exitCode = 0
但到达整体任务超时时间
仍未发现稳定的 Report/AUDIT_REPORT.*
```

失败原因建议写为：

```text
任务执行失败，报告未生成。
```

### 用户取消

用户手动取消任务时，不继续等待报告，直接进入取消/失败路径，并执行进程清理。

## 状态流

建议 Worker 侧状态流调整为：

```text
running
  → agent_finished_successfully
  → report_waiting
  → report_detected
  → process_cleanup
  → completed

running
  → agent_failed
  → immediate_report_check
  → report_detected
  → process_cleanup
  → completed

agent_failed
  → immediate_report_check_no_report
  → failed

running / report_waiting
  → cancelled
  → failed

report_waiting
  → timeout
  → failed
```

其中：

- `agent_finished_successfully` 表示 ACP 或进程层正常返回，但不代表业务完成
- `agent_failed` 表示进程层异常返回，需要立即检查报告是否已经落盘
- `immediate_report_check` 表示异常退出后只做一次最终报告检查
- `report_waiting` 表示 Worker 正在等待 `Report/AUDIT_REPORT.*`
- `report_detected` 表示最终报告已发现且稳定
- `process_cleanup` 表示 Worker 正在主动终止仍存活的智能体主进程

## Worker 执行流程

现有流程大致为：

```text
runAgent 返回
→ collectReport()
→ 根据 exitCode / stderr / reportContent 判断 status
→ postResult()
→ cleanup
```

建议调整为：

```text
runAgent 返回
→ 如果 exitCode != 0：立即检查一次 Report/AUDIT_REPORT.*
   → 如果已存在且非空：processMgr.terminate(taskId) → collectReport() → postResult(completed)
   → 如果不存在或为空：postResult(failed)
→ 如果 exitCode == 0：立即检查一次 Report/AUDIT_REPORT.*
→ 如果未生成，进入轮询等待
→ 每隔 REPORT_POLL_INTERVAL_SEC 检查一次
→ 检测到稳定 AUDIT_REPORT.*
→ processMgr.terminate(taskId)
→ collectReport()
→ postResult(completed)
→ finally cleanup workspace / process map / semaphore
```

如果 `exitCode == 0`，但整体任务超时前没有检测到稳定报告：

```text
runAgent 返回
→ report_waiting
→ 到达 taskStartTime + TASK_TIMEOUT_SEC
→ postResult(failed)
→ finally cleanup
```

## 轮询策略

### 立即检查一次

进入报告等待阶段时，Worker 应立即检查一次：

```text
Report/AUDIT_REPORT.*
```

原因：如果报告已经生成，不应额外等待一个完整轮询周期。

### 默认轮询间隔

轮询间隔可配置，默认 10 分钟：

```env
REPORT_POLL_INTERVAL_SEC=600
```

建议使用秒作为配置单位，与现有 `TASK_TIMEOUT_SEC` 风格保持一致。

### 整体超时

`exitCode == 0` 时，不单独新增报告等待超时，直接复用整体任务超时：

```text
deadline = taskStartTime + TASK_TIMEOUT_SEC
```

如果智能体进程已经退出且 `exitCode == 0`，只要整体任务超时未到，Worker 仍继续轮询 `Report/AUDIT_REPORT.*`。

如果智能体进程以 `exitCode != 0` 异常退出，Worker 只立即检查一次 `Report/AUDIT_REPORT.*`；没有非空报告则直接失败，不进入长轮询。

## 文件匹配规则

接受：

```text
Report/AUDIT_REPORT.json
Report/AUDIT_REPORT.md
Report/AUDIT_REPORT.html
Report/AUDIT_REPORT.txt
Report/AUDIT_REPORT任意后缀
```

不建议接受临时文件：

```text
Report/AUDIT_REPORT.tmp
Report/AUDIT_REPORT.partial
Report/AUDIT_REPORT.lock
```

建议匹配逻辑：

```text
entry.isFile()
path.parse(entry.name).name === 'AUDIT_REPORT'
size > 0
后缀不在临时后缀黑名单中
```

## 文件稳定性判断

为了避免文件刚创建但尚未写完就被读取，建议要求文件连续两次检查保持稳定：

```text
同一路径
size 不变
mtimeMs 不变
```

在默认 10 分钟轮询下，这意味着报告文件至少稳定一个轮询周期后才会被认为完成。

如需更快确认，也可以在发现候选文件后执行一次短间隔复查，例如等待 5-10 秒后再次 stat。但最简单方案是复用轮询周期做稳定判断。

## 进程收束策略

检测到稳定 `AUDIT_REPORT.*` 后，如果 `opencode` / `claude` 主智能体进程仍在运行，Worker 应主动终止它：

```text
processMgr.terminate(taskId)
→ ACPClient.destroy()
→ SIGTERM
→ grace period
→ SIGKILL
```

完成回调必须发生在进程收束之后：

```text
发现稳定报告
→ terminate 主智能体进程
→ collectReport()
→ postResult(completed)
```

这可以防止出现：Server 已标记 completed，但 Worker 机器上智能体主进程仍在运行、工作区仍在写入。

## exitCode 与 stderr 的新角色

`exitCode` 和 `stderr` 不再决定任务是否 completed，但 `exitCode != 0` 会决定是否继续等待报告。

新的语义：

```text
exitCode = 0
  → 协议/进程层正常返回
  → 如果 AUDIT_REPORT.* 未生成，继续轮询直到整体超时

exitCode != 0
  → 协议/进程层异常返回
  → 立即检查一次 AUDIT_REPORT.*
  → 如果已经生成且非空，最终 completed
  → 如果没有生成或为空，立即 failed，不进入长轮询

stderr critical
  → 记录日志和前端事件
  → 可辅助诊断失败原因
```

唯一例外是用户取消：用户取消优先级最高，不继续等待报告。

## Server 端处理

Server 端 `worker/result` 回调只应信任 Worker 上报的 `status`，不能再用普通 `reportContent` 反推完成状态。主完成判定必须前移到 Worker，并以 `AUDIT_REPORT.*` 为准。

建议：

- Worker 只在检测到稳定 `AUDIT_REPORT.*` 后发送 `completed`
- Worker 在 `exitCode != 0` 且立即检查不到非空报告时发送 `failed`
- Worker 在 `exitCode == 0` 但整体超时未检测到稳定报告时发送 `failed`
- Server 继续更新 `CodeswarmTask` 和 `TaskInstance`
- Server 必须移除 `reportContent && !error` 推导 `completed` 的兜底逻辑，避免非最终报告绕过 `AUDIT_REPORT.*` 判定

## 前端事件建议

Worker 在报告等待阶段应向前端推送清晰事件，避免用户误以为任务卡住：

```text
phase_start: report_waiting
message: 等待 Report/AUDIT_REPORT.* 生成

log_chunk:
message: 未发现 AUDIT_REPORT，10 分钟后继续检查

phase_complete: report_waiting
success: true
message: 已检测到稳定的 Report/AUDIT_REPORT.*
```

超时时：

```text
phase_complete: report_waiting
success: false
message: 等待 Report/AUDIT_REPORT.* 超时
```

## 配置项

建议新增：

```env
REPORT_POLL_INTERVAL_SEC=600
```

复用已有：

```env
TASK_TIMEOUT_SEC=<整体任务超时秒数>
```

建议默认值：

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `REPORT_POLL_INTERVAL_SEC` | `600` | 报告轮询间隔，默认 10 分钟 |
| `TASK_TIMEOUT_SEC` | 现有默认值 | 整体任务生命周期上限 |

## 测试场景

### 场景 1：正常完成

1. 智能体执行扫描
2. 生成 `Report/AUDIT_REPORT.md`
3. Worker 检测文件非空且稳定
4. Worker 终止仍存活的智能体主进程
5. Worker 上报 completed
6. Server 标记任务 completed

### 场景 2：ACP 提前 end_turn，但报告未生成

1. `runAgent()` 返回 `exitCode=0`
2. `Report/AUDIT_REPORT.*` 不存在
3. Worker 不上报 completed
4. Worker 进入 `report_waiting`
5. 超时前生成报告则 completed；否则 failed

### 场景 3：exitCode 非 0，但报告已生成

1. 智能体进程异常退出或返回非 0
2. Worker 立即检查 `Report/AUDIT_REPORT.*`
3. 文件已生成且非空
4. Worker 判定 completed
5. stderr/exitCode 记录为诊断信息

### 场景 4：exitCode 非 0，且报告未生成

1. 智能体进程异常退出或返回非 0
2. Worker 立即检查 `Report/AUDIT_REPORT.*`
3. 文件不存在或为空
4. Worker 直接上报 failed
5. 不进入 10 分钟轮询等待

### 场景 5：用户取消

1. 用户点击停止任务
2. Worker 收到 `/task/cancel`
3. 不等待 `AUDIT_REPORT.*`
4. Worker 主动 terminate 进程
5. 任务进入 failed/cancelled 语义

### 场景 6：超时失败

1. 智能体结束或异常退出
2. Worker 持续轮询 `Report/AUDIT_REPORT.*`
3. 到达整体任务超时仍未发现稳定报告
4. Worker 上报 failed
5. error 写入 `任务执行失败，报告未生成。`

## 前端操作验证步骤

1. 打开任务构建/任务执行页面，启动一个会生成 `Report/AUDIT_REPORT.*` 的任务 → 表现：任务进入 running，日志显示执行中。
2. 在报告尚未生成时观察任务状态 → 表现：任务不能被标记为 completed，日志显示正在等待 `Report/AUDIT_REPORT.*`。
3. 在工作区生成非空 `Report/AUDIT_REPORT.md` 并等待稳定检测 → 表现：Worker 收束智能体进程，任务变为 completed。
4. 启动一个不生成 `AUDIT_REPORT.*` 的任务并等待整体超时 → 表现：任务变为 failed，错误信息说明等待报告超时。
5. 启动任务后手动停止 → 表现：Worker 不再轮询报告，直接清理进程并进入取消/失败状态。

## 结论

本方案将任务完成判定从 ACP/进程信号迁移到明确的业务产物信号，同时保留 `exitCode != 0` 的快速失败语义：

```text
Report/AUDIT_REPORT.*
```

这样可以避免 `end_turn` 或 `exitCode=0` 提前导致任务假完成，同时在 `exitCode != 0` 且没有报告产物时快速失败，避免无意义占用 Worker slot。