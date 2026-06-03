# 知识图谱模块代码审查报告

> 审查日期：2026-06-03
> 审查范围：知识图谱模块（API + 前端组件），不含 Python 分析引擎
> 审查状态：待评审

## 审查文件清单

### API 端点
| 文件 | 说明 |
|------|------|
| `src/app/api/knowledge-graph/route.ts` | 产品列表 (GET) |
| `src/app/api/knowledge-graph/[product]/route.ts` | 知识图谱查询 (GET: tree/graph/node/paths) |
| `src/app/api/knowledge-graph/[product]/sync/route.ts` | 上传 DB 到 MinIO (POST) |
| `src/app/api/knowledge-graph/[product]/decompile/route.ts` | AI 反编译 (POST) |
| `src/app/api/codeswarm/codedmap/cache/route.ts` | 缓存管理 (GET/DELETE) |
| `src/app/api/skills/vulnerability-tree/route.ts` | 漏洞模式树 (GET) |

### 前端组件
| 文件 | 说明 |
|------|------|
| `src/components/skills/VulnerabilityTreeSelector.tsx` | 漏洞模式树选择器 |
| `src/components/codeswarm/CodedmapDebugPanel.tsx` | Codedmap 构建调试面板 |

---

## 一、权限控制

### 【高】codedmap/cache 接口完全没有认证

**文件**: `src/app/api/codeswarm/codedmap/cache/route.ts`

**问题**: GET 和 DELETE 两个端点都没有任何认证。任何人都可以列出和删除 MinIO 中的知识图谱缓存文件。DELETE 端点尤其危险，未认证用户可以删除任意产品的缓存数据。

**当前代码**:
```ts
export async function GET() {  // 无认证
  try {
    await ensureBucket();
    // ...
  }
}

export async function DELETE(request: NextRequest) {  // 无认证
  const targetProduct = request.nextUrl.searchParams.get('targetProduct');
  // 直接删除
}
```

**建议修复**: 添加 `authenticateRequestEnhanced` 认证，DELETE 操作应限制为管理员。

---

### 【高】sync 接口无租户隔离，任意用户可上传任意产品

**文件**: `src/app/api/knowledge-graph/[product]/sync/route.ts:21-41`

**问题**: 虽然有认证，但没有检查用户是否有权限操作该 product。任何已认证用户都可以将本地缓存文件上传到 MinIO 任意 product 路径下，可能覆盖他人的知识图谱数据。

**建议修复**: 检查用户与 product 的关联关系，或限制为管理员操作。

---

### 【中】vulnerability-tree 接口使用 `authenticateRequest`，缺少租户上下文

**文件**: `src/app/api/skills/vulnerability-tree/route.ts:7`

**问题**: 使用旧版 `authenticateRequest` 而非 `authenticateRequestEnhanced`，没有租户上下文。虽然漏洞模式树是公共只读数据，影响不大，但与项目整体认证升级方向不一致。

---

## 二、API 异常处理

### 【高】多个接口直接暴露 `error.message` 给客户端

**文件**:
- `src/app/api/knowledge-graph/route.ts:39` — `{ error: error.message }`
- `src/app/api/knowledge-graph/[product]/route.ts:310` — `{ error: error.message }`

**问题**: 错误信息可能包含 MinIO 连接地址、数据库路径、文件系统路径等敏感内部信息。

**当前代码**:
```ts
// route.ts:39
return NextResponse.json({ error: error.message }, { status: 500 });

// [product]/route.ts:310
return NextResponse.json({ error: error.message }, { status: 500 });
```

**建议修复**:
```ts
logger.error(LOG_MODULES.CODE, 'Knowledge graph error', { details: { error: error instanceof Error ? error.message : String(error) } });
return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
```

---

### 【中】MinIO 客户端创建方式不一致

**文件**:
- `src/app/api/knowledge-graph/route.ts:8-15` — 每次请求创建新实例
- `src/app/api/knowledge-graph/[product]/route.ts:13-19` — 每次请求创建新实例
- `src/app/api/codeswarm/codedmap/cache/route.ts:14-25` — 单例模式

