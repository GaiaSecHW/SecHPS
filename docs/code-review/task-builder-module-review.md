# 任务构建模块代码审查报告

> 审查日期：2026-06-03
> 审查范围：任务构建模块全链路（API 11个端点 + 前端 6个页面/组件）
> 审查状态：待评审

## 审查文件清单

### API 端点
| 文件 | 说明 |
|------|------|
| `src/app/api/task-builder/tasks/route.ts` | 任务列表 (GET) + 创建 (POST) |
| `src/app/api/task-builder/tasks/[id]/route.ts` | 任务详情 (GET) + 删除 (DELETE) |
| `src/app/api/task-builder/tasks/[id]/execute/route.ts` | 任务执行 (POST) |
| `src/app/api/task-builder/tasks/[id]/stop/route.ts` | 任务停止 (POST) |
| `src/app/api/task-builder/tasks/[id]/result/route.ts` | 任务结果 (GET) |
| `src/app/api/task-builder/tasks/[id]/download-report/route.ts` | 报告下载 (GET) |
| `src/app/api/task-builder/tasks/[id]/report-files/route.ts` | 报告文件列表 (GET) |
| `src/app/api/task-builder/tasks/[id]/logs/stream/route.ts` | 日志 SSE 流 (GET) |
| `src/app/api/task-builder/available-resources/route.ts` | 可用资源查询 (GET) |
| `src/app/api/task-builder/scripts/route.ts` | 脚本上传/删除 (POST/DELETE) |
| `src/app/api/task-builder/nfs-status/route.ts` | NFS 状态 (GET) |

### 前端页面
| 文件 | 说明 |
|------|------|
| `src/app/dashboard/task-builder/page.tsx` | 任务列表管理页 |
| `src/app/dashboard/task-builder/[id]/page.tsx` | 任务详情页 |
| `src/app/dashboard/task-builder/TaskCreateModal.tsx` | 创建任务弹窗 |
| `src/app/dashboard/task-builder/ParameterForm.tsx` | 参数表单组件 |
| `src/app/dashboard/task-builder/TemplateSelector.tsx` | 模板选择组件 |
| `src/app/dashboard/task-builder/ModeSelectModal.tsx` | 模式选择弹窗 |

---

## 一、权限控制

### 【高】result 接口使用 `authenticateRequest`，缺少租户上下文

**文件**: `src/app/api/task-builder/tasks/[id]/result/route.ts:11`

**问题**: 使用 `authenticateRequest` 而非 `authenticateRequestEnhanced`，缺少租户上下文。权限判断使用 `auth.payload.roles?.includes('admin')`，与同模块其他接口（`[id]/route.ts`、`execute/route.ts` 等）使用 `tenant.isPlatformAdmin` / `tenant.isIcsTenant` 的模式不一致。

**当前代码**:
```ts
const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_READ });
// ...
if (!auth.payload.roles?.includes('admin') && task.userId !== auth.payload.userId) {
```

**建议修复**:
```ts
const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_READ });
if (!auth.success) return authErrorResponse(auth);
const { payload, tenant } = auth as AuthSuccessResult;
// ...
if (!tenant.isPlatformAdmin && !tenant.isIcsTenant && !payload.roles?.includes('admin') && task.userId !== payload.userId) {
```

---

### 【高】available-resources 接口使用 `authenticateRequest`，缺少租户隔离

**文件**: `src/app/api/task-builder/available-resources/route.ts:10`

**问题**: 使用 `authenticateRequest` 而非 `authenticateRequestEnhanced`，Skills 查询只按 `userId` 和 `isPublic` 过滤，没有按 `tenantId` 过滤。普通租户用户可能看到不属于本租户的私有 Skill。

**当前代码**:
```ts
const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
// Skills 查询:
OR: [
  { userId: null },
  { userId: auth.payload.userId },
  { isPublic: true },
],
```

