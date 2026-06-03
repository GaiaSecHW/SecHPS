# 智能体集群模块代码审查报告

> 审查日期：2026-06-03
> 审查范围：智能体集群模块（Dispatcher 调度器 + 节点管理 + Session 提取 + 本地测试 + 文件浏览），不含数据回流审查已覆盖的 Worker 回调/Result 解析
> 审查状态：待评审

## 汇总

| 严重级别 | 数量 | 关键问题 |
|---------|------|---------|
| **高** | 10 | 11 个管理接口无认证、browse-dirs 文件系统遍历、local-test RCE、Worker Token 泄露、Dispatcher 多实例不一致、并行分发过载、fire-and-forget 子进程、workspacePath 无白名单 |
| **中** | 12 | SQLite 连接泄漏、JSON.parse 无保护、SSE 高频轮询、地址排序不一致、目录浏览器重复、错误信息泄露等 |
| **低** | 7 | console.error、confirm()、onlineCount 未使用、isSkill 过宽等 |

## 建议修复优先级

1. **P0（立即修复）**: 所有管理接口添加认证、browse-dirs 添加路径白名单、local-test 添加认证+路径白名单、nodes 接口移除 token 字段、错误信息脱敏
2. **P1（本迭代）**: Dispatcher 并行分发改为串行或原子选择、local-test TaskInstance 关联用户、SQLite try-finally、SSE 添加退避、session-extract/history 添加认证
3. **P2（下迭代）**: 目录浏览器抽取共享组件、LocalTestPanel 拆分、地址排序统一、local-test 添加取消机制、nodes 分页支持

## 审查文件清单

### API 端点
| 文件 | 说明 |
|------|------|
| `src/app/api/codeswarm/nodes/route.ts` | Worker 节点列表 (GET) |
| `src/app/api/codeswarm/nodes/[nodeId]/route.ts` | 节点详情/更新/删除 (GET/PATCH/DELETE) |
| `src/app/api/codeswarm/session-extract/route.ts` | Session 提取 (POST) |
| `src/app/api/codeswarm/session-extract/history/route.ts` | 提取历史列表/清空 (GET/DELETE) |
| `src/app/api/codeswarm/session-extract/history/[id]/route.ts` | 历史详情/删除 (GET/DELETE) |
| `src/app/api/codeswarm/browse-dirs/route.ts` | 服务器目录浏览 (GET) |
| `src/app/api/codeswarm/download-report/route.ts` | 报告下载 (GET) |
| `src/app/api/codeswarm/local-test/route.ts` | 本地测试 (POST/GET) |
| `src/app/api/codeswarm/local-test/files/route.ts` | 本地测试文件 (GET) |
| `src/app/api/codeswarm/tasks/[taskId]/logs/route.ts` | 任务日志 (GET) |
| `src/app/api/codeswarm/tasks/[taskId]/stream/route.ts` | 任务 SSE 流 (GET) |

### 核心服务
| 文件 | 说明 |
|------|------|
| `src/services/codeswarm-dispatcher.ts` | Redis 驱动的任务调度器 (1038 行) |
| `src/lib/codeswarm-worker-auth.ts` | Worker JWT 认证工具 |

### 前端组件
| 文件 | 说明 |
|------|------|
| `src/components/codeswarm/WorkerNodesTable.tsx` | Worker 节点表格 |
| `src/components/codeswarm/LocalTestPanel.tsx` | 本地测试面板 (~900 行) |
| `src/components/codeswarm/SessionExtractPanel.tsx` | Session 提取面板 (~730 行) |

---

## 一、权限控制

### 【高】所有 codeswarm 管理接口完全没有认证

**文件**: 上述 11 个 API 端点中，除 `session-extract` POST 使用旧版 `authenticateRequest` 外，其余全部无任何认证。

**问题**: 这是本次审查最严重的问题。以下接口任何人都可以直接访问：

