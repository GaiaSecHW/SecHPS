# 硬编码数据修复计划

## ✅ 状态：已完成

构建验证：`npm run build` 成功通过 TypeScript 编译

---

## 修复摘要

### 已删除的硬编码

| 文件 | 硬编码 | 替换方案 |
|------|--------|----------|
| VulnerabilityPatternSelector.tsx | CATEGORY_LABELS (19个) | props.categoryLabels 从 hook 获取 |
| skills/page.tsx | categoryLabels (10个) | useSkillCategories hook |
| high-frequency/page.tsx | categoryLabels (10个) | useSkillCategories hook |
| merge/page.tsx | categoryLabels (10个) | useSkillCategories hook |
| merge-candidates/page.tsx | categoryLabels (10个) | useSkillCategories hook |
| new-impact/page.tsx | categoryLabels (10个) | useSkillCategories hook |
| TechStackSection.tsx | CATEGORY_LABELS/OPTIONS (5个) | 从数据动态提取 |

### 新增的文件

| 文件 | 用途 |
|------|------|
| src/hooks/useSkillCategories.ts | 获取 Skill 分类标签（从 SystemConfig.skill_categories） |

### 修改的 API

| API | 修改内容 |
|-----|----------|
| /api/vulnerability-patterns | categories 返回 `{ value, label }[]` 而非 `string[]` |

### 修改的 Hook

| Hook | 新增返回值 |
|------|-----------|
| useVulnerabilityPatterns | categoryLabels: Record<string, string> |
| useSkillCategories | categoryLabels: Record<string, string> |

---

## 数据流统一原则

**有数据库 → 从数据库获取**
- 漏洞模式分类：SystemConfig.skill_categories
- Skill 分类：SystemConfig.skill_categories（同一个）
- 技术栈分类：TechStackOption.category 动态提取

**无数据库 → 保留硬编码**（按用户确认）
- 语言扩展名映射
- 工具分类/执行器
- 漏洞状态/严重程度
- Skills Governance 状态

---

## 目标

删除有数据库支持的硬编码数据，确保组件从数据库/API 获取数据。

## 修复范围

| 类别 | 数据库源 | 硬编码位置 | 状态 |
|------|----------|-----------|------|
| 漏洞模式分类标签 | SystemConfig.skill_categories | VulnerabilityPatternSelector.tsx | 必须修复 |
| Skill 分类标签 | SystemConfig.skill_categories | 5 个页面文件 | 必须修复 |
| 技术栈分类 | TechStackOption.category | TechStackSection.tsx | 必须修复 |

---

## 任务分解

### Phase 1: 漏洞模式分类标签修复

**问题**: `VulnerabilityPatternSelector.tsx` 第 23-42 行硬编码 `CATEGORY_LABELS`

**数据源**: 
- API: `/api/admin/categories` 或 `/api/vulnerability-patterns` 返回分类
- 数据库: `SystemConfig.skill_categories`

**修复方案**:
1. 删除组件内 `CATEGORY_LABELS` 常量
2. 从 props 或 API 获取分类标签映射
3. 或使用 `useVulnerabilityPatterns` hook 返回的 categories

**涉及文件**:
- `src/components/skills/VulnerabilityPatternSelector.tsx` - 删除硬编码
- `src/hooks/useVulnerabilityPatterns.ts` - 确保 hook 返回分类标签

**验证**: Skill 编辑页面的漏洞模式选择器分类显示正确

---

### Phase 2: Skill 分类标签修复（5 处重复）

**问题**: 同一份 `categoryLabels` 在 5 个页面文件中重复定义

**数据源**: 
- API: `/api/skills/categories` 返回 `{ value, label, count }`
- 数据库: `SystemConfig.skill_categories`

**涉及文件**:
| 文件 | 行号 | 用途 |
|------|------|------|
| src/app/dashboard/skills/page.tsx | 59-70 | Skills 列表分类显示 |
| src/app/dashboard/admin/skills-governance/high-frequency/page.tsx | 65-76 | 高频重叠排行 |
| src/app/dashboard/admin/skills-governance/merge/page.tsx | 111-122 | Skill 合并 |
| src/app/dashboard/admin/skills-governance/merge-candidates/page.tsx | 94-105 | 合并候选 |
| src/app/dashboard/admin/skills-governance/new-impact/page.tsx | 94-104 | 新影响分析 |