**问题**: 同一模块中三种 MinIO 客户端管理方式。前两个文件每次请求都 `new Minio.Client()`，cache 文件使用单例。前者浪费资源，后者正确但风格不统一。

**建议**: 统一为单例模式，抽取到 `src/lib/minio-client.ts`。

---

### 【中】decompile 接口 DB 连接未用 try-finally 保护

**文件**: `src/app/api/knowledge-graph/[product]/decompile/route.ts:33-35`

**问题**: `db.prepare().get()` 如果抛异常，`db.close()` 不会被执行，导致 SQLite 文件句柄泄漏。

**当前代码**:
```ts
const db = new Database(dbPath, { readonly: true });
const row = db.prepare('...').get(nodeId) as ...;
db.close();
// 后续 LLM 调用...
```

**建议修复**:
```ts
const db = new Database(dbPath, { readonly: true });
try {
  const row = db.prepare('...').get(nodeId) as ...;
  if (!row) { db.close(); return NextResponse.json(...); }
  // ...
} finally {
  db.close();
}
```

---

## 三、业务逻辑正确性

### 【高】SQLite DB 连接泄漏 — `getDb()` 打开后从未关闭

**文件**: `src/app/api/knowledge-graph/[product]/route.ts:23-37, 274-311`

**问题**: `getDb()` 函数打开 SQLite 数据库返回，但 GET handler 中的 `buildTree(db)`、`buildCallGraph(db, ...)`、`buildPaths(db)` 调用后从未调用 `db.close()`。每次请求都会泄漏一个文件句柄。

**当前代码**:
```ts
async function getDb(product: string): Promise<Database.Database> {
  // ...
  return new Database(dbPath, { readonly: true });  // 从不关闭
}

export async function GET(...) {
  const db = await getDb(decodeURIComponent(product));
  if (view === 'tree') {
    return NextResponse.json(buildTree(db));  // db 未关闭
  }
  // ...
}
```

**建议修复**: 每个分支在返回前调用 `db.close()`，或使用 try-finally。

---

### 【高】`buildPaths` 函数内存消耗无上限

**文件**: `src/app/api/knowledge-graph/[product]/route.ts:207-272`

**问题**: 对每个 SOURCE 节点做 BFS 搜索到 SINK 的路径，路径长度限制为 8，但返回的 `paths` 数组没有大小限制。大型项目中如果有 100 个 SOURCE，每个 SOURCE 有 10 条路径到 SINK，就会返回 1000 条路径，每条包含完整的中间节点信息。

**建议修复**: 添加 `paths` 数组的上限，或在查询参数中支持分页/限制。

```ts
const MAX_PATHS = 200;
// 在 while 循环中:
if (paths.length >= MAX_PATHS) break;
```

---

### 【中】MinIO 对象键使用未清洗的 `product` 参数，存在注入风险

**文件**: `src/app/api/knowledge-graph/[product]/route.ts:30`

**问题**: `safeName` 只用于本地文件路径（第 26 行），但 MinIO 对象键使用未清洗的 `product`（第 30 行）：

```ts
const safeName = product.replace(/[^a-zA-Z0-9]/g, '_');  // 仅用于本地路径
// ...
await client.fGetObject(KG_BUCKET, `dbs/${product}/graph.db`, dbPath);  // product 未清洗
```

攻击者可以通过构造 `product` 参数（如 `../../other-product`）访问其他产品的数据。

**建议修复**: MinIO 对象键也使用 `safeName`，或统一清洗逻辑。

---

### 【中】sync 接口本地文件存在时才上传，但错误处理不完整

**文件**: `src/app/api/knowledge-graph/[product]/sync/route.ts:33-41`

**问题**: `fs.existsSync(dbPath)` 检查后直接 `fPutObject`，但 `fPutObject` 可能失败（网络错误、bucket 不存在等），没有 try-catch。

**建议**: 添加 try-catch，确保 MinIO 上传失败时返回友好错误。

---

### 【低】decompile 接口 `userId` 提取方式过度防御

**文件**: `src/app/api/knowledge-graph/[product]/decompile/route.ts:22`

