# Skill 市场模块代码审查报告

> 审查日期：2026-06-03
> 审查范围：Skill 市场模块全链路（API + 前端页面）
> 审查状态：待评审

## 汇总

| 严重级别 | 数量 | 关键问题 |
|---------|------|---------|
| **高** | 4 | import 接口认证/租户缺失、ZIP 路径遍历、DELETE 错误信息泄露、相似度检测全量加载 |
| **中** | 11 | batch TOCTOU、productTagIds 版本不一致、文件大小未限制、name 格式未校验、串行 LLM 分析、并发版本冲突等 |
| **低** | 6 | parseSkillMarkdown 重复、console.error 未替换、VULNERABILITY_CATEGORY_ID 空字符串等 |

## 建议修复优先级

1. **P0（立即修复）**: 4 个高风险问题 — import 认证、ZIP 路径遍历、错误信息泄露、相似度检测性能
2. **P1（本迭代）**: 并发版本冲突、文件大小限制、name 格式校验、productTagIds 继承
3. **P2（下迭代）**: 详情页拆分 Hook、parseSkillMarkdown 去重、scope 语义梳理

## 审查文件清单

### API 端点
| 文件 | 说明 |
|------|------|
| `src/app/api/skills/route.ts` | Skill 列表查询 (GET) + 创建 (POST) |
| `src/app/api/skills/[id]/route.ts` | Skill 详情/更新/删除 (GET/PUT/DELETE) |
| `src/app/api/skills/upload/route.ts` | Skill 文件上传 (POST) |
| `src/app/api/skills/import/route.ts` | Skill JSON 导入 (POST) |
| `src/app/api/skills/export/route.ts` | Skill JSON 导出 (GET) |
| `src/app/api/skills/batch/route.ts` | Skill 批量操作 (POST) |

### 前端页面
| 文件 | 说明 |
|------|------|
| `src/app/dashboard/skills/page.tsx` | Skill 列表管理页 |
| `src/app/dashboard/skills/[id]/page.tsx` | Skill 详情/编辑页 |
| `src/app/dashboard/skills/governance/page.tsx` | 治理中心 |
| `src/app/dashboard/skills/governance/review/page.tsx` | 重复组审核页 |
| `src/app/dashboard/skills/import-create/page.tsx` | 导入创建向导页 |

---

## 一、权限控制

### 【高】import 接口使用 `authenticateRequest` 而非 `authenticateRequestEnhanced`

**文件**: `src/app/api/skills/import/route.ts:39`

**问题**: import 接口使用 `authenticateRequest` 而不是 `authenticateRequestEnhanced`，缺少租户上下文解析。导入的 Skill 直接以 `userId: null` 创建，没有设置 `tenantId`，导致导入数据游离在租户体系之外。

**当前代码**:
```ts
const auth = authenticateRequest(request);
```

**建议修复**:
```ts
const auth = authenticateRequestEnhanced(request);
if (!auth.success) {
  return authErrorResponse(auth);
}
const { payload, tenant } = auth as AuthSuccessResult;
// 创建时补充 tenantId
```

---

### 【高】import 接口导入时无 tenantId，破坏多租户隔离

**文件**: `src/app/api/skills/import/route.ts:91-113`

**问题**: `prisma.skill.create` 中没有设置 `tenantId`，所有导入的 Skill 的 `tenantId` 为 `null`。结合上面的认证问题，这意味着非 Platform Admin 的普通管理员（`isAdmin` 只检查角色权限）可以导入 Skill 并使其成为无租户关联的"野数据"。

**建议修复**: 从 `tenant` 上下文获取 `tenantId`，导入时设置正确的 `tenantId`。

---

### 【中】batch 接口 `updateMany` 没有复用前面的权限过滤

**文件**: `src/app/api/skills/batch/route.ts:76-99`

**问题**: 权限校验阶段用 `findMany` + `OR` 条件过滤了可操作的 Skill，但实际 `updateMany` 时只用了 `id: { in: skillIds }`，没有加上权限过滤条件。虽然在正常流程下前面已校验了所有 Skill 的归属，但在并发场景下，Skill 可能在 `findMany` 之后、`updateMany` 之前被转让，存在 TOCTOU 风险。