| 端点 | 风险 |
|------|------|
| `browse-dirs` | 遍历服务器完整文件系统，读取目录结构 |
| `local-test` POST | 触发 opencode 子进程执行，任意代码执行 |
| `nodes` DELETE | 删除 Worker 节点，破坏集群 |
| `nodes` PATCH | 修改 Worker 并发数，影响调度 |
| `download-report` | 下载任意任务的报告文件 |
| `session-extract` | 读取 opencode.db 中的 Session 数据 |
| `session-extract/history` DELETE | 清空所有提取历史 |
| `tasks/[taskId]/logs` | 读取任意任务日志 |
| `tasks/[taskId]/stream` | SSE 订阅任意任务事件 |

**建议修复**: 所有管理接口添加 `authenticateRequestEnhanced` + 管理员权限检查。`browse-dirs` 和 `local-test` 必须限制为管理员或至少已认证用户。

---

### 【高】browse-dirs 接口无路径白名单，暴露服务器完整文件系统

**文件**: `src/app/api/codeswarm/browse-dirs/route.ts:125-209`

**问题**: 接受任意 `path` 参数并返回目录内容。虽然过滤了隐藏文件（`.xxx`）和 Windows 系统目录（`$` 前缀、`System Volume Information`），但没有路径白名单。攻击者可以浏览 `/etc`、`/root`、`C:\Windows` 等敏感目录，获取服务器文件结构信息。

**建议修复**: 添加路径白名单，仅允许浏览配置的工作区目录（如 `NFS_MOUNT_PATH`、`SHARED_WORKSPACE_PATH`）。

---

### 【高】local-test POST 接口无认证，可触发服务器端 opencode 子进程

**文件**: `src/app/api/codeswarm/local-test/route.ts:189-242`

**问题**: 任何人都可以 POST 一个 `workspacePath`，触发服务器端 `opencode` 子进程执行。这是一个远程代码执行（RCE）风险——虽然指令是固定的（解析漏洞报告），但子进程在指定目录下执行，可能读取敏感文件。

**建议修复**: 添加认证 + 路径白名单。

---

### 【高】nodes 端点返回 Worker JWT Token

**文件**: `src/app/api/codeswarm/nodes/route.ts:9`、`src/app/api/codeswarm/nodes/[nodeId]/route.ts:15`

**问题**: SQL 查询 `SELECT ... token ...` 将 Worker 的 JWT Token 返回给前端。Worker Token 用于 Worker 身份验证，泄露后攻击者可以伪造 Worker 身份。

**当前代码**:
```sql
SELECT id, "nodeId", address, ..., token, "lastHeartbeat", ...
FROM "CodeswarmWorker"
```

**建议修复**: 从 SELECT 中移除 `token` 字段，仅在后端内部使用。

---

### 【中】session-extract 使用旧版 `authenticateRequest`，无租户上下文

**文件**: `src/app/api/codeswarm/session-extract/route.ts:56`

**问题**: 使用 `authenticateRequest` 而非 `authenticateRequestEnhanced`，缺少租户上下文。`history` 和 `history/[id]` 的 GET/DELETE 端点甚至完全没有认证。

**建议**: 统一使用 `authenticateRequestEnhanced`，history 接口也添加认证。

---

## 二、API 异常处理

### 【高】多个接口直接暴露 `error.message` 给客户端

**文件**:
- `src/app/api/codeswarm/local-test/route.ts:239` — POST 错误
- `src/app/api/codeswarm/local-test/route.ts:269` — GET 错误
- `src/app/api/codeswarm/download-report/route.ts:45`
- `src/app/api/codeswarm/browse-dirs/route.ts:206`

**问题**: 这些接口将 `error.message` 直接返回客户端，可能泄露文件系统路径、MinIO 配置、数据库信息等。

**建议修复**: 统一使用 `logger.error` 记录详情，返回通用错误信息。

---

### 【中】session-extract POST 接口泄露内部错误

**文件**: `src/app/api/codeswarm/session-extract/route.ts:274`

**问题**: `{ error: '解析失败: ' + String(error) }` 暴露 SQLite 查询错误、文件路径等内部信息。