**问题**: `const userId = 'userId' in auth ? auth.userId : auth.payload.userId` 是多余的。`authenticateRequestEnhanced` 的返回类型中 `userId` 不在顶层，始终通过 `auth.payload.userId` 访问。

**建议**: 简化为 `const userId = auth.payload.userId;`

---

## 四、React 最佳实践

### 【中】VulnerabilityTreeSelector 错误状态未反馈给用户

**文件**: `src/components/skills/VulnerabilityTreeSelector.tsx:132`

**问题**: fetch 失败时只有 `console.error`，组件继续显示空的下拉列表，用户不知道发生了错误。

```ts
} catch (e) {
  console.error('获取漏洞模式树失败:', e);
  // 无 error state
}
```

**建议**: 添加 `error` state，在 UI 中显示重试提示。

---

### 【低】CodedmapDebugPanel 使用 `typeof window !== 'undefined'` 内联判断

**文件**: `src/components/codeswarm/CodedmapDebugPanel.tsx:306`

**问题**: 组件已标记 `'use client'`，`typeof window !== 'undefined'` 检查在客户端渲染时总是 true，在 SSR 时不需要（因为客户端组件不会在服务端执行这段渲染逻辑）。不影响功能但属于冗余代码。

---

## 五、表单校验

### 【中】`product` URL 参数缺少长度和格式校验

**文件**: `src/app/api/knowledge-graph/[product]/route.ts:281`、`src/app/api/knowledge-graph/[product]/sync/route.ts:28` 等

**问题**: `product` 来自 URL 路径参数，经 `decodeURIComponent` 后直接使用。没有长度限制或格式校验。超长的 product 名称可能导致 MinIO 对象键过长或本地文件路径溢出。

**建议**: 添加长度限制和字符白名单校验。

---

### 【中】CodedmapDebugPanel 缺少服务端路径注入防护

**文件**: `src/components/codeswarm/CodedmapDebugPanel.tsx:127`

**问题**: `targetDir`、`workspace`、`codedmapHome` 等路径参数直接传给后端 API，如果后端直接用于文件系统操作，可能存在路径遍历风险（前端校验不够，需后端同步校验）。

**建议**: 后端 build API 必须对路径参数做白名单校验。

---

### 【低】VulnerabilityTreeSelector 允许选择非 pattern 类型节点

**文件**: `src/components/skills/VulnerabilityTreeSelector.tsx:201-207`

**问题**: 点击树节点时，`isPattern || !node.hasChildren` 条件允许选择 category 类型节点。但 Skill 创建时 API 要求 `vulnerabilityTreeId` 必须是 `pattern` 类型的叶子节点，选择 category 会导致后端 400 错误。

---

## 六、性能问题

### 【高】`buildTree` 和 `buildCallGraph` 将全量数据加载到内存

**文件**: `src/app/api/knowledge-graph/[product]/route.ts:71-205`

**问题**:
- `buildTree`（第 72-76 行）：加载所有 METHOD 节点的 properties，在内存中构建包-类-方法三级树
- `buildCallGraph`（第 113-120 行）：加载**所有** METHOD-to-METHOD CALL 边到内存，然后 BFS 遍历
- 对于大型项目（10万+ 方法、百万+ 边），这会导致严重的内存和延迟问题

**建议**:
1. `buildTree`：使用 SQL GROUP BY 在数据库层聚合，减少内存数据量
2. `buildCallGraph`：只查询目标节点 ± depth 范围内的边，而非全量加载

---

### 【高】`buildPaths` 全量加载所有 SOURCE/SINK 和所有 CALL 边

**文件**: `src/app/api/knowledge-graph/[product]/route.ts:207-272`

**问题**: 第 208-215 行加载所有 CALL 边，第 223-228 行加载所有 SOURCE 和 SINK 节点。对每个 SOURCE 做 BFS。大型项目中这是 O(|sources| × |edges|) 的时间复杂度。

**建议**: 添加查询参数限制（如指定 source/sink ID），或预计算路径存储到数据库。

---

### 【中】VulnerabilityTreeSelector 的 `getChildItems` 每次渲染做 O(n) 过滤