**修复方案**:

方案 A（推荐）: 组件直接从已有 API 获取
- Skills 页面已调用 `/api/skills/categories` 获取分类（第 219-235 行）
- 将获取的 categories 转换为 `{ value: label }` 映射格式
- 删除硬编码 `categoryLabels`

方案 B: 创建共享 hook
- 创建 `useSkillCategories()` hook
- 内部调用 `/api/skills/categories`
- 返回 `{ value: label }` 映射和原始数组

**具体修改**:
1. 每个页面添加获取分类的逻辑（或使用共享 hook）
2. 将 `categoryLabels[skill.category]` 改为动态获取
3. 删除硬编码的 `categoryLabels` 常量

**验证**: 5 个页面的分类筛选和显示都正确

---

### Phase 3: 技术栈分类修复

**问题**: `TechStackSection.tsx` 硬编码 `CATEGORY_LABELS` 和 `CATEGORY_OPTIONS`

**数据源**: 
- API: `/api/techstack-options` 返回技术栈列表
- 数据库: `TechStackOption` 表的 `category` 字段

**涉及文件**:
- `src/app/dashboard/config/TechStackSection.tsx` 第 29-43 行

**修复方案**:
1. 从现有数据中动态提取分类（TechStackOption 已有 category 字段）
2. 删除 `CATEGORY_LABELS` 和 `CATEGORY_OPTIONS` 硬编码
3. 使用 `useTechStackOptions` hook 返回的数据提取唯一分类

**注意**: TechStackOption.category 目前只有 'language' 分类（从 seed 看）
- 如果需要更多分类，需要更新 seed 数据
- 或者保持当前状态，分类从实际数据提取

**验证**: 技术栈配置页面分类筛选正常

---

## 执行顺序

```
Phase 1: 漏洞模式分类
  ├── Task 1.1: 检查 useVulnerabilityPatterns hook 是否返回分类标签
  ├── Task 1.2: 修改 VulnerabilityPatternSelector 删除硬编码，使用 props 或 hook
  └ Task 1.3: 验证 Skill 编辑页面

Phase 2: Skill 分类标签（5 处）
  ├── Task 2.1: 创建 useSkillCategories hook 或确定每个页面如何获取
  ├── Task 2.2: 修改 skills/page.tsx
  ├── Task 2.3: 修改 high-frequency/page.tsx
  ├── Task 2.4: 修改 merge/page.tsx
  ├── Task 2.5: 修改 merge-candidates/page.tsx
  ├── Task 2.6: 修改 new-impact/page.tsx
  └ Task 2.7: 验证所有 5 个页面

Phase 3: 技术栈分类
  ├── Task 3.1: 检查 useTechStackOptions hook 返回数据结构
  ├── Task 3.2: 修改 TechStackSection.tsx
  └ Task 3.3: 验证技术栈配置页面
```

---

## 风险评估

### 低风险
- Skill 分类: API 已存在，只需替换硬编码使用方式
- 技术栈分类: 数据库有 category 字段，只需动态提取

### 中风险
- 漏洞模式分类: 需确认 hook 或 API 返回的数据结构是否包含标签映射

### 需验证的点
1. `SystemConfig.skill_categories` 的 value 格式是否为 `[{ value, label }]`
2. 各 API 返回的分类数据结构
3. 数据库中是否有实际的分类数据（需执行 seed）

---

## 验证清单

- [ ] VulnerabilityPatternSelector 分类下拉显示正确中文标签
- [ ] Skills 页面分类筛选器显示正确选项
- [ ] Skills 列表中分类列显示正确中文标签
- [ ] Skills Governance 4 个页面分类显示正确
- [ ] 技术栈配置页面分类筛选正常

---

## 不修复的内容（保留硬编码）

| 类别 | 原因 |
|------|------|
| 语言扩展名映射 | 编程语言标准，用户确认保留 |
| 工具分类/执行器 | 状态机固定，用户确认保留 |
| 漏洞状态/严重程度 | 状态机固定，用户确认保留 |
| Skills Governance 状态 | 状态机固定，用户确认保留 |
| 各类推断关键词 | 推断逻辑，非业务数据 |