**建议修复**: 升级为 `authenticateRequestEnhanced`，并在 Skills 查询中添加 `tenantId` 过滤。

---

### 【高】scripts 接口使用 `authenticateRequest`，DELETE 无归属校验

**文件**: `src/app/api/task-builder/scripts/route.ts:9, 62`

**问题**: POST 和 DELETE 都使用 `authenticateRequest`。更严重的是 DELETE 端点：任何已认证用户只需提供 `filename` 参数即可删除服务器上的脚本文件，没有检查脚本是否属于该用户/租户。脚本存储在共享文件系统 `data/scripts/`，属于全局资源但无权限隔离。

**当前代码**:
```ts
// DELETE — 无归属校验，任何用户可删除任何脚本
export async function DELETE(request: NextRequest) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  // ...直接按 filename 删除
  fs.unlinkSync(filePath);
```

**建议**: 短期：限制脚本 DELETE 为管理员操作。长期：脚本关联 `userId` / `tenantId`，校验归属。

---

### 【中】nfs-status 接口使用 `authenticateRequest` 且无权限参数

**文件**: `src/app/api/task-builder/nfs-status/route.ts:6`

**问题**: `authenticateRequest(request)` 没有指定 `requiredPermission`，任何已认证用户都可以查询 NFS 配置信息（包含 `mountPath` 内部路径）。

**建议**: 添加权限要求（如 `PERMISSIONS.SESSION_CREATE`）或限制为管理员。

---

### 【中】stop 接口内部调用 codeswarm DELETE 无认证

**文件**: `src/app/api/task-builder/tasks/[id]/stop/route.ts:56-59`

**问题**: 调用 `fetch(${baseUrl}/api/codeswarm/tasks/${task.codeswarmTaskId}, { method: 'DELETE' })` 时未携带任何认证头。codeswarm tasks DELETE 端点本身也没有认证（数据回流审查中已提及），形成双重无认证调用链。

**建议**: 内部调用添加 Service Token 或 Admin JWT。

---

## 二、API 异常处理

### 【高】download-report 接口泄露内部错误信息

**文件**: `src/app/api/task-builder/tasks/[id]/download-report/route.ts:80-83`

**问题**: MinIO 操作失败时将 `error.message` 直接返回客户端，可能泄露 MinIO 连接地址、bucket 名称等内部信息。

**当前代码**:
```ts
return NextResponse.json(
  { error: `下载失败: ${err instanceof Error ? err.message : String(err)}` },
  { status: 500 }
);
```

**建议修复**:
```ts
logger.error(LOG_MODULES.MINIO, '下载报告失败', { details: { error: err instanceof Error ? err.message : String(err) } });
return NextResponse.json({ error: '下载报告失败' }, { status: 500 });
```

---

### 【中】nfs-status 接口暴露 NFS 连接错误详情

**文件**: `src/app/api/task-builder/nfs-status/route.ts:20-23`

**问题**: 连接失败时返回 `error.message`，可能泄露 NFS 服务器地址或网络配置。

**当前代码**:
```ts
return NextResponse.json({
  connected: false,
  error: error instanceof Error ? error.message : 'NFS连接测试失败',
});
```

**建议修复**: 返回通用错误信息 `error: 'NFS连接测试失败'`，将详情记录到日志。

---

### 【中】POST /tasks 创建任务无文件大小限制

**文件**: `src/app/api/task-builder/tasks/route.ts:55-59`

**问题**: `file.arrayBuffer()` 将整个文件加载到内存，后端没有文件大小校验。前端 `TaskCreateModal.tsx` 有 500MB 限制（`NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB`），但攻击者可绕过前端直接调用 API 上传超大文件导致内存溢出。

**建议修复**:
```ts
const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || String(500 * 1024 * 1024));
if (file && file.size > MAX_UPLOAD_SIZE) {
  return NextResponse.json({ error: `文件大小不能超过 ${MAX_UPLOAD_SIZE / 1024 / 1024}MB` }, { status: 400 });
}
```