**文件**: `src/components/skills/VulnerabilityTreeSelector.tsx:186-188`

**问题**: `items.filter(item => item.parentId === parentId)` 在每个树节点渲染时调用。对于 N 个节点、展开 M 个节点，总复杂度为 O(N×M)。虽然 N 通常不大（<200），但可以用 `Map` 预构建索引优化。

**建议**: 在数据加载时构建 `childrenMap: Map<string, TreeItem[]>` 索引。

---

### 【低】知识图谱 DB 缓存策略过于简单

**文件**: `src/app/api/knowledge-graph/[product]/route.ts:23-37`

**问题**: `getDb` 函数从 MinIO 下载后缓存在 `os.tmpdir()`，没有过期机制。如果 MinIO 中的 DB 更新了，本地缓存不会失效。服务器重启后缓存丢失（tmpdir 可能被清理）。

**建议**: 添加 ETag 或最后修改时间校验，支持缓存失效。

---

## 七、潜在 Bug

### 【高】SQLite 文件可能被并发读写损坏

**文件**: `src/app/api/knowledge-graph/[product]/route.ts:36`、`src/app/api/knowledge-graph/[product]/sync/route.ts:38`

**问题**: GET 请求以 `readonly: true` 打开本地 DB，POST sync 接口上传 DB 文件。如果 GET 请求正在读取 DB 文件时，另一个请求的 sync 操作覆盖了同一个文件，可能导致读取失败或数据损坏。

**建议**: 使用文件锁或原子替换（先下载到临时文件再 rename）。

---

### 【中】`buildCallGraph` 中 `slice(0, 15)` 限制可能导致关键边丢失

**文件**: `src/app/api/knowledge-graph/[product]/route.ts:139, 151`

**问题**: BFS 遍历时 `fwd.get(curr).slice(0, 15)` 只取前 15 个 callee/caller。对于调用链密集的节点（如工具类），可能丢失关键的污点传播路径。且 `Map` 中数组的顺序取决于 SQL 查询的返回顺序，不确定。

**建议**: 如果必须截断，优先保留被标记为 SOURCE/SINK/ENTRY_POINT 的边。

---

### 【中】GET /knowledge-graph 产品列表中 MinIO stream 错误未完整处理

**文件**: `src/app/api/knowledge-graph/route.ts:25-35`

**问题**: `listObjects` 的 stream 使用 `on('error', reject)` 处理，但如果在 `data` 事件之后发生错误（如分页加载中途连接断开），Promise 可能已经部分完成了。

**建议**: 使用 `listObjectsV2` 并正确处理分页。

---

### 【低】VulnerabilityTreeSelector 使用 `createPortal` 但未处理 unmount 清理

**文件**: `src/components/skills/VulnerabilityTreeSelector.tsx:373`

**问题**: `createPortal(dropdownContent, document.body)` 创建的 DOM 节点在组件 unmount 时由 React 自动清理，但 scroll/resize 事件监听器的清理依赖 `isOpen` 状态。如果组件在 dropdown 打开时被卸载，事件监听器可能泄漏。

---

## 汇总

| 严重级别 | 数量 | 关键问题 |
|---------|------|---------|
| **高** | 7 | cache 接口无认证、sync 无隔离、DB 连接泄漏、`buildPaths` 内存无限、全量数据加载、错误信息泄露、SQLite 并发风险 |
| **中** | 11 | MinIO 客户端不一致、对象键注入、路径校验缺失、树组件性能等 |
| **低** | 5 | userId 过度防御、window 检查冗余、缓存无过期等 |

## 建议修复优先级

1. **P0（立即修复）**: cache 接口添加认证、DB 连接泄漏修复（try-finally）、错误信息脱敏、`buildPaths` 添加上限
2. **P1（本迭代）**: sync 接口权限控制、MinIO 对象键清洗、MinIO 客户端单例统一、buildTree/buildCallGraph 性能优化
3. **P2（下迭代）**: vulnerability-tree 认证升级、缓存失效策略、VulnerabilityTreeSelector 索引优化、路径参数白名单校验
