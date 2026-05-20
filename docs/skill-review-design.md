# Skill 管理员审核机制设计方案

## 背景

当前 Skill 上传后直接激活（`isActive: true`），没有任何审核门控。本方案增加管理员审核机制：Skill 创建后进入待审核状态，管理员审批通过后才能正式启用。

---

## 实现范围

两条 Skill 创建路径，统一走审核流程：

| 路径 | 触发方式 | 审核策略 |
|------|---------|---------|
| 手动上传（Skills 管理页） | `POST /api/skills` HTTP 接口 | 非管理员 → `pending`；管理员 → 自动 `approved` |
| AgentHarness 自动同步 | `skill-harness-sync.ts` 直接 Prisma 写入 | 同上，按上传者角色判断 |

- 管理员可在治理中心审批/拒绝所有待审核 Skill
- Skill 列表页展示审核状态徽章

---

## 实施步骤

### Step 1 — Schema 变更

**文件**: `prisma/schema.prisma`

在 `Skill` 模型中添加 4 个字段（紧跟 `isActive` 之后）：

```prisma
reviewStatus  String    @default("pending")  // pending | approved | rejected
reviewedBy    String?
reviewedAt    DateTime?
reviewNotes   String?
```

执行：`npm run db:push`

---

### Step 2 — POST /api/skills 创建逻辑

**文件**: `src/app/api/skills/route.ts`

在 `prisma.skill.create` 的 data 中，根据用户角色设置初始状态：

```ts
const isAdmin = payload.roles?.includes('admin');
isActive: isAdmin ? true : false,
reviewStatus: isAdmin ? 'approved' : 'pending',
```

---

### Step 3 — AgentHarness 同步逻辑

**文件**: `src/lib/skill-harness-sync.ts`（第 100 行 `prisma.skill.create`）

同步时需要判断上传者角色。`syncSkillsFromHarness` 已接收 `userId` 参数，需额外查询该用户角色：

```ts
const uploader = await prisma.user.findUnique({
  where: { id: userId },
  select: { roles: { select: { role: { select: { name: true } } } } },
});
const isAdmin = uploader?.roles?.some(r => r.role.name === 'admin') ?? false;
// 写入时
isActive: isAdmin ? true : false,
reviewStatus: isAdmin ? 'approved' : 'pending',
```

---

### Step 4 — 新增审批 API

**文件**: `src/app/api/admin/skills/[id]/review/route.ts`（新建）

参照 `src/app/api/admin/skills-governance/review/[id]/route.ts` 的模式：

- `PATCH` 方法，需要 `PERMISSIONS.SKILL_APPROVE`（`skill:approve`，已存在）
- 接受 `{ status: 'approved' | 'rejected', notes?: string }`
- `approved`：更新 `isActive: true`、`reviewStatus: 'approved'`、`reviewedBy`、`reviewedAt`、`reviewNotes`
- `rejected`：更新 `isActive: false`、`reviewStatus: 'rejected'`、`reviewedBy`、`reviewedAt`、`reviewNotes`

---

### Step 5 — 治理 API 扩展 pendingItems

**文件**: `src/app/api/admin/skills-governance/route.ts`

在 `pendingItems` 对象中新增一项：

```ts
skillApprovals: prisma.skill.count({ where: { reviewStatus: 'pending' } }),
```

---

### Step 6 — 治理仪表盘展示待审核数

**文件**: `src/app/dashboard/admin/skills-governance/page.tsx`

- 在 `pendingTotal` 计算中加入 `skillApprovals`
- 新增条件横幅（参照 `llmAnalysis` 横幅）：

```tsx
{overview.pendingItems.skillApprovals > 0 && (
  <Link href="/dashboard/admin/skills-governance/skill-approval?status=pending">
    有 {overview.pendingItems.skillApprovals} 个 Skill 等待管理员审核
  </Link>
)}
```

---

### Step 7 — 新增 Skill 审批列表页

**文件**: `src/app/dashboard/admin/skills-governance/skill-approval/page.tsx`（新建）

参照 `analysis-review/page.tsx` 的模式：

- 状态 Tab：`pending` / `approved` / `rejected`
- 列表展示：Skill 名称、创建者、创建时间、来源（手动/AgentHarness）、reviewStatus 徽章
- 每行有"审批通过"和"拒绝"按钮，点击弹出确认对话框（含备注输入）
- 调用 `PATCH /api/admin/skills/[id]/review`
- 无需独立详情页（直接在列表行内操作）

---

### Step 8 — Skill 列表页展示审核状态

**文件**: `src/app/dashboard/skills/page.tsx`

在每个 Skill 卡片上增加状态徽章：

| reviewStatus | 徽章样式 |
|---|---|
| `pending` | 黄色"待审核" |
| `rejected` | 红色"已拒绝" |
| `approved` 或旧数据（无字段） | 不显示（或绿色"已通过"） |

---

## 关键文件汇总

| 文件 | 操作 |
|------|------|
| `prisma/schema.prisma` | 修改 Skill 模型，添加 4 个字段 |
| `src/app/api/skills/route.ts` | 修改 POST，按角色设置初始状态 |
| `src/lib/skill-harness-sync.ts` | 修改 prisma.skill.create，查角色后设状态 |
| `src/app/api/admin/skills/[id]/review/route.ts` | 新建审批 API |
| `src/app/api/admin/skills-governance/route.ts` | 扩展 pendingItems 加 skillApprovals |
| `src/app/dashboard/admin/skills-governance/page.tsx` | 新增待审核横幅 |
| `src/app/dashboard/admin/skills-governance/skill-approval/page.tsx` | 新建审批列表页 |
| `src/app/dashboard/skills/page.tsx` | 展示审核状态徽章 |

---

## 验证步骤

```
前端操作步骤：
1. 以普通用户登录 → 上传一个新 Skill
   表现：Skill 卡片显示黄色"待审核"徽章，Skill 不可执行

2. 以管理员登录 → 进入 Skills 治理中心
   表现：顶部横幅显示"N 个 Skill 等待管理员审核"

3. 点击横幅 → 进入 skill-approval 页面
   表现：列表显示刚才上传的 Skill，状态"待审核"

4. 点击"审批通过" → 确认
   表现：状态变为"已通过"，普通用户的 Skill 卡片徽章消失

5. 以管理员上传 Skill
   表现：直接显示为"已通过"，无需审核

6. 测试拒绝流程：审批页点击"拒绝"并填写备注
   表现：Skill 状态变为"已拒绝"（红色徽章），isActive=false

7. 上传 AgentHarness（含 skills/ 目录）
   表现：同步的 Skill 按上传者角色判断，普通用户同样进入待审核
```

---

## 参考模式

- 审批 API 模式：`src/app/api/admin/skills-governance/review/[id]/route.ts`
- 审批列表页模式：`src/app/dashboard/admin/skills-governance/analysis-review/page.tsx`
- 权限常量：`PERMISSIONS.SKILL_APPROVE`（`skill:approve`，`src/types/permissions.ts`）
- pendingItems 模式：`src/app/api/admin/skills-governance/route.ts`
