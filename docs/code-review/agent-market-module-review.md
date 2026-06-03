# Agent 市场模块代码审查报告

> 审查日期：2026-06-03
> 审查范围：Agent 市场模块全链路（API + 前端页面）
> 审查状态：待评审

## 审查文件清单

### API 端点
| 文件 | 说明 |
|------|------|
| `src/app/api/agent-apps/route.ts` | 应用列表 (GET) + 创建 (POST) |
| `src/app/api/agent-apps/[id]/route.ts` | 详情/更新/删除 (GET/PUT/DELETE) |
| `src/app/api/agent-apps/[id]/branches/route.ts` | 分支查询 (GET) |
| `src/app/api/agent-apps/[id]/pipeline/route.ts` | Pipeline 解析 (GET) |
| `src/app/api/agent-apps/sync/route.ts` | 仓库同步 (POST) |

### 前端页面
| 文件 | 说明 |
|------|------|
| `src/app/dashboard/agent-apps/page.tsx` | 列表页 |
| `src/app/dashboard/agent-apps/CreateAgentAppModal.tsx` | 创建弹窗 |
| `src/app/dashboard/agent-apps/AppDetailModal.tsx` | 编辑弹窗 |
| `src/components/agent-apps/PipelineViewModal.tsx` | Pipeline 视图弹窗 |

---

## 一、权限控制

### 【高】branches 接口使用 `authenticateRequest`，缺少租户上下文

**文件**: `src/app/api/agent-apps/[id]/branches/route.ts:14`

**问题**: branches 接口使用 `authenticateRequest` 而非 `authenticateRequestEnhanced`，缺少租户上下文。权限检查完全依赖手动判断 `auth.payload.roles?.includes('admin')`，没有使用 `tenant.isPlatformAdmin` / `tenant.isIcsTenant` / `buildTenantFilter`。同模块其他接口（`[id]/route.ts`、`[id]/pipeline/route.ts`）均已升级为 `authenticateRequestEnhanced`，此处遗漏。

**当前代码**:
```ts
const auth = authenticateRequest(request);
if (!auth.success) return authErrorResponse(auth);
// ...
if (!app.isPublic && app.userId !== auth.payload.userId && !auth.payload.roles?.includes('admin')) {
```

**建议修复**:
```ts
const auth = authenticateRequestEnhanced(request);
if (!auth.success) return authErrorResponse(auth);
const { tenant, payload } = auth as AuthSuccessResult;
// 使用 tenant 上下文做权限判断
if (!tenant.isPlatformAdmin && !tenant.isIcsTenant) {
  if (!app.isPublic && app.userId !== payload.userId) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }
}
```

---

### 【高】PUT 更新接口缺少 `isPublic` 权限校验

**文件**: `src/app/api/agent-apps/[id]/route.ts:62-213`

**问题**: POST 创建时有明确检查：

```ts
if (isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
  return NextResponse.json({ error: '只有 ICSL 租户或管理员可以创建公共资源' }, { status: 403 });
}
```

但 PUT 更新接口完全缺少此检查。普通用户可以将自己的私有应用改为公开（`isPublic: true`），绕过权限控制。

**建议修复**: 在 PUT handler 的参数解析后、业务逻辑前加上同样的 `isPublic` 权限校验：

```ts
if (isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
  return NextResponse.json({ error: '只有 ICSL 租户或管理员可以设置公开资源' }, { status: 403 });
}
```

---

### 【中】GET /api/agent-apps 认证函数不统一

**文件**: `src/app/api/agent-apps/route.ts:20`、`src/app/api/agent-apps/sync/route.ts:10`

**问题**: GET 列表和 POST 创建使用 `authenticateRequestAsync`，而 `[id]/route.ts` 和 `pipeline/route.ts` 使用 `authenticateRequestEnhanced`，branches 使用 `authenticateRequest`。三种认证函数混用，增加维护负担和理解成本。

**建议**: 统一为 `authenticateRequestEnhanced`（同步版本），保持模块内一致性。

---

## 二、API 异常处理

### 【高】pipeline 接口错误响应泄露内部信息

**文件**: `src/app/api/agent-apps/[id]/pipeline/route.ts:113-119`

**问题**: catch 块中将 `error.message` 直接返回给客户端，可能泄露 Gitea 配置、文件路径等内部信息。

**当前代码**:
```ts
return NextResponse.json(
  { error: '获取 pipeline 失败', details: error instanceof Error ? error.message : 'Unknown error' },
  { status: 500 }
);
```

**建议修复**:
```ts
logger.error(LOG_MODULES.AGENT, '获取 pipeline 失败', { details: { error: error instanceof Error ? error.message : String(error) } });
return NextResponse.json({ error: '获取 pipeline 失败' }, { status: 500 });
```

---

### 【中】POST 创建时 Gitea 错误信息泄露

**文件**: `src/app/api/agent-apps/route.ts:229-232`

**问题**: Gitea 操作失败时将 `giteaError.message` 返回客户端，可能包含 Gitea 服务器内部信息（URL、配置等）。

