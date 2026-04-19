# 统一数据源整改计划

## TL;DR

> **核心原则**：有数据库就从数据库取，没有就是空，删除所有硬编码默认值。
> 
> **整改范围**：技术栈、漏洞分类、漏洞模式三个业务的数据获取逻辑。

---

## 问题现状

### 一、技术栈

| 问题位置 | 问题内容 |
|---------|---------|
| `src/lib/techstack-options.ts` | 硬编码的技术栈常量（PROGRAMMING_LANGUAGES, FRAMEWORKS 等），已废弃但未删除 |
| `src/app/dashboard/skills/page.tsx` 行122-135 | 硬编码的12种语言筛选列表 |
| `src/hooks/useTechStackOptions.ts` 注释 | 注释说"数据库为空则返回默认值"（实际代码已改） |

### 二、漏洞分类 (skill_categories)

| 问题位置 | 问题内容 |
|---------|---------|
| `src/lib/categories.ts` | DEFAULT_CATEGORIES 硬编码10种分类 |
| `src/app/api/admin/categories/route.ts` 行10-33 | DEFAULT_CATEGORIES 硬编码18种分类 |
| `src/types/skills.ts` | SkillCategory 类型硬编码10种分类 |
| 多个文件 | categoryLabels 硬编码映射分散在6+个文件 |

### 三、漏洞模式 (VulnerabilityPattern)

| 问题位置 | 问题内容 |
|---------|---------|
| `src/hooks/useVulnerabilityPatterns.ts` | VulnerabilityPattern 类型定义 |
| `src/components/skills/VulnerabilityPatternSelector.tsx` 行12-19 | 重复定义类型 |
| `src/app/dashboard/skills/create-wizard/IntentStep.tsx` 行8-15 | 重复定义类型 |
| `src/app/dashboard/admin/vulnerability-patterns/page.tsx` 行42-60 | 重复定义类型 |

---

## 整改目标

1. **技术栈**：所有使用位置统一从 TechStackOption 表获取
2. **漏洞分类**：所有使用位置统一从 SystemConfig.skill_categories 获取
3. **漏洞模式**：类型定义统一，数据获取统一

---

## TODOs

### Wave 1: 删除废弃文件和硬编码常量

- [x] 1. 删除 `src/lib/techstack-options.ts` 文件

  **What to do**:
  - 确认该文件没有被任何地方 import
  - 删除整个文件

  **Acceptance Criteria**:
  - [ ] 文件已删除
  - [ ] `npm run build` 成功

- [x] 2. 删除 `src/lib/categories.ts` 中的 DEFAULT_CATEGORIES

  **What to do**:
  - 删除 DEFAULT_CATEGORIES 常量
  - 删除 getCategories() 函数中的默认值返回逻辑
  - 数据库没有数据就返回空数组

  **Acceptance Criteria**:
  - [ ] DEFAULT_CATEGORIES 常量已删除
  - [ ] getCategories() 失败时返回空数组
  - [ ] `npm run build` 成功

- [x] 3. 删除 `src/app/api/admin/categories/route.ts` 中的 DEFAULT_CATEGORIES

  **What to do**:
  - 删除 DEFAULT_CATEGORIES 常量
  - 数据库没有配置时返回空数组

  **Acceptance Criteria**:
  - [ ] DEFAULT_CATEGORIES 常量已删除
  - [ ] 数据库无数据时返回空数组
  - [ ] `npm run build` 成功

### Wave 2: 修复前端硬编码

- [x] 4. 修复 `src/app/dashboard/skills/page.tsx` 硬编码技术栈筛选

  **What to do**:
  - 删除行122-135的硬编码语言列表
  - 使用 useTechStackOptionsWithIds('language') hook 获取语言列表

  **Acceptance Criteria**:
  - [ ] 硬编码列表已删除
  - [ ] 使用 hook 从数据库获取
  - [ ] `npm run build` 成功

- [x] 5. 删除 `src/types/skills.ts` 中的 SkillCategory 类型

  **What to do**:
  - 删除 SkillCategory 联合类型定义（行3-13）
  - CreateSkillRequest.category 改为 string
  - UpdateSkillRequest.category 改为 string
  - SkillResponse.category 改为 string

  **Acceptance Criteria**:
  - [ ] SkillCategory 类型已删除
  - [ ] 相关字段改为 string 类型
  - [ ] `npm run build` 成功