---

### 【中】scripts DELETE 文件名未做路径遍历检查

**文件**: `src/app/api/task-builder/scripts/route.ts:73-74`

**问题**: `filename` 来自查询参数，`path.join(scriptsDir, filename)` 后未检查结果路径是否仍在 `scriptsDir` 内。攻击者可构造 `filename=../../etc/important` 进行路径遍历删除。

**当前代码**:
```ts
const scriptsDir = path.join(process.cwd(), 'data', 'scripts');
const filePath = path.join(scriptsDir, filename);
// 未检查 filePath 是否在 scriptsDir 内
```

**建议修复**:
```ts
const filePath = path.resolve(scriptsDir, filename);
if (!filePath.startsWith(path.resolve(scriptsDir) + path.sep)) {
  return NextResponse.json({ error: '非法文件名' }, { status: 400 });
}
```

---

## 三、业务逻辑正确性

### 【高】execute 接口 `findUnique` 使用 `OR` 条件语法无效

**文件**: `src/app/api/task-builder/tasks/[id]/execute/route.ts:115-120`

**问题**: `prisma.modelConfig.findUnique({ where: { id, OR: [...] } })` 中 `OR` 不能与 `id` 同时使用。Prisma 的 `findUnique` 要求 where 子句匹配唯一约束，`OR` 是过滤条件。此查询要么报错，要么 Prisma 忽略 `OR` 条件，导致租户隔离失效（用户可能获取到其他租户的 ModelConfig）。

**当前代码**:
```ts
const newModelConfig = await prisma.modelConfig.findUnique({
  where: {
    id: effectiveModelIdPre,
    OR: [
      { tenantId: null },
      { tenantId: payload.tenantId ?? undefined },
      { isPublic: true },
    ],
  },
  select: { apiKey: true, apiBaseUrl: true, models: true },
});
```

**建议修复**:
```ts
const newModelConfig = await prisma.modelConfig.findFirst({
  where: {
    id: effectiveModelIdPre,
    OR: [
      { tenantId: null },
      { tenantId: payload.tenantId ?? undefined },
      { isPublic: true },
    ],
  },
  select: { apiKey: true, apiBaseUrl: true, models: true },
});
```

注：第 193-208 行存在相同问题，同样需要修复。

---

### 【高】execute 接口存在冗余的模型验证死代码

**文件**: `src/app/api/task-builder/tasks/[id]/execute/route.ts:191-208`

**问题**: 第 112-130 行已在 `updateMany` 之前验证模型并赋值 `modelConfigForExec`。第 191-208 行注释"理论上不会走到这里，保留作为防御"再次执行相同查询。但 `modelConfigForExec` 在第 190 行的条件 `!modelConfigForExec && effectiveModelId && effectiveModelId !== task.modelId` 在正常流程下永远为 false（因为第 114 行已处理了 `effectiveModelId !== task.modelId` 的情况）。这段代码是死代码，增加维护负担。

**建议**: 删除第 191-208 行的死代码，保留注释说明模型验证在前方已完成。

---

### 【高】`pollViaRedis` 中 `task_completed` 非 completed 时 timeout 未清理

**文件**: `src/app/api/task-builder/tasks/[id]/execute/route.ts:441-444`

**问题**: 当收到 `task_completed` 事件但 `event.status !== 'completed'` 时，代码先 `subscriber.disconnect()` 再 `reject()`，但 `clearTimeout(timeout)` 未被调用。后续 timeout 回调仍会触发，尝试 disconnect 已断开的 subscriber。

**当前代码**:
```ts
if (event.type === 'task_completed') {
  if (event.status === 'completed') {
    clearTimeout(timeout);  // ✅ 清理了
    subscriber.disconnect();
    // ... resolve
  } else {
    subscriber.disconnect(); // ❌ 未清理 timeout
    reject(new Error(csTask?.error || 'CodeSwarm 任务执行失败'));
  }
}
```

