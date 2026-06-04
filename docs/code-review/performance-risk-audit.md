# SecHPS 全项目性能风险审计报告

> 日期：2026-06-04
> 范围：前端 + 后端全链路性能风险排查
> 10 个维度：超大接口返回、重复请求、大列表渲染、React 状态过大、React Query 缓存、Zustand 缓存、useEffect 重复执行、内存泄漏、大对象传递、页面长期驻留

---

## 目录

- [一、超大接口返回（P0）](#一超大接口返回p0)
- [二、重复请求（P1）](#二重复请求p1)
- [三、大列表渲染（P0）](#三大列表渲染p0)
- [四、React 状态过大（P0）](#四react-状态过大p0)
- [五、React Query 缓存（P2）](#五react-query-缓存p2)
- [六、Zustand 缓存](#六zustand-缓存)
- [七、useEffect 重复执行（P1）](#七useeffect-重复执行p1)
- [八、内存泄漏（P1）](#八内存泄漏p1)
- [九、大对象传递（P1）](#九大对象传递p1)
- [十、页面长期驻留问题（P1）](#十页面长期驻留问题p1)
- [十一、修复优先级路线图](#十一修复优先级路线图)

---

## 一、超大接口返回（P0）

> 详细端点分析见 `polling-large-response-audit.md`

### 核心问题

轮询接口返回全量无分页数据，随任务运行时间增长响应体持续膨胀。

### 受影响页面与端点

| 前端页面 | 轮询间隔 | API 端点 | 问题 |
|----------|----------|----------|------|
| `components/codeswarm/WorkerLogsPage.tsx` | 2s | `/api/codeswarm/tasks/${id}/logs` + `/api/codeswarm/tasks/${id}` | 两个端点均无 LIMIT，返回全部事件 |
| `dashboard/task-builder/[id]/page.tsx` | 5s + 完成后 60s | `/api/task-builder/tasks/${id}` | 返回全部 TaskExecutionLog（含 details 大字段） |
| `dashboard/sessions/[id]/page.tsx` | 5s/10s | `/api/evaluations/${id}/node-data` | 预加载所有子 Agent 全部消息 |
| `dashboard/overview/page.tsx` | 5s | `/api/task-builder/tasks?limit=1000` | 一次拉取 1000 条任务 |
| `dashboard/sessions/page.tsx` | 5s | `/api/projects?include=evaluations` | 全量项目 + 评估记录 |

### 高风险 API 端点（无分页）

| 端点 | 文件 | 大字段 |
|------|------|--------|
| `GET /api/codeswarm/tasks/:taskId` | `api/codeswarm/tasks/[taskId]/route.ts` | events、result、reportContent |
| `GET /api/codeswarm/tasks/:taskId/logs` | `api/codeswarm/tasks/[taskId]/logs/route.ts` | data（每条事件） |
| `GET /api/task-builder/tasks/:id` | `api/task-builder/tasks/[id]/route.ts` | logs（全部）、executionResult |
| `GET /api/evaluations/:id/node-data` | `api/evaluations/[id]/node-data/route.ts` | agentMessages（所有子 Agent） |
| `GET /api/evaluations/:id/vulnerabilities` | `api/evaluations/[id]/vulnerabilities/route.ts` | POC、description、rawReport |
| `GET /api/evaluations/:id/messages` | `api/evaluations/[id]/messages/route.ts` | 全部消息 |
| `GET /api/evaluations/:id/results` | `api/evaluations/[id]/results/route.ts` | rawReport |
| `GET /api/task-builder/tasks` | `api/task-builder/tasks/route.ts` | 全量查询后 JS 内存分页 |

---

## 二、重复请求（P1）

### 2.1 StrictMode 双倍请求

`next.config.js` 启用了 `reactStrictMode: true`，开发环境下所有 `useEffect(... , [])` 触发两次。

**无防重复保护的页面**（无 `useRef(false)` 守卫）：

| 页面 | 初始请求数 | StrictMode 实际数 |
|------|-----------|------------------|
| `overview/page.tsx` | 3 个 API | 6 个 |
| `task-builder/[id]/page.tsx` | 3 个 useEffect | 6 个请求 |
| `sessions/[id]/page.tsx` | 9 个串行 fetch | 18 个请求 |
| `sessions/page.tsx` | 1 个 fetchProjects | 2 个 |
| 其他所有 dashboard 页面 | 各 1-3 个 | 翻倍 |

### 2.2 初始化 + 轮询重复

`sessions/[id]/page.tsx` 的 `loadAllData` 和轮询循环**同时调用相同 API**：
- `fetchEvaluation()`：初始化调用 1 次 + 轮询立即调用 1 次 = 重复
- `fetchWorkflowNodes()`：同上

### 2.3 useApiFetch 无缓存

`src/hooks/useApiFetch.ts` 是项目主要数据获取 hook，完全无缓存、无去重：
- 每次 URL 变化都发新请求
- 多个组件同时挂载同一 URL → 多个独立请求
- 无 ETag/If-Modified-Since 支持

---

## 三、大列表渲染（P0）

### 关键发现：全项目无虚拟化

**`package.json` 中不存在 `react-window`、`react-virtuoso` 等虚拟化库。** 所有列表通过 `.map()` 渲染。

### 受影响列表

| 页面 | 渲染位置 | 数据来源 | 预估规模 |
|------|----------|----------|----------|
| `task-builder/[id]/page.tsx` | 行 694 `sortedVulnList.map()` | 漏洞列表（最多 200 条） | 中 |
| `task-builder/[id]/page.tsx` | 行 1110 `groupedLogs.toolCalls.logs.map()` | 工具调用日志 | **大（数千条）** |
| `task-builder/[id]/page.tsx` | 行 1141 `groupedLogs.errors.logs.map()` | 错误日志 | 中 |
| `data-feedback/page.tsx` | 行 181 `merged.map()` | 事件流 | **大（数千条）** |
| `data-feedback/page.tsx` | 行 355 `execLogs.map()` | 执行日志 | **大** |
| `sessions/[id]/page.tsx` | 行 1816 `nodeMessages.map()` | 节点消息 | **大** |
| `sessions/[id]/page.tsx` | 行 1956 `childSessionMessages.map()` | 子会话消息 | **大** |
| `sessions/[id]/page.tsx` | 行 1358 `workflowNodes.map()` | 工作流节点（含复杂渲染） | 中-大 |
| `WorkerLogsPage.tsx` | 行 432 `groupConsecutiveLogs(processLogs).map()` | Worker 日志 | **大** |
| `TaskDebugPanel.tsx` | 行 560 `logs.map()` | SSE 日志（无限增长） | **大** |
| `CodedmapDebugPanel.tsx` | 行 367 `logs.map()` | 构建日志 | 中 |

### 流式追加导致频繁全量重渲染

```typescript
// 每条新日志创建完整数组副本 → 触发 React 重渲染
setLogs(prev => [...prev, { ... }])  // 出现在 3+ 个文件中
```

受影响文件：
- `task-builder/[id]/page.tsx` 行 281
- `claude/[project]/page.tsx` 行 266-274（每个 chunk 都拷贝完整消息数组）
- `TaskDebugPanel.tsx` 行 133

---

## 四、React 状态过大（P0）

### 最严重：`sessions/[id]/page.tsx` — 30+ 个 useState

该组件拥有 **30+ 个 `useState` 调用**（行 140-195），形成巨大的状态对象。任意部分变化都触发完整重渲染。

关键大状态：
- `messages: any[]`（行 141）— 全部评估消息
- `workflowNodes: any[]`（行 173）— 含嵌套 `skillsDetails`
- `preloadedAgentMessages: Record<string, any[]>`（行 156）— 所有子 Agent 消息字典
- `childrenSessions: any[]`（行 149）— 全部子会话
- `nodeMessages: any[]`（行 185）— 节点消息
- `skillMessages: any[]`（行 189）— 技能消息

### 其他严重状态

| 页面 | 状态 | 问题 |
|------|------|------|
| `task-builder/[id]/page.tsx` 行 93 | `logs: TaskExecutionLog[]` | 全量日志，含 details 大字段 |
| `task-builder/[id]/page.tsx` 行 103 | `vulnList: any[]`（最多 200） | 每条含 POC、description |
| `overview/page.tsx` 行 63 | `tasks: TaskInstance[]`（最多 1000） | `?limit=1000` 全量拉取 |
| `claude/[project]/page.tsx` 行 69 | `messages: Message[]` | 全部聊天历史 |
| `WorkerLogsPage.tsx` 行 110 | `taskDetail`（含 `events: any[]`） | 全量事件 |

### 建议

1. 将大列表状态移出组件 → 用 SWR/React Query 管理
2. `sessions/[id]/page.tsx` 拆分为 5+ 个子组件，各自管理状态
3. 流式追加用 `useRef` 缓冲 + 定期批量 `setState`

---

## 五、React Query 缓存（P2）

### 现状

- **未使用 React Query**（`@tanstack/react-query`）
- 仅在 `src/lib/hooks/useEvaluationData.ts` 使用了 **SWR**（`useSWR` / `useSWRImmutable`）
- 无全局 `SWRConfig` Provider，每个 hook 独立配置

### SWR 配置详情

| Hook | refreshInterval | dedupingInterval |
|------|----------------|-----------------|
| `useEvaluation` | 5s（运行中）/ 3s（准备中） | 2s（默认） |
| `useWorkflowNodes` | 5s | 2s（默认） |
| `useNodeMessages` | 3s | 1s |
| `useNodeTodos` | 3s | 1s |
| `useNodeChildren` | 3s | 1s |

### 问题

1. SWR 仅覆盖评估模块，其他 90% 的页面用 `useApiFetch`（无缓存）
2. 无全局缓存失效策略
3. 页面间无共享缓存，导航离开再返回重新拉取

---

## 六、Zustand 缓存

**项目未使用 Zustand。** 全局状态管理依赖：
- 组件 `useState` 用于本地 UI 状态
- `localStorage` 用于认证持久化
- SWR 仅用于评估数据

无需操作。

---

## 七、useEffect 重复执行（P1）

### 7.1 通用问题

`useApiFetch` hook（`src/hooks/useApiFetch.ts` 行 127-136）是项目核心数据获取工具，每次 URL 变化或组件挂载都触发请求，无防重复机制。

### 7.2 所有受影响页面

几乎所有 dashboard 页面的 `useEffect(..., [])` 在 StrictMode 下都会触发两次：

```
overview/page.tsx           — 3 个 useEffect → 6 个请求
task-builder/[id]/page.tsx  — 3 个 useEffect → 6 个请求
sessions/[id]/page.tsx      — 1 个 useEffect（9 个串行 fetch） → 18 个请求
sessions/page.tsx           — 1 个 useEffect → 2 个请求
roles/page.tsx              — 2 个 useEffect → 4 个请求
users/page.tsx              — 2 个 useEffect → 4 个请求
mcp-servers/page.tsx        — 2 个 useEffect → 4 个请求
claude/page.tsx             — 1 个 useEffect → 2 个请求
agent-apps/page.tsx         — 1 个 useEffect → 2 个请求
agentflow-pipelines/page.tsx — 1 个 useEffect → 2 个请求
knowledge-graph/page.tsx    — 1 个 useEffect → 2 个请求
```

### 7.3 建议

在 `useApiFetch` 中统一添加防重复机制，或迁移到 SWR/React Query（内置去重）。

---

## 八、内存泄漏（P1）

### 8.1 未清理的 setTimeout

| 文件 | 位置 | 数量 |
|------|------|------|
| `models/page.tsx` | 行 161, 190, 235, 242, 249, 294, 299, 309 | **8 个** |
| `workflows/[id]/page.tsx` | 行 249 | 1 个 |

`setTimeout(() => setError(null), 3000)` 类型的计时器未存储引用，组件卸载后仍可能执行。

### 8.2 流读取器无 AbortController

| 文件 | 位置 | 问题 |
|------|------|------|
| `task-builder/[id]/page.tsx` | 行 233-316 | `subscribeToLogs` 无取消机制，卸载后仍更新状态 |
| `claude/[project]/page.tsx` | 行 245-305 | `sendMessage` 流读取器无已卸载检查 |

### 8.3 SSE 连接无超时保护

`TaskDebugPanel.tsx` 行 57-79：`EventSource` 连接仅在任务完成时关闭（1 秒 setTimeout），若任务永不完成则连接永不关闭。

### 8.4 useRef 无限增长

| 文件 | 位置 | 数据 |
|------|------|------|
| `sessions/[id]/page.tsx` | 行 198 | `childStartedAtRef` 累积子任务时间戳 |
| `sessions/[id]/page.tsx` | 行 207 | `loadedCompletedNodesRef` 累积节点 ID |
| `TaskDebugPanel.tsx` | 行 46 | `logs` 数组通过 SSE 无限追加 |

---

## 九、大对象传递（P1）

### 9.1 Props 传递完整 API 响应

| 父组件 | 子组件 | 传递内容 |
|--------|--------|----------|
| `sessions/[id]/page.tsx` 行 1022-1035 | `EvaluationHeader` | 完整 `evaluation` 对象 + 每次 reduce 计算 token 数 |
| `sessions/[id]/page.tsx` 行 2158 | `MessageBubble` | `message: any`，内部每次渲染执行 `parseContent()` |
| `data-feedback/page.tsx` 行 387 | `TracePanel` | `events: any[]` + `csTask: any` + `instance: any` |
| `task-builder/[id]/page.tsx` 行 1022 | `LogsGroupedDisplay` | 完整 `logs: TaskExecutionLog[]` 数组 |

### 9.2 每次渲染重复计算

`sessions/[id]/page.tsx` 行 1024-1025：
```typescript
totalInputTokens={evaluation?.totalInputTokens || workflowNodes.reduce(...)}
totalOutputTokens={evaluation?.totalOutputTokens || workflowNodes.reduce(...)}
```
`reduce()` 在每次渲染时遍历完整的 `workflowNodes` 数组，应用 `useMemo` 缓存。

---

## 十、页面长期驻留问题（P1）

### 10.1 永不停止的轮询

| 组件 | 间隔 | 停止条件 | 位置 |
|------|------|----------|------|
| `BroadcastMarquee.tsx` | 30s | **永不停止**（布局级组件） | 行 61-65 |
| `useQueueStatus.ts` | 10s | 组件卸载 | 行 129-150 |
| `monitoring/page.tsx` | 30s | 组件卸载 | 行 190 |

`BroadcastMarquee` 存在于全局 layout 中，**每个 dashboard 页面都会持续轮询 `/api/broadcast`**。

### 10.2 卡住时轮询永不停止

| 页面 | 问题 |
|------|------|
| `sessions/[id]/page.tsx` 行 261-289 | 评估卡在 running → 每 5s 永久轮询 |
| `sessions/[id]/page.tsx` 行 479-500 | 用户点击运行节点后离开 → 每 10s 永久轮询 |
| `sessions/page.tsx` 行 232-247 | 评估卡住 → `hasRunningEvaluation` 永不归 false → 永久轮询 |
| `task-builder/[id]/page.tsx` 行 194-220 | 完成后仍轮询 60s（为捕获延迟日志） |

### 10.3 建议

1. 所有轮询增加最大时长上限（如 30 分钟自动停止）
2. `BroadcastMarquee` 改用长轮询或 SSE，或降低频率到 5 分钟
3. 卡住状态检测：连续 N 次数据无变化则降低轮询频率

---

## 十一、修复优先级路线图

### 第一阶段：止血（P0，1-2 天）

| 编号 | 修复项 | 工时 |
|------|--------|------|
| 1 | task-builder 详情日志分离 + 分页 API | 4h |
| 2 | WorkerLogsPage logs/task 端点加分页 | 4h |
| 3 | codeswarm task detail 事件分页 | 3h |

### 第二阶段：降风险（P1，3-5 天）

| 编号 | 修复项 | 工时 |
|------|--------|------|
| 4 | node-data agentMessages 改按需加载 | 6h |
| 5 | useApiFetch 添加防重复守卫 | 2h |
| 6 | 流读取器添加 AbortController | 3h |
| 7 | setTimeout 清理（models 页 8 处） | 1h |
| 8 | 轮询增加最大时长保护 | 2h |
| 9 | sessions/[id] 大状态拆分为子组件 | 6h |

### 第三阶段：架构优化（P2，后续迭代）

| 编号 | 修复项 |
|------|--------|
| 10 | 引入 React Query / 全局 SWR Provider 替代 useApiFetch |
| 11 | 引入 react-virtuoso 虚拟化长列表 |
| 12 | Overview 页改聚合统计端点 |
| 13 | evaluations 模块全部端点加分页 |
| 14 | BroadcastMarquee 降频或改 SSE |
| 15 | SSE/WebSocket 替代高频轮询 |

---

## 附录：优化模式参考

| 场景 | 推荐方案 |
|------|----------|
| 日志/事件列表 | `offset + limit` 分页 + 前端无限滚动 |
| 大文本字段 | 默认截断，`?include=fullResult` 显式请求 |
| 轮询改增量 | 客户端传 `lastFetchTime`，服务端只返回增量 |
| 实时数据 | SSE 推送替代轮询 |
| DB 分页 | 禁止 `findMany` 无 skip/take，禁止 JS 内存 slice |
| 组件大状态 | 拆分子组件 / 用 SWR-React Query 管理 |
| 长列表渲染 | react-virtuoso 虚拟滚动 |
| 流式追加 | useRef 缓冲 + 批量 setState |