**建议修复**: `updateMany` 的 where 条件加上权限过滤（或使用事务包裹 `findMany` + `updateMany`）。

---

### 【低】GET /api/skills/[id] 权限判断逻辑复杂且不一致

**文件**: `src/app/api/skills/[id]/route.ts:59-71`

**问题**: GET 用 `hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE)` 判断是否为管理员，PUT 用 `CONFIG_UPDATE`、DELETE 用 `CONFIG_DELETE`，三个接口的管理员判断权限不一致。对于只读的 GET 接口，用 `CONFIG_DELETE` 判断管理员语义不对。

**建议**: 统一使用 `tenant.isPlatformAdmin || tenant.isIcsTenant` 或定义一个统一的 `isSkillAdmin` 函数。

---

## 二、API 异常处理

### 【高】DELETE [id] 错误信息泄露内部堆栈

**文件**: `src/app/api/skills/[id]/route.ts:276`

**问题**: 事务失败时直接返回 `txError.message` 给客户端，可能泄露数据库内部信息。

**当前代码**:
```ts
return NextResponse.json(
  { error: '删除失败: ' + (txError instanceof Error ? txError.message : String(txError)) },
  { status: 500 }
);
```

**建议修复**:
```ts
logger.errorNoUser(LOG_MODULES.SKILL, '删除事务失败', { details: { error: ... } });
return NextResponse.json({ error: '删除失败，请稍后重试' }, { status: 500 });
```

---

### 【中】upload 接口 LLM 分析结果可能重复添加

**文件**: `src/app/api/skills/upload/route.ts:362-380`

**问题**: `quickDuplicateCheck` 中 `confidence >= 0.5` 触发 LLM 分析，而 `confidence < 0.85` 的低置信度也会被加入 `governanceWarning.duplicates`。0.5~0.85 之间的结果可能被重复添加（先被 LLM 分析加一次，又被低置信度列表加一次）。

**建议修复**: 低置信度过滤应排除已分析的高置信度结果，避免重复。

---

### 【中】batch enable/disable 操作无事务保护

**文件**: `src/app/api/skills/batch/route.ts:76-99`

**问题**: `delete` 操作使用了事务，但 `enable`/`disable` 的 `updateMany` 没有事务保护。如果批量操作中部分失败，会导致数据不一致。

---

### 【低】前端批量操作的错误信息提取不一致

**文件**: `src/app/dashboard/skills/page.tsx:380`

**问题**: batch 接口的错误格式是 `{ details: { error: '...' } }`，但前端提取用 `data.error`，与 batch 接口返回格式不匹配。

**当前代码**:
```ts
throw new Error(data.error || '操作失败');
```

**建议修复**:
```ts
throw new Error(data.details?.error || data.error || '操作失败');
```

---

## 三、业务逻辑正确性

### 【高】upload 接口中 ZIP 路径遍历风险

**文件**: `src/app/api/skills/upload/route.ts:162-196`

**问题**: 虽然过滤了 `__MACOSX` 和 `.DS_Store`，但没有检查 ZIP 条目名是否包含 `../` 路径遍历。恶意 ZIP 文件可能包含 `../../etc/passwd` 这样的路径，写入到磁盘/Git 时造成路径遍历攻击。

**建议修复**:
```ts
for (const entry of zipEntries) {
  if (!entry.isDirectory) {
    const entryPath = entry.entryName;
    // 检查路径遍历
    if (entryPath.includes('..') || entryPath.startsWith('/') || entryPath.startsWith('\\')) {
      continue;
    }
    // ... 其余逻辑
  }
}
```

---

### 【中】PUT [id] 版本更新时 productTagIds 未继承到新版本

**文件**: `src/app/api/skills/[id]/route.ts:185-196`

**问题**: 当 `content` 变更时创建新版本，`updatedSkill` 指向新记录（新 ID）。但 `productTagIds` 的 `deleteMany` 用的是原始 `id`，`createMany` 用的是 `updatedSkill!.id`。旧记录的 tags 没有被继承到新版本，新版本在列表中不会显示产品标签关联。