**建议修复**:
```ts
} else {
  clearTimeout(timeout);
  subscriber.disconnect();
  reject(new Error(csTask?.error || 'CodeSwarm 任务执行失败'));
}
```

---

### 【中】stop 接口中 DELETE codeswarm 任务是 fire-and-forget

**文件**: `src/app/api/task-builder/tasks/[id]/stop/route.ts:56-62`

**问题**: DELETE 请求包裹在 `try/catch` 中但 catch 只记录日志，不阻塞后续。接着立即更新 TaskInstance 状态为 `failed`。如果 DELETE 失败（如网络问题），CodeswarmTask 仍在 Worker 上运行，但数据库已标记任务停止。

**建议**: 至少在 DELETE 失败时通知用户（在 errorMessage 中标注"CodeSwarm 任务可能仍在运行"）。

---

### 【中】批量创建任务时同一文件被重复上传 N 次

**文件**: `src/app/dashboard/task-builder/page.tsx:149-197`

**问题**: 选择多个 Agent 时，`handleCreateTask` 对每个 Agent 都创建独立 FormData 并 `POST /api/task-builder/tasks`，同一个文件被上传 N 次（N = Agent 数量）。对于大文件（如 500MB JAR），这意味着上传 500MB × N 的数据量。

**建议**: 短期：先上传文件获取 fileId，再批量创建任务引用 fileId。长期：支持文件去重。

---

### 【中】`codeswarmTaskId` 生成使用 `Date.now() + Math.random()`

**文件**: `src/app/api/task-builder/tasks/[id]/execute/route.ts:242`

**问题**: `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` 在高并发下 `Date.now()` 可能重复，`Math.random()` 不是密码学安全随机。同模块的 `dispatchLogId`（line 317）和 `stopLogId`（stop/route.ts:77）也有同样问题。

**建议**: 使用 `randomUUID()` 或 `crypto.randomUUID()`（已 import）。

---

## 四、React 最佳实践

### 【中】`ENGINE_PROVIDER_MAP` 在两个组件中重复定义

**文件**:
- `src/app/dashboard/task-builder/page.tsx:57-61`
- `src/app/dashboard/task-builder/TaskCreateModal.tsx:51-55`

**问题**: 相同的引擎-提供商映射常量在两个文件中各定义一份。修改一处不会同步到另一处。

**建议**: 抽取到 `src/lib/task-constants.ts` 共享。

---

### 【中】detail page 约 1000 行，职责过多

**文件**: `src/app/dashboard/task-builder/[id]/page.tsx`

**问题**: 页面包含：任务状态展示、执行控制、SSE 日志流、漏洞列表管理、报告下载、markdown 渲染（`renderAgentText` + `renderInlineMarkdown` 共 120 行）、日志分组展示（`LogsGroupedDisplay` 约 200 行）。

**建议**: 拆分为：
- `useTaskDetail(taskId)` — 基础数据 + 轮询
- `useTaskLogs(taskId)` — SSE 日志流
- `useVulnList(taskId)` — 漏洞列表管理
- `AgentTextRenderer` — markdown 渲染组件
- `LogsGroupedDisplay` — 日志分组组件（已独立但仍在同一文件）

---

### 【中】`renderAgentText` 和 `renderInlineMarkdown` 应抽取为独立文件

**文件**: `src/app/dashboard/task-builder/[id]/page.tsx:884-999`

**问题**: 两个通用 markdown 渲染函数（共 116 行）定义在页面文件底部，包含完整的 block/inline 解析逻辑。它们是纯函数，不依赖任何组件状态，适合独立文件。

**建议**: 抽取到 `src/lib/markdown-renderer.tsx`。

---

### 【低】detail page 使用 `console.error` 而非 logger

