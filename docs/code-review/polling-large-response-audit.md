# 轮询接口 + 大响应体性能审计报告

> 日期：2026-06-04
> 触发：任务详情页每 5 秒轮询返回 10+ MB 响应，排查全项目类似问题

---

## 一、问题定义

**核心模式**：前端页面通过 `setInterval` 轮询后端 API，API 返回全量数据（无分页），随任务运行时间增长，响应体持续膨胀。

**典型症状**：
- 任务运行数小时后，单个接口响应超过 10 MB
- 每次轮询重复传输相同数据（已发送的 logs/events 不会减少）
- 前端 `setState` 频繁写入大数组，导致 React 重渲染卡顿
- 数据库每次全表扫描，无 LIMIT 保护

---

## 二、P0 — 必须立即修复

### 2.1 WorkerLogsPage — 每 2 秒轮询两个无界端点

**前端文件**：`src/components/codeswarm/WorkerLogsPage.tsx`（行 159-171）
**轮询间隔**：2 秒（用户勾选"自动刷新"后触发）

**调用的两个 API**：

| 端点 | 文件 | 问题 |
|------|------|------|
| `GET /api/codeswarm/tasks/${taskId}/logs` | `src/app/api/codeswarm/tasks/[taskId]/logs/route.ts` | `findMany` 无 LIMIT，返回全部 CodeswarmEvent |
| `GET /api/codeswarm/tasks/${taskId}` | `src/app/api/codeswarm/tasks/[taskId]/route.ts` | 原始 SQL 查全部事件 + result + reportContent，无 LIMIT |

**影响**：长时间运行的任务可产生数万条事件，每条 `data` 字段包含完整 JSON。两个端点同时返回全部数据，每 2 秒重复传输。

**修复建议**：
1. logs 端点增加 `offset`/`limit` 参数，前端只请求增量
2. task detail 端点不返回 events，仅返回元数据（state/result 单独端点获取）
3. 改为 SSE/WebSocket 推送增量事件

---

### 2.2 任务详情页 — 每 5 秒返回全量 logs

**前端文件**：`src/app/dashboard/task-builder/[id]/page.tsx`（行 194-220）
**API 文件**：`src/app/api/task-builder/tasks/[id]/route.ts`（行 66-78）
**轮询间隔**：5 秒（运行中），完成后继续 60 秒

**问题**：
```typescript
// API 行 66-78：Prisma include 返回全部 TaskExecutionLog
const task = await prisma.taskInstance.findUnique({
  where: { id },
  select: {
    // ... 其他字段
    TaskExecutionLog: {
      orderBy: { timestamp: 'asc' },
      select: {
        id: true, timestamp: true, level: true,
        message: true, details: true, taskId: true,  // details 字段可含大量文本
      },
    },
  },
});
```

- `TaskExecutionLog` 无 LIMIT，长时任务可积累数千条日志
- `details` 字段可能包含完整 Agent 输出、工具调用结果（单条可达数十 KB）
- `executionResult` 字段也在同一响应中返回（完整执行结果文本）
- 任务完成后仍轮询 60 秒（为捕获延迟的 VulnParse 日志）

**修复建议**：
1. 日志分离为独立端点 `GET /api/task-builder/tasks/${id}/logs?offset=X&limit=Y`
2. 主接口不返回 logs，仅返回任务元数据 + 状态
3. `executionResult` 超过阈值时截断或延迟加载
4. 完成后改用一次性延迟请求代替持续轮询

---

### 2.3 CodeswarmTask 详情 — 全量事件无 LIMIT

**API 文件**：`src/app/api/codeswarm/tasks/[taskId]/route.ts`（行 45-54）

**问题**：
```sql
SELECT ... FROM "CodeswarmEvent" WHERE "taskId" = $1 ORDER BY "createdAt" ASC
-- 无 LIMIT
```

- 返回全部事件 + `result`（完整执行结果）+ `reportContent`（报告全文）
- 被 WorkerLogsPage 每 2 秒调用
- 被 data-feedback 页面间接使用

**修复建议**：
1. 事件分页：`?offset=X&limit=Y`
2. `result`/`reportContent` 默认不返回，需显式 `?include=result`
3. 或改为 SSE 增量推送

---

## 三、P1 — 应尽快修复

### 3.1 Session 详情页 — node-data 预加载全部子 Agent 消息

**前端文件**：`src/app/dashboard/sessions/[id]/page.tsx`（行 261-289, 486-489）
**API 文件**：`src/app/api/evaluations/[id]/node-data/route.ts`
**轮询间隔**：评估状态 5 秒，节点数据 10 秒

**问题**：
- `node-data` 端点预加载**所有子 Agent 的全部消息**（`agentMessages` 字段）
- 对每个子 Agent 文件读取全部事件并存储为 `agentMessages[agentId]`
- 复杂工作流可能有数十个子 Agent，每个产生数千条消息
- 每 10 秒传输一次完整数据

**修复建议**：
1. `agentMessages` 改为按需加载（点击子 Agent 时再请求）
2. 消息分页：`?offset=X&limit=50`

### 3.2 评估漏洞列表 — 无 LIMIT

**API 文件**：`src/app/api/evaluations/[id]/vulnerabilities/route.ts`（行 62-68）
**问题**：`findMany` 无 LIMIT，评估发现多时返回数百条漏洞记录，每条含 `POC`/`description`/`rawReport` 大文本。

### 3.3 评估节点消息 — 无 LIMIT