- [x] 5.1 删除 `src/services/skills.ts` 中的 SkillCategory 类型

  **What to do**:
  - 删除 SkillCategory 类型定义（行11-20）
  - LoadedSkill.category 改为 string
  - getCategoryLabel 函数参数改为 string
  - inferCategory 返回值改为 string

  **Acceptance Criteria**:
  - [ ] SkillCategory 类型已删除
  - [ ] 相关字段改为 string 类型
  - [ ] `npm run build` 成功

- [x] 5.2 修复 `src/services/evaluation/prompt.ts` 中的类型引用

  **What to do**:
  - getCategoryLabel 函数参数改为 string
  - 删除 Record<SkillCategory, string> 改为 Record<string, string>

  **Acceptance Criteria**:
  - [ ] 类型引用已修复
  - [ ] `npm run build` 成功

### Wave 3: 统一漏洞模式类型定义

- [x] 6. 创建统一的 VulnerabilityPattern 类型文件

  **What to do**:
  - 创建 `src/types/vulnerability-pattern.ts`
  - 定义 VulnerabilityPattern 接口（从数据库模型对应）
  - 从 useVulnerabilityPatterns hook 导出类型

  **Acceptance Criteria**:
  - [ ] 类型文件已创建
  - [ ] 类型定义与 Prisma 模型一致

- [x] 7. 修改各组件使用统一类型

  **What to do**:
  - `VulnerabilityPatternSelector.tsx` 导入统一类型
  - `IntentStep.tsx` 导入统一类型
  - `admin/vulnerability-patterns/page.tsx` 导入统一类型
  - 删除各组件内的重复类型定义

  **Acceptance Criteria**:
  - [ ] 所有组件使用统一类型
  - [ ] 重复定义已删除
  - [ ] `npm run build` 成功

### Wave 4: 统一数据获取方式

- [x] 8. 修改 `IntentStep.tsx` 使用 hook

  **What to do**:
  - 使用 useVulnerabilityPatterns hook 替代直接 API 调用
  - 使用 VulnerabilityPatternSelector 组件替代自定义下拉

  **Acceptance Criteria**:
  - [ ] 使用统一 hook
  - [ ] 使用统一组件
  - [ ] `npm run build` 成功

- [x] 9. 修改 `WorkflowEditor.tsx` 使用 hook

  **What to do**:
  - 使用 useVulnerabilityPatterns hook 替代直接 API 调用
  - 删除重复的类型定义

  **Acceptance Criteria**:
  - [ ] 使用统一 hook
  - [ ] 重复定义已删除
  - [ ] `npm run build` 成功

### Wave 5: 统一分类标签映射

- [x] 10. 创建统一的分类标签工具函数

  **What to do**:
  - 创建 `src/lib/category-labels.ts`
  - 提供 getCategoryLabel(value, categories) 函数
  - 删除各文件中分散的 categoryLabels 映射

  **Acceptance Criteria**:
  - [ ] 工具函数已创建
  - [ ] 各文件使用统一函数
  - [ ] `npm run build` 成功

### Wave 6: 最终验证

- [x] 11. 全量构建验证

  **What to do**:
  - 运行 `npm run build`
  - 确认无 TypeScript 错误

  **Acceptance Criteria**:
  - [ ] 构建成功

- [x] 12. 初始化数据验证

  **What to do**:
  - 确认有种子数据脚本初始化技术栈
  - 确认有种子数据脚本初始化漏洞分类

  **Acceptance Criteria**:
  - [ ] `npm run db:seed-techstack` 可初始化技术栈
  - [ ] 漏洞分类有初始化机制

---

## 删除清单

| 文件/代码 | 删除内容 |
|----------|---------|
| `src/lib/techstack-options.ts` | 整个文件 |
| `src/lib/categories.ts` | DEFAULT_CATEGORIES 常量 |
| `src/app/api/admin/categories/route.ts` | DEFAULT_CATEGORIES 常量 |
| `src/types/skills.ts` | SkillCategory 类型 |
| `src/app/dashboard/skills/page.tsx` | 硬编码语言列表 |
| 各组件 | 重复的 VulnerabilityPattern 类型定义 |
| 各组件 | 分散的 categoryLabels 映射 |

---

## 成功标准

1. **无硬编码**：代码中不存在任何业务数据的硬编码默认值
2. **统一来源**：所有数据都从数据库获取
3. **统一类型**：类型定义统一在一处，无重复
4. **构建成功**：`npm run build` 无错误