**建议**: 版本更新时在 `create` 数据中带上 `SkillProductTag`，或在创建新版本后复制旧版本的 tags。

---

### 【中】scope=mine 与 scope=all 查询条件结果相同

**文件**: `src/app/api/skills/route.ts:77-99`

**问题**: `scope=mine` 的 `OR` 条件为 `[自己创建, 系统内置, 同租户]`，`scope=all` 为 `[系统内置, 自己创建, 同租户]`。OR 是集合运算，顺序不影响结果，两者查询结果完全相同。

**建议**: 如果 `mine` 和 `all` 应该有区别，修正查询逻辑。如果确实相同，合并为一个 scope。

---

### 【低】`parseSkillMarkdown` 在三处重复定义

**文件**:
- `src/app/api/skills/upload/route.ts:22-83`
- `src/app/dashboard/skills/[id]/page.tsx:58-119`
- `src/app/dashboard/skills/import-create/page.tsx:64-125`

**问题**: 完全相同的 `parseSkillMarkdown` 函数在前端两个页面和后端 API 各复制了一份。修改其中一处不会同步到其他地方。

**建议**: 抽取到 `src/lib/skill-parser.ts` 共享（前端页面注意不要引入 Node.js 依赖）。

---

## 四、React 最佳实践

### 【中】详情页状态过多，未拆分为自定义 Hook

**文件**: `src/app/dashboard/skills/[id]/page.tsx`

**问题**: 该页面约 1857 行，定义了约 40 个 `useState`，涵盖 AI 优化、版本管理、漏洞列表、编辑等多个关注点。所有逻辑耦合在一个组件中，难以维护和测试。

**建议**: 拆分为多个自定义 Hook：
- `useSkillDetail(skillId)` — 基础数据获取
- `useSkillEditing(skill)` — 编辑状态管理
- `useSkillVersion(skillId)` — 版本管理
- `useSkillVulnerabilities(skillId)` — 漏洞列表

---

### 【中】列表页 useEffect 依赖项可能触发重复请求

**文件**: `src/app/dashboard/skills/page.tsx:184`

**问题**: 多个 filter 状态（`selectedCategoryId`、`selectedLanguageId`、`selectedPatternId`、`selectedActiveStatus`、`currentPage`、`pageSize`、`searchTerm`）同时变更时，React 的 batch 更新可能导致 useEffect 只触发一次，但也可能在某些场景下触发多次请求。

**建议**: 使用 `useCallback` 包裹 `fetchSkills`，或使用 debounce 合并快速连续的参数变更。

---

### 【低】detail 页面多处 `console.error` 未替换为统一 logger

**文件**: `src/app/dashboard/skills/[id]/page.tsx:116` 等多处

**问题**:
```ts
console.error('解析 Skill 文件失败:', e);
```
以及 `page.tsx:252`、`page.tsx:265`、`page.tsx:322` 等处仍使用 `console.error`，未按项目规范使用统一 logger。

---

## 五、表单校验

### 【中】upload 接口缺少文件大小限制

**文件**: `src/app/api/skills/upload/route.ts:103-112`

**问题**: 没有对上传文件大小做校验。恶意用户可以上传超大 ZIP 文件导致服务端内存溢出（`file.arrayBuffer()` 会将整个文件加载到内存）。

**建议修复**:
```ts
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
if (file.size > MAX_FILE_SIZE) {
  return NextResponse.json({ details: { error: '文件大小不能超过 10MB' } }, { status: 400 });
}
```

---

### 【中】POST /api/skills 的 `name` 字段缺少格式校验

**文件**: `src/app/api/skills/route.ts:177-183`

**问题**: `name` 只检查了非空，没有校验格式（如是否包含特殊字符、是否过长）。`name` 被用作文件名和 Git 路径，如果包含 `/`、`..` 或特殊字符，可能导致磁盘/Git 操作异常。

**建议修复**:
```ts
if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
  return NextResponse.json(
    { details: { error: '名称只能包含字母、数字、下划线和连字符' } },
    { status: 400 }
  );
}
```

---

### 【低】前端导入 JSON 时缺少格式预检

**文件**: `src/app/dashboard/skills/page.tsx:426-431`