**文件**: `src/app/dashboard/task-builder/[id]/page.tsx:318, 343`

**问题**:
```ts
console.error('执行失败:', error);
console.error('停止失败:', error);
```

前端代码使用 `console.error`，与项目统一 logger 规范不一致（虽然前端 logger 使用场景有限）。

---

## 五、表单校验

### 【中】scripts POST 文件名无路径遍历检查

**文件**: `src/app/api/task-builder/scripts/route.ts:40`

**问题**: `path.join(scriptsDir, file.name)` 中 `file.name` 来自用户上传，可能包含 `../` 或绝对路径。虽然有 `allowedExtensions` 白名单，但 `../../evil.py` 仍可通过扩展名检查。

**建议**: 与 DELETE 相同，添加路径遍历检查：
```ts
const filePath = path.resolve(scriptsDir, file.name);
if (!filePath.startsWith(path.resolve(scriptsDir) + path.sep)) {
  return NextResponse.json({ error: '非法文件名' }, { status: 400 });
}
```

---

### 【中】POST /tasks 的 `name` 字段缺少格式校验

**文件**: `src/app/api/task-builder/tasks/route.ts:36-47`

**问题**: `name` 只检查非空（`userProvidedName?.trim()`），不校验长度和特殊字符。超长名称导致 UI 溢出，含特殊字符可能影响 NFS 目录创建。

**建议**: 添加长度限制（如 200 字符）和字符白名单。

---

### 【低】ParameterForm 的 `url` 类型参数仅依赖浏览器原生校验

**文件**: `src/app/dashboard/task-builder/ParameterForm.tsx:63-71`

**问题**: `<input type="url">` 的校验行为因浏览器而异，无服务端 URL 格式验证。

---

## 六、性能问题

### 【高】`pollViaDB` 长轮询可达 7 天，持续占用 DB 连接

**文件**: `src/app/api/task-builder/tasks/[id]/execute/route.ts:461-507`

**问题**: 当 Redis 不可用时，退化为 DB 轮询模式：`while (Date.now() - startTime < TIMEOUT_MS)` 循环最长 7 天（`TASK_TIMEOUT_MS`）。每次轮询执行 `prisma.codeswarmTask.findUnique`，占用数据库连接。长时间 HTTP 请求也占用 Node.js 事件循环资源。

**建议**:
1. 优先确保 Redis 可用（生产环境必须有 Redis）
2. DB 轮询模式下设置更短的超时（如 2 小时）
3. 使用 Webhook/回调模式替代长轮询

---

### 【高】GET /tasks 每次列表查询都批量查 Worker 信息

**文件**: `src/app/api/task-builder/tasks/route.ts:137-155`

**问题**: 每次分页查询任务列表，额外执行一次 `$queryRaw` JOIN 查询获取 Worker 信息。对于 10 条/页的查询，这个额外查询是合理的，但如果 Worker 信息可以延迟加载（仅 running 任务需要），可以减少不必要的查询。

**建议**: 仅对 `status=running` 的任务查询 Worker 信息。

---

### 【中】detail page 5 秒轮询频率过高

**文件**: `src/app/dashboard/task-builder/[id]/page.tsx:179-181`

**问题**: running 状态下每 5 秒执行 `fetchTaskDetail`，每次查询返回完整任务详情 + **所有日志**（`include: { TaskExecutionLog: { orderBy: ... } }`）。长任务（数小时）运行期间，日志量持续增长，每次轮询传输的数据量越来越大。

**建议**:
1. 轮询仅查任务状态（不含日志），日志使用 SSE 增量获取
2. 已有 SSE 订阅能力（`subscribeToLogs`），但轮询仍在运行——二者应互斥

---

### 【中】`available-resources` 加载全部活跃 Skill 无分页

**文件**: `src/app/api/task-builder/available-resources/route.ts:20-38`