**API 文件**：`src/app/api/evaluations/[id]/messages/route.ts`
**问题**：读取完整 stream.jsonl 文件并返回全部事件，无分页。

### 3.4 评估子节点消息 — 无 LIMIT

**API 文件**：`src/app/api/evaluations/[id]/children/route.ts`
**问题**：当指定 `childId` 时，读取完整 Agent 流或按时间范围过滤主流，无分页。

### 3.5 评估结果 — rawReport 无界

**API 文件**：`src/app/api/evaluations/[id]/results/route.ts`
**问题**：`rawReport` 包含完整 AI 生成报告，可达数百 KB。

### 3.6 Session Extract — 全量读取

**API 文件**：`src/app/api/codeswarm/session-extract/route.ts`（行 94-99）
**问题**：从 SQLite 读取全部 `part` 行无 LIMIT，`rawData` 字段可非常大。

### 3.7 Session Extract History — rawData 无界

**API 文件**：`src/app/api/codeswarm/session-extract/history/[id]/route.ts`
**问题**：返回完整 `rawData`（JSON 序列化的全部 session 提取数据）。

---

## 四、P2 — 需要优化

### 4.1 Overview 页面 — 每 5 秒拉取 1000 条任务

**前端文件**：`src/app/dashboard/overview/page.tsx`（行 104-110）
**问题**：`?limit=1000` 虽然有上限，但无条件每 5 秒拉取全部任务摘要。
**建议**：改为仅请求统计数据 `?select=count,status`，或用聚合端点。

### 4.2 Sessions 列表页 — 全量项目 + 评估

**前端文件**：`src/app/dashboard/sessions/page.tsx`（行 237-246）
**API**：`GET /api/projects?include=evaluations`
**问题**：返回全部项目 + 全部评估记录，无分页。
**建议**：项目列表分页，评估数量做 count 聚合。

### 4.3 任务列表 — 内存分页

**API 文件**：`src/app/api/task-builder/tasks/route.ts`（行 136-207）
**问题**：`findMany` 无 `skip/take`，查出全部记录后在 JS 中 slice 分页。
**建议**：将分页下推到数据库查询。

### 4.4 任务日志 SSE — 初始加载全量

**API 文件**：`src/app/api/task-builder/tasks/[id]/logs/stream/route.ts`（行 63-66）
**问题**：SSE 连接建立时 `findMany` 无 LIMIT 返回全部已有日志。
**建议**：SSE 初始事件只返回最近 N 条，历史通过分页 API 获取。

### 4.5 任务结果端点 — 大文本

**API 文件**：`src/app/api/task-builder/tasks/[id]/result/route.ts`
**问题**：`executionResult` + `reportPath`（reportContent）均为无界大文本。
**建议**：超阈值截断或支持 Range 请求。

### 4.6 评估报告 — 全量漏洞统计

**API 文件**：`src/app/api/evaluations/[id]/report/route.ts`（行 328-356）
**问题**：`allVulnerabilities` 查询全部漏洞做统计，skill 执行记录无分页。
**建议**：统计用 SQL 聚合代替全量查询。

### 4.7 评估迭代 — 全量统计

**API 文件**：`src/app/api/evaluations/[id]/iterations/route.ts`（行 111-119）
**问题**：分页数据正确，但 `allIterations` 查全量做汇总统计。
**建议**：统计用 SQL 聚合。

---

## 五、无问题的页面（已优化或低风险）

| 页面/端点 | 说明 |
|-----------|------|
| `admin/monitoring/page.tsx` | 30 秒轮询，返回固定大小系统指标 |
| `data-feedback/tasks/[id]/route.ts` | 已有分页（eventLimit/logLimit），result 截断 50KB |
| `autonomous-evolution/route.ts` | 已有分页 |
| `admin/audit-logs/route.ts` | 已有分页 |

---

## 六、修复优先级路线图

### 第一阶段：止血（P0，1-2 天）

| 编号 | 修复项 | 预估工时 |
|------|--------|----------|
| 2.1 | WorkerLogsPage logs/task 端点加分页 | 4h |
| 2.2 | task-builder 详情日志分离 + 分页 | 4h |
| 2.3 | codeswarm task detail 事件分页 | 3h |

### 第二阶段：降风险（P1，3-5 天）

| 编号 | 修复项 | 预估工时 |
|------|--------|----------|
| 3.1 | node-data agentMessages 改按需加载 | 6h |
| 3.2 | evaluations vulnerabilities 分页 | 2h |
| 3.3-3.4 | evaluations messages/children 分页 | 4h |
| 3.5-3.7 | rawReport/rawData 截断 + 按需加载 | 3h |

### 第三阶段：优化（P2，后续迭代）

| 编号 | 修复项 |
|------|--------|
| 4.1 | Overview 改聚合端点 |
| 4.2 | Sessions 列表分页 |
| 4.3 | 任务列表 DB 层分页 |
| 4.4-4.7 | SSE/报告/迭代统计优化 |

---

## 七、通用优化模式

对所有轮询 + 大响应场景，推荐统一方案：

1. **日志/事件类数据**：统一使用 `offset + limit` 分页，前端无限滚动加载
2. **大文本字段**（result/reportContent/rawReport）：默认截断或延迟加载，提供 `?include=fullResult` 显式请求
3. **轮询改增量**：记录客户端上次拉取时间戳，服务端只返回增量数据
4. **SSE 替代轮询**：对实时性要求高的场景（Worker 日志），改用 SSE 推送
5. **DB 层分页**：禁止在 JS 层做全量查询 + 内存 slice