**建议修复**:
```ts
logger.errorNoUser(LOG_MODULES.SESSION, 'Session 解析失败', { details: { error: String(error) } });
return NextResponse.json({ error: '解析失败' }, { status: 500 });
```

---

## 三、业务逻辑正确性

### 【高】Dispatcher 是模块级单例，多实例部署时内存拓扑不一致

**文件**: `src/services/codeswarm-dispatcher.ts:23, 1038`

**问题**: `export const codeswarmDispatcher = new CodeswarmDispatcher()` 是模块级单例。`workers Map`、Redis 连接、定时器都在进程内存中。多实例部署（负载均衡）时：
1. Worker 心跳只到达一个实例，其他实例的 workers Map 中该节点不存在
2. `selectWorker` 可能选择"满载"实例记忆中的"空闲" Worker
3. 超时检测只在一个实例上运行

**建议**: 短期：确保只运行一个 Dispatcher 实例（sticky session 或 leader election）。长期：Worker 拓扑存 Redis。

---

### 【高】local-test 创建的 TaskInstance 无用户关联

**文件**: `src/app/api/codeswarm/local-test/route.ts:214-226`

**问题**: `taskInstance.create` 没有设置 `userId` 和 `tenantId`，创建的是孤儿记录。这些任务不出现在任何用户的任务列表中，但会占用数据库空间。如果漏洞入库成功，漏洞也无法关联到用户。

**建议修复**: local-test 也应该接收认证 Token，设置 `userId` 和 `tenantId`。

---

### 【高】local-test 漏洞入库调用 v1 API 无认证

**文件**: `src/app/api/codeswarm/local-test/route.ts:386`

**问题**: `fetch('http://localhost:${process.env.PORT || 3000}/api/v1/vulnerabilities')` 不带任何认证头。如果 v1 vulnerabilities 接口需要认证，漏洞入库会静默失败。