**问题**: `findMany` 加载所有 `isLatest && isActive` 的 Skill，无 `take` 限制。Skill 数量增长后响应体积增大。

**建议**: 添加 `take: 200` 上限，或改用前端按需搜索。

---

## 七、潜在 Bug

### 【高】GET [id] 详情查询包含全量日志，无数量限制

**文件**: `src/app/api/task-builder/tasks/[id]/route.ts:24-28`

**问题**: `include: { TaskExecutionLog: { orderBy: { timestamp: 'asc' } } }` 无 `take` 限制。长时任务可能产生数千条日志，一次性加载全部日志导致响应体积过大。代码中还额外查询了 `codeswarmEvent.findMany({ take: 10 })`，但 TaskExecutionLog 没有 `take`。

**建议**: 添加 `take: 500` 限制，或提供分页参数。前端 SSE 已支持增量获取日志。

---

### 【中】detail page SSE 和轮询同时运行产生重复数据

**文件**: `src/app/dashboard/task-builder/[id]/page.tsx:175-201, 214-297`

**问题**: `handleExecute` 调用 `subscribeToLogs(taskId)` 开启 SSE 流式接收日志。但 `useEffect` 中的轮询（line 179）仍在运行（每 5 秒调用 `fetchTaskDetail`，后者重置 `setLogs`）。两者同时更新 `logs` 状态，导致：
1. SSE 增量添加的日志被轮询的全量覆盖
2. 相同日志条目被重复添加

**建议**: SSE 连接建立后暂停轮询，SSE 断开后恢复轮询。

---

### 【中】`handleVulnAction` 的 action 值未经后端校验

**文件**: `src/app/dashboard/task-builder/[id]/page.tsx:398-417`

**问题**: `action` 参数直接拼接到 API URL：`/api/vulnerabilities/${vulnId}/${action}`。`action` 来自硬编码的几个值（`confirm`、`false-positive`、`fix`、`verify`），安全风险不高，但如果未来添加新 action 未同步后端校验，可能导致 404 或意外行为。

---

### 【低】`LogsGroupedDisplay` 每次渲染都重新计算分组

**文件**: `src/app/dashboard/task-builder/[id]/page.tsx:1009-1033`

**问题**: `groupedLogs` 使用 `useMemo` 包裹了，但依赖项是 `[logs]`。`logs` 数组在 SSE 接收时频繁更新（每次新日志都创建新数组），导致 `useMemo` 频繁重计算。对于 `logs.filter()` 四次遍历 + `reduce` 计算工具统计，在日志量大时（>1000 条）可能有性能影响。

**建议**: 使用增量更新策略：只处理新增日志，避免每次全量遍历。

---

## 汇总

| 严重级别 | 数量 | 关键问题 |
|---------|------|---------|
| **高** | 8 | result/available-resources/scripts 认证缺失、findUnique OR 语法错误、pollViaRedis timeout 泄漏、download-report 错误泄露、pollViaDB 7天轮询、详情页全量日志 |
| **中** | 14 | nfs-status 无权限、scripts 路径遍历、stop fire-and-forget、批量上传重复、文件大小无后端校验、SSE 与轮询冲突、detail page 职责过多等 |
| **低** | 4 | console.error 未替换、ParameterForm URL 校验、LogsGroupedDisplay 性能、console.error |

## 建议修复优先级

1. **P0（立即修复）**: result 和 available-resources 认证升级、findUnique 改 findFirst、pollViaRedis timeout 清理、download-report 错误脱敏、scripts 路径遍历修复
2. **P1（本迭代）**: scripts 权限隔离、POST /tasks 文件大小限制、name 格式校验、detail page SSE 与轮询互斥、detail page 全量日志限制、ENGINE_PROVIDER_MAP 去重、execute 死代码清理
3. **P2（下迭代）**: detail page 拆分 Hook/组件、markdown 渲染抽取、pollViaDB 超时缩短、批量上传优化、available-resources 分页