**当前代码**:
```ts
return NextResponse.json({
  error: giteaError instanceof Error ? giteaError.message : 'Gitea 创建仓库失败',
}, { status: 500 });
```

**建议修复**:
```ts
return NextResponse.json({ error: '创建仓库失败，请稍后重试' }, { status: 500 });
```

---

### 【中】branches 接口缺少 Gitea 异常保护

**文件**: `src/app/api/agent-apps/[id]/branches/route.ts:32-37`

**问题**: 已有 `if (!app.agentHarnessPath)` 保护返回空数组，但 `getOrgRepoBranches` 调用没有 try-catch。如果 Gitea 不可用，会直接返回 500。

**建议**: 包裹 try-catch，Gitea 异常时降级返回空数组或友好错误。

---

## 三、业务逻辑正确性

### 【高】pipeline 接口存在不可达的死代码

**文件**: `src/app/api/agent-apps/[id]/pipeline/route.ts:46-58`

**问题**: 第 46 行已检查 `if (!app)` 并 return 404，第 56 行又检查 `if (!app)` 并 return 404。第二个检查永远不可达，是重构遗留代码。

**当前代码**:
```ts
if (!app) {
  return NextResponse.json({ error: '应用不存在' }, { status: 404 });
}
// 权限检查...
if (!app) {  // 死代码
  return NextResponse.json({ error: '应用不存在或无权限访问' }, { status: 404 });
}
```

**建议修复**: 删除第 56-58 行的死代码。

---

### 【中】POST 创建时空 `filesMap` 仍会创建应用

**文件**: `src/app/api/agent-apps/route.ts:165-253`

**问题**: 如果上传的是空压缩包（只有目录没有文件），`filesMap` 为空，Gitea 仓库被创建但不推送任何文件。随后 AgentApp 记录被创建，但关联的仓库是空的。

**建议修复**:
```ts
if (filesMap.size === 0) {
  return NextResponse.json({ error: '上传的文件中没有有效内容' }, { status: 400 });
}
```

---

### 【中】PUT 更新时 Gitea 上传失败不阻塞响应

**文件**: `src/app/api/agent-apps/[id]/route.ts:171-183`

**问题**: Gitea 文件更新失败时只记录日志，数据库仍然更新成功。前端得到成功响应但文件实际未更新，用户可能认为文件已更新。

**建议**: 如果文件上传是用户明确操作，应返回失败；至少在响应中明确告知文件上传失败（当前有 `giteaUploaded` 字段，但前端未检查）。

---

### 【低】`handleRefresh` 使用 `setTimeout` 伪造加载状态

**文件**: `src/app/dashboard/agent-apps/page.tsx:124-128`

**问题**: `await fetchApps()` 已完成，再用 `setTimeout(() => setRefreshing(false), 500)` 人为延迟 500ms，无意义。

**建议**: 直接在 `fetchApps` 的 finally 中设置 `setRefreshing(false)`。

---

## 四、React 最佳实践

### 【中】页面加载时并行请求所有应用的分支数据

**文件**: `src/app/dashboard/agent-apps/page.tsx:87-108`

**问题**: 获取应用列表后，立即对所有有 `agentHarnessPath` 的应用发起并行 branches 请求。如果应用数量多（50+），会产生大量并发 HTTP 请求，可能导致浏览器连接池耗尽或触发服务端限流。

**当前代码**:
```ts
Promise.all(withHarness.map(async (a: AgentApp) => {
  const res = await fetch(`/api/agent-apps/${a.id}/branches`, ...);
})).then(results => { ... });
```

**建议**: 改为懒加载（用户点击展开时才请求），或在服务端聚合返回。

---

### 【中】`isAdmin` 判断逻辑在三个组件中重复

**文件**:
- `src/app/dashboard/agent-apps/page.tsx:61-66`
- `src/app/dashboard/agent-apps/CreateAgentAppModal.tsx:58-82`
- `src/app/dashboard/agent-apps/AppDetailModal.tsx:67-91`

**问题**: 三个组件都独立解析 JWT payload 判断 `isAdmin` / `isIcsOrAdmin`，且逻辑略有差异（page.tsx 从 `localStorage.user` 读 roles，Modal 从 JWT 解析 permissions）。应抽取为共享 Hook。

**建议**: 创建 `useIsAdmin()` Hook 统一逻辑。

---

### 【低】多处 `console.error` / `console.log` 未替换为统一 logger

**文件**: `CreateAgentAppModal.tsx:203, 210, 212, 293, 294, 296, 304`、`page.tsx:111, 116`

**问题**: 自动检测相关的调试日志和错误日志使用 `console.log/error`，未使用项目统一的 logger。

---

## 五、表单校验

### 【中】上传接口缺少文件大小限制

**文件**: `src/app/api/agent-apps/route.ts:138-140`

**问题**: POST 创建和 PUT 更新都没有对上传文件大小做限制。恶意用户可以上传超大压缩包导致服务端内存溢出（`file.arrayBuffer()` 将整个文件加载到内存）。