**当前代码**:
```ts
const vulnRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/v1/vulnerabilities`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(vulnRequestBody),
});
```

**建议修复**: 添加 Service Token 或 Admin JWT 作为内部调用凭证。

---

### 【高】Dispatcher `dispatchLoop` 并行分发可能导致 Worker 过载

**文件**: `src/services/codeswarm-dispatcher.ts:373-388`

**问题**: `Promise.allSettled(msgs.map(...))` 并行分发最多 5 个任务。每个 `dispatchOne` 调用 `worker.currentTasks++` 是同步的，但 `selectWorker` 读取 `currentTasks` 时可能仍是旧值。在高并发场景下，多个任务可能同时选中同一个 Worker，导致实际发送的任务数超过 `maxConcurrent`。

**当前代码**:
```ts
// dispatchLoop — 并行 5 个
await Promise.allSettled(
  msgs.map(async ([msgId, fields]) => {
    const dispatched = await this.dispatchOne(dbTaskId); // 每个 dispatchOne 独立选择 Worker
    // ...
  })
);
```

**建议修复**: 改为串行分发（for...of），或在 selectWorker 时使用原子检查+递增。

---

### 【中】session-extract SQLite 连接可能泄漏

**文件**: `src/app/api/codeswarm/session-extract/route.ts:70-101`

**问题**: `db = new Database(dbPath, { readonly: true })` 打开后，如果第 74-79 行的 `session` 查询抛异常，`db.close()` 不会被执行。第 88-89 行只处理了 "session 不存在" 的 close，查询异常的路径没有被保护。

**建议修复**: 使用 try-finally 包裹整个 DB 操作：
```ts
const db = new Database(dbPath, { readonly: true });
try {
  const session = db.prepare(...).get(...);
  if (!session) return ...;
  const parts = db.prepare(...).all(...);
  // ...
} finally {
  db.close();
}
```

---

### 【中】nodes/[nodeId] GET 端点的 JSON.parse 无 try-catch

**文件**: `src/app/api/codeswarm/nodes/[nodeId]/route.ts:58-60`

**问题**: `JSON.parse(row.skills)`、`JSON.parse(row.mcps)`、`JSON.parse(row.events)` 没有 try-catch 保护。如果数据库中存储了格式错误的 JSON（如手动修改或迁移遗留），整个请求会返回 500。

**建议修复**: 包裹 try-catch，解析失败时使用 fallback 值 `null`。

---

### 【中】session-extract 的 `isSkill` 函数匹配过于宽泛

**文件**: `src/app/api/codeswarm/session-extract/route.ts:43-48`

**问题**: `if (lower.includes('skill')) return true` 会匹配 `killSkill`、`skillful`、`unskilled` 等非 Skill 工具名。

**建议修复**: 使用更精确的匹配：`if (lower === 'skill' || lower.startsWith('skill-')) return true`。

---

### 【低】`recoverWorkersFromDB` 中 `onlineCount` / `offlineCount` 声明但未使用

**文件**: `src/services/codeswarm-dispatcher.ts:508-509`

**问题**: `const onlineCount = 0; const offlineCount = 0;` 声明后从未读取。

---

## 四、React 最佳实践

### 【中】目录浏览器组件在 LocalTestPanel 和 SessionExtractPanel 中完全重复

**文件**:
- `src/components/codeswarm/LocalTestPanel.tsx:336-392`（~60 行）
- `src/components/codeswarm/SessionExtractPanel.tsx:255-335`（~80 行）

**问题**: 两个组件各自实现了完整的目录浏览器弹窗，包含相同的 `browseDirectory`、`goUpDir`、`loadRootEntries` 逻辑和几乎相同的 UI 代码。

**建议**: 抽取为 `src/components/ui/DirectoryBrowser.tsx` 共享组件。

---

### 【中】LocalTestPanel 约 900 行，职责过多

**文件**: `src/components/codeswarm/LocalTestPanel.tsx`

**问题**: 组件包含：工作区选择、目录浏览、测试执行、轮询、历史管理、文件管理、日志解析、时间线渲染。约 20 个 `useState`。

**建议**: 拆分为 `useLocalTest(taskId)` Hook + `DirectoryBrowser` + `TestHistory` + `ParseTimeline` 等子组件。

---

### 【低】WorkerNodesTable 使用 `confirm()` 而非自定义确认弹窗

**文件**: `src/components/codeswarm/WorkerNodesTable.tsx:36`

**问题**: `if (!confirm('确定要删除这个 Worker 节点吗？'))` 使用浏览器原生 confirm，与项目其他地方使用的 `ConfirmDialog` 不一致。

---

### 【低】LocalTestPanel 使用 `console.error`

**文件**: `src/components/codeswarm/LocalTestPanel.tsx:153`

**问题**: `console.error('Poll error:', e)` 未使用项目统一 logger。

---

## 五、表单校验

### 【高】local-test `workspacePath` 仅检查非空和存在，无路径白名单

**文件**: `src/app/api/codeswarm/local-test/route.ts:194-200`

**问题**: 只检查 `!workspacePath` 和 `fs.existsSync(workspacePath)`。路径 `/etc`、`C:\Windows` 等都能通过验证，触发 opencode 在敏感目录执行。

**建议修复**: 添加路径白名单（如 `NFS_MOUNT_PATH`、`SHARED_WORKSPACE_PATH` 下），拒绝不在白名单内的路径。

---

### 【中】session-extract `workspacePath` 仅检查非空

**文件**: `src/app/api/codeswarm/session-extract/route.ts:65-67`

**问题**: 只检查 `!workspacePath`，不检查路径是否存在。传入不存在的路径时，SQLite 查询找不到匹配 session，返回 404，但没有提前验证。

**建议**: 添加 `fs.existsSync` 检查，给出更友好的错误提示。

---

### 【低】nodes PATCH 的 `maxConcurrent` 只做了范围限制，未校验 `status` 值域

**文件**: `src/app/api/codeswarm/nodes/[nodeId]/route.ts:88-93`

**问题**: `maxConcurrent` 限制在 1-50，`status` 和 `name` 直接赋值，没有校验合法值。

---

## 六、性能问题

### 【高】tasks/[taskId]/stream SSE 每 500ms 轮询数据库

**文件**: `src/app/api/codeswarm/tasks/[taskId]/stream/route.ts:30-68`

**问题**: 每隔 500ms 执行 `codeswarmEvent.findMany` + `codeswarmTask.findUnique`。对于长时任务（数小时），这意味着每秒 2 次数据库查询 × 持续数小时 = 数万次查询。无退避机制。

**建议**: 添加渐进退避（如 500ms → 1s → 2s → 5s），或改用 eventBus 推送。

---

### 【中】nodes GET 端点硬编码 LIMIT 100

**文件**: `src/app/api/codeswarm/nodes/route.ts:13`

**问题**: `LIMIT 100` 无分页参数。Worker 超过 100 个时无法查看全部。

**建议**: 添加分页或移除 LIMIT（Worker 数量通常不多）。

---

### 【中】Dispatcher `sendTaskToWorker` 串行尝试多个地址

**文件**: `src/services/codeswarm-dispatcher.ts:195-232`

**问题**: `for (const addr of sorted)` 串行尝试每个地址，每个地址最多等 10 秒超时。如果有 3 个地址且前两个不可达，分发延迟可达 20 秒。

**建议**: 使用 `Promise.any` 并行尝试多个地址，或使用更短的超时（5 秒）。

---

### 【低】session-extract 中 skillGroups 的 reasoning 归属算法是 O(S×G)

**文件**: `src/app/api/codeswarm/session-extract/route.ts:206-243`

**问题**: 外层遍历所有 allParts（含 reasoning/text），内层遍历所有 skillGroups。对于大量 parts 和 groups，这是 O(N×G) 的复杂度。实际场景中 parts 通常 <1000，影响不大。

---

## 七、潜在 Bug

### 【高】local-test `executeTaskAsync` 是 fire-and-forget，无法取消

**文件**: `src/app/api/codeswarm/local-test/route.ts:275-420`

**问题**: `executeTaskAsync` 启动 opencode 子进程（最长 600 秒）和漏洞入库 API 调用，但没有 AbortController 支持。如果服务器重启，子进程成为孤儿进程。如果用户想要取消测试，没有办法。

**建议**: 存储 childProcess 引用，提供取消 API 端点。

---

### 【中】tasks/[taskId]/stream SSE 不检查任务是否存在

**文件**: `src/app/api/codeswarm/tasks/[taskId]/stream/route.ts:16-68`

**问题**: 直接进入轮询循环，不先检查 `taskId` 对应的 CodeswarmTask 是否存在。如果 taskId 无效，SSE 会持续 500ms 轮询但不返回任何有用数据，直到客户端断开。

**建议**: 在 start 中先查询 `codeswarmTask.findUnique`，不存在则立即关闭 stream。

---

### 【中】Dispatcher 地址排序逻辑与前端 WorkerNodesTable 不一致

**文件**:
- `src/services/codeswarm-dispatcher.ts:150-162`
- `src/components/codeswarm/WorkerNodesTable.tsx:178-187`

**问题**: Dispatcher 中 Docker 172.17-21 IP 得分 3（较低优先级），其他 172.x 得分 2；前端 WorkerNodesTable 中所有 172.x 得分 0（最高优先级）。排序逻辑不一致可能导致调试困惑——前端显示的第一个地址不是 Dispatcher 优先使用的地址。

**建议**: 统一地址排序逻辑到共享模块。

---

### 【低】local-test 中 `getTaskContext` 使用硬编码回退值

**文件**: `src/app/api/codeswarm/local-test/route.ts:42-43, 56-57`

**问题**: `productName` 默认为 `'default'`，`taskInstance.name` 默认为 `'local-test'`。如果任务不存在，漏洞入库到 `default` 产品下。

---