**问题**: `JSON.parse(text)` 没有 try-catch 保护，用户选择非 JSON 文件会直接抛异常。

**建议**: 包裹 try-catch 并给出友好提示。

---

## 六、性能问题

### 【高】POST /api/skills 相似度检测加载全量 Skill content

**文件**: `src/app/api/skills/route.ts:297-311`

**问题**: 创建 Skill 时，`findSimilarSkills` 加载了同作用域内所有 Skill 的 `content` 字段。如果 Skill 数量多（每个 content 可能有数 KB），会导致大量内存占用和数据库传输压力。

**当前代码**:
```ts
const existingSkills = await prisma.skill.findMany({
  where: { userId, isLatest: true, id: { not: skill.id } },
  select: { id: true, name: true, displayName: true, description: true, cwe: true, content: true },
});
```

**建议**:
1. 先基于 `name`、`cwe`、`description` 做快速预筛
2. 只对候选集加载 `content`
3. 长期方案：使用向量数据库存储 embedding

---

### 【中】upload 接口串行执行 LLM 分析

**文件**: `src/app/api/skills/upload/route.ts:324-369`

**问题**: 对高置信度的重复 Skill，逐个串行调用 `analyzeSkillPair`（LLM 分析），每个调用耗时可能数秒。如果有 3 个候选项，用户需要等待 10+ 秒。

**建议**: 使用 `Promise.allSettled` 并行分析，或限制为最多 1 个深度分析。

---

### 【中】GET /api/skills 搜索时对 content 做模糊匹配

**文件**: `src/app/api/skills/route.ts:103-108`

**问题**: 搜索条件包含 `{ content: { contains: search } }`，`content` 是大文本字段，模糊匹配性能较差。

**建议**: 列表搜索先搜 `name`/`displayName`/`description`，`content` 搜索作为 fallback 或仅详情搜索使用。

---

### 【低】治理中心 review 页面使用 `alert` 显示结果

**文件**: `src/app/dashboard/skills/governance/review/page.tsx:89`

**问题**: `alert` 会阻塞 UI 线程，应统一使用 `toast`。

---

## 七、潜在 Bug

### 【高】批量删除后 `result.count` 为硬编码值

**文件**: `src/app/api/skills/batch/route.ts:144`

**问题**: 删除操作在事务内执行了三层删除，但 `result` 赋值为 `{ count: skillIds.length }`。这是硬编码值，不代表实际删除数量。如果某些 ID 的关联数据缺失，实际删除数可能少于预期，但前端显示"成功"。

**建议**: 使用事务返回的实际删除计数，或通过 `deleteMany` 的返回值获取。

---

### 【中】detail 页面权限判断基于 JWT 解码，与后端可能不一致

**文件**: `src/app/dashboard/skills/[id]/page.tsx:318-327`

**问题**: 前端通过 JWT 解码获取权限判断 `isAdmin`，但 JWT 中的 permissions 是签发时的快照。如果管理员在后台修改了用户权限，用户在 token 过期前仍持有旧权限。前端显示编辑按钮但 API 返回 403。

**建议**: 前端 `isAdmin` 仅用于 UI 展示控制，关键操作需依赖后端 403 响应（当前已做到）。可优化为 403 时自动隐藏编辑按钮。

---

### 【中】PUT [id] 并发编辑时版本号冲突

**文件**: `src/app/api/skills/[id]/route.ts:119-151`

**问题**: 先 `findUnique` 获取当前版本号，再 `update isLatest: false`，最后 `create` 新版本。两个并发请求可能读到相同的 `version`，导致创建两个相同版本号的新 Skill。

**建议**: 使用数据库事务 + 在事务内再次查询版本号，或用唯一约束 `(name, userId, version)` 防止重复。

---

### 【低】前端导入创建页 `VULNERABILITY_CATEGORY_ID` 为空字符串

**文件**: `src/app/dashboard/skills/import-create/page.tsx:28`

**问题**:
```ts
const VULNERABILITY_CATEGORY_ID = '';
```
空字符串不是有效的分类 ID。如果用户忘记选择分类，提交时传空字符串到后端，报错信息不友好。

**建议**: 设为 `null`，并在 UI 上提供更明确的分类选择提示。

---