**建议修复**:
```ts
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
if (agentHarnessFile && agentHarnessFile.size > MAX_FILE_SIZE) {
  return NextResponse.json({ error: '文件大小不能超过 100MB' }, { status: 400 });
}
```

---

### 【中】AppDetailModal 编辑时无 Harness 结构校验

**文件**: `src/app/dashboard/agent-apps/AppDetailModal.tsx:141-164`

**问题**: CreateAgentAppModal 有 `validateHarnessStructure` 函数校验上传的 Harness 文件是否包含 `.opencode` 或 `.claude` 文件夹。但 AppDetailModal 的 `handleFileSelect` 完全没有此校验，用户可以在编辑时上传任意格式的文件。

**建议**: 将 `validateHarnessStructure` 抽取为共享函数，Create 和 Edit 都调用。

---

### 【低】`name` 字段缺少格式和长度校验

**文件**: `src/app/api/agent-apps/route.ts:134-136`

**问题**: `name` 只检查非空，不检查长度和特殊字符。超长名称可能导致 UI 溢出。

---

## 六、性能问题

### 【高】GET /api/agent-apps 无分页，全量返回

**文件**: `src/app/api/agent-apps/route.ts:19-58`

**问题**: 列表接口没有分页参数，返回所有应用（含关联查询 Tenant、User），再加上 metrics 的 raw SQL 查询。随着应用数量增长，响应体积和数据库压力会线性增加。

**建议**: 添加分页参数（`page`、`limit`），或至少限制返回数量。

---

### 【中】GET /api/agent-apps 使用 `$queryRawUnsafe` 做 metrics 聚合

**文件**: `src/app/api/agent-apps/route.ts:63`

**问题**: 使用 `$queryRawUnsafe` 而非 `$queryRaw`（tagged template）。虽然参数来自数据库 ID（UUID）不存在注入风险，但 `$queryRawUnsafe` 不经过 Prisma 的转义处理，应优先使用 `$queryRaw`。

**建议**: 改为 `$queryRaw` tagged template 写法。

---

### 【中】CreateAgentAppModal 每次切换引擎都重新解析整个 ZIP

**文件**: `src/app/dashboard/agent-apps/CreateAgentAppModal.tsx:392-413`

**问题**: `select` 的 `onChange` 是 `async`，每次切换引擎都重新解析整个 ZIP 文件。如果文件较大，会导致 UI 卡顿。

**建议**: 缓存解析结果，只在文件变更时重新解析。

---

## 七、潜在 Bug

### 【中】`filesJson` 解析无 try-catch

**文件**: `src/app/api/agent-apps/route.ts:180`、`src/app/api/agent-apps/[id]/route.ts:159`

**问题**: `JSON.parse(filesJson)` 没有 try-catch 保护。如果前端传入格式错误的 JSON，会抛出异常导致 500 错误。

**建议修复**:
```ts
let filesInfo;
try {
  filesInfo = JSON.parse(filesJson);
} catch {
  return NextResponse.json({ error: 'filesJson 格式错误' }, { status: 400 });
}
```

---

### 【中】PipelineViewModal 调用了不同的 API 端点

**文件**: `src/components/agent-apps/PipelineViewModal.tsx:37`

**问题**: 弹窗调用 `/api/agentflow-pipelines?agentAppId=${appId}`，但存在专用端点 `/api/agent-apps/[id]/pipeline`（解析 pipeline.py）。前者查数据库，后者从 Gitea 解析文件。两者数据来源不同，可能在某些场景下结果不一致。

**建议**: 确认两个端点的预期行为，统一使用其中一个。

---

### 【低】`handleFileSelect` 在 folder 模式下 `webkitRelativePath` 兼容性

**文件**: `src/app/dashboard/agent-apps/CreateAgentAppModal.tsx:318`

**问题**: `webkitRelativePath` 是非标准 API，Firefox 和 Safari 支持但行为可能不同。代码没有对不支持此 API 的浏览器做降级处理。

---

## 汇总

| 严重级别 | 数量 | 关键问题 |
|---------|------|---------|
| **高** | 4 | branches 认证遗漏、PUT 缺少 isPublic 校验、pipeline 死代码+错误泄露、列表无分页 |
| **中** | 12 | 认证函数不统一、Gitea 错误泄露、空文件创建、文件大小无限制、并行请求过多等 |
| **低** | 5 | console.log 未替换、name 校验缺失、setTimeout 伪加载等 |

## 建议修复优先级

1. **P0（立即修复）**: branches 接口认证升级、PUT isPublic 权限校验、pipeline 错误信息泄露+死代码清理
2. **P1（本迭代）**: 文件大小限制、AppDetailModal 校验补齐、列表分页、filesJson 解析保护、Gitea 错误脱敏
3. **P2（下迭代）**: 认证函数统一、isAdmin Hook 抽取、Harness 校验共享、ZIP 解析缓存、branches 懒加载
