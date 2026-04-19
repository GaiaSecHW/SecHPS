# 硬编码系统性排查报告

## 排查方法

采用 **5 维并行排查**：
1. 常量映射模式搜索（`_LABELS`, `_OPTIONS`, `_DEFAULT`, `_ICONS`, `_MAP`）
2. 业务数据字符串搜索（中文分类名、技术栈名）
3. 数据消费点来源追踪（API vs 硬编码）
4. API 路由硬编码返回检查
5. hooks/lib 硬编码导出检查

---

## 发现汇总

**18 类业务数据在 40+ 处重复硬编码**

---

## 一、重复定义问题（最高优先级）

### 1.1 Skill 分类标签 - 5 处完全相同
同一份 `categoryLabels` 在 5 个页面文件中各自定义：

| 文件 | 行号 | 变量名 |
|------|------|--------|
| `src/app/dashboard/skills/page.tsx` | 59-70 | `categoryLabels` |
| `src/app/dashboard/admin/skills-governance/high-frequency/page.tsx` | 65-76 | `categoryLabels` |
| `src/app/dashboard/admin/skills-governance/merge/page.tsx` | 111-122 | `categoryLabels` |
| `src/app/dashboard/admin/skills-governance/merge-candidates/page.tsx` | 94-105 | `categoryLabels` |
| `src/app/dashboard/admin/skills-governance/new-impact/page.tsx` | 94-104 | `categoryLabels` |

内容：`code-audit: 代码安全审计`, `auth: 认证与授权`, `sensitive: 敏感信息泄露`, 等 10 个分类

### 1.2 技术栈分类 - 2 处
| 文件 | 行号 | 变量名 |
|------|------|--------|
| `src/app/dashboard/config/TechStackSection.tsx` | 29-35 | `CATEGORY_LABELS` |
| `src/app/dashboard/config/TechStackSection.tsx` | 37-43 | `CATEGORY_OPTIONS` |

内容：`language: 编程语言`, `framework: 框架`, `database: 数据库`, `middleware: 中间件`, `cloud: 云服务`

### 1.3 工具分类 - 3 处相同
| 文件 | 行号 | 变量名 |
|------|------|--------|
| `src/app/dashboard/admin/tools/page.tsx` | 30-36 | `categoryLabels` |
| `src/app/dashboard/admin/tools/create/page.tsx` | 11-17 | `CATEGORIES` |
| `src/app/dashboard/admin/tools/[id]/page.tsx` | 14-18 | `CATEGORIES` |

内容：`file: 文件操作`, `code: 代码分析`, `security: 安全检测`, `network: 网络请求`, `system: 系统命令`

### 1.4 工具执行器类型 - 2 处相同
| 文件 | 行号 | 变量名 |
|------|------|--------|
| `src/app/dashboard/admin/tools/create/page.tsx` | 19-24 | `EXECUTORS` |
| `src/app/dashboard/admin/tools/[id]/page.tsx` | 22-25 | `EXECUTORS` |

内容：`http: HTTP请求`, `script: 脚本执行`, `builtin: 内置函数`, `mcp: MCP工具`

### 1.5 漏洞状态 - 2 处
| 文件 | 行号 | 变量名 |
|------|------|--------|
| `src/app/dashboard/admin/vulnerabilities/page.tsx` | 48-64 | `statusColors` + `statusLabels` |
| `src/app/dashboard/sessions/page.tsx` | 970-976 | `statusLabels` |

内容：`new: 新建`, `confirmed: 已确认`, `false_positive: 误报`, `fixed: 已修复`, `verified: 已验证`, `closed: 已关闭`

### 1.6 漏洞严重程度 - 2 处
| 文件 | 行号 | 变量名 |
|------|------|--------|
| `src/app/dashboard/admin/skills-governance/high-frequency/page.tsx` | 58-61 | 风险等级对象 |
| `src/app/dashboard/sessions/page.tsx` | 2775-2786 | `colors` + `labels` |

内容：`critical: 严重`, `high: 高危`, `medium: 中危`, `low: 低危`

### 1.7 自主进化分类 - 2 处相同
| 文件 | 行号 | 变量名 |
|------|------|--------|
| `src/app/dashboard/admin/autonomous-evolution/page.tsx` | 79-85 | `CATEGORY_LABELS` |
| `src/app/dashboard/admin/autonomous-evolution/[id]/page.tsx` | 42-48 | `CATEGORY_LABELS` |

内容：`tool_failure: 工具失败`, `path_error: 路径错误`, `permission: 权限问题`, `mcp_timeout: MCP超时`, `other: 其他`

### 1.8 Skills Governance 状态 - 8 处
分散在 8 个文件中，不同版本的状态定义：

- `analysis-review/page.tsx` - `statusColors`, `statusLabels`, `recommendationLabels`
- `duplicate-groups/[id]/page.tsx` - `statusColors`, `statusLabels`, `overlapTypeLabels`, `recommendationLabels`
- `duplicate-groups/page.tsx` - `statusColors`, `statusLabels`, `resolutionLabels`
- `merge-candidates/page.tsx` - `statusColors`, `statusLabels`
- `merge/page.tsx` - `overlapTypeLabels`, `strategies`, `mergeReasons`
- `page.tsx` - `overlapTypeLabels`
- `trends/page.tsx` - 统计卡片配置
- `new-impact/page.tsx` - `recommendationConfig`

### 1.9 Skill 变更类型 - 2 处相同
| 文件 | 行号 | 变量名 |
|------|------|--------|
| `src/components/skills/SkillVersionDiffModal.tsx` | 106-122 | `labels` + `colors` |
| `src/components/skills/SkillVersionHistory.tsx` | 97-113 | `labels` + `colors` |

内容：`prompt_update: 提示词更新`, `parameter_tuning: 参数调优`, `tool_added: 添加工具`, `tool_removed: 移除工具`

### 1.10 语言扩展名映射 - 5 处分散
| 文件 | 行号 | 变量名 |
|------|------|--------|
| `src/app/api/files/[projectId]/browse/route.ts` | 9-34 | `LANGUAGE_MAP` |
| `src/app/api/files/[projectId]/read/route.ts` | 9 | `LANGUAGE_MAP` |
| `src/app/api/claude/[project]/files/browse/route.ts` | 14-22 | `LANGUAGE_MAP` |
| `src/app/api/claude/[project]/files/read/route.ts` | 73 | `languageMap` |
| `src/app/api/projects/[id]/start/route.ts` | 1482-1497 | 扩展名映射 |

70+ 个扩展名到语言的映射分散定义

---

## 二、业务数据硬编码（应从数据库获取）

### 2.1 漏洞模式分类标签
| 文件 | 行号 | 变量名 | 问题 |
|------|------|--------|------|
| `src/components/skills/VulnerabilityPatternSelector.tsx` | 23-42 | `CATEGORY_LABELS` | 19 个分类应从 SystemConfig.skill_categories 获取 |

### 2.2 漏洞模式分类图标
| 文件 | 行号 | 变量名 | 问题 |
|------|------|--------|------|
| `src/app/dashboard/admin/vulnerability-patterns/page.tsx` | 18-41 | `categoryIcons` | 20+ 个分类图标映射应动态配置 |

### 2.3 漏洞类型推断
| 文件 | 行号 | 变量名 | 问题 |
|------|------|--------|------|
| `src/services/evaluation/result-parser.ts` | 280-292 | `patterns` 数组 | 漏洞类型正则推断应从数据库配置 |

### 2.4 技术栈推断
| 文件 | 行号 | 变量名 | 问题 |
|------|------|--------|------|
| `src/services/skill-merge.ts` | 642-662 | `techStackKeywords` | 技术栈关键词推断应从 TechStackOption 表获取 |

### 2.5 Skill 分类关键词
| 文件 | 行号 | 变量名 | 问题 |
|------|------|--------|------|
| `src/services/skill-similarity.ts` | 106-117 | `CATEGORY_KEYWORDS` | 分类关键词映射应从 SystemConfig 获取 |
| `src/services/skills.ts` | 643-654 | `labels` in `getCategoryLabel()` | 分类标签应从数据库获取 |
| `src/services/skills.ts` | 818-829 | `keywords` in `inferCategory()` | 分类推断应从数据库获取 |
| `src/app/api/skills/match/route.ts` | 473-484 | `categoryKeywords` | 分类关键词权重应配置化 |
| `src/app/api/skills/predict-tasks/route.ts` | 514-525 | `categoryKeywords` | 同上 |

---

## 三、UI 辅助类（可保留但应统一）

### 3.1 文件图标颜色
`src/components/files/FileBrowser.tsx` - `FILE_ICON_COLORS`, `EXTENSION_COLORS`

### 3.2 工具调用状态
`src/components/chat/ToolCallBlock.tsx` - 状态配置对象

### 3.3 插件状态
`src/app/dashboard/plugins/page.tsx` - `colors`, `labels`

### 3.4 广播颜色选项
`src/app/dashboard/admin/broadcast/page.tsx` - `COLOR_OPTIONS`

### 3.5 工作流节点分类
`src/components/workflow/NodePalette.tsx` - `categoryLabels`, `categoryIcons`

### 3.6 模型路由类型
`src/app/dashboard/models/page.tsx` - `ROUTE_TYPE_OPTIONS`, `PROVIDER_TYPE_LABELS`

### 3.7 Skill 创建向导步骤
`src/app/dashboard/skills/create-wizard/page.tsx` - `WIZARD_STEPS`

### 3.8 会话来源过滤器
`src/components/claude/SessionList.tsx` - `SOURCE_FILTERS`

---

## 四、修复优先级（基于数据库可用性）

### P0 - 必须修复（有数据库，硬编码导致不一致）

| 问题 | 数据库源 | 硬编码位置 | 修复方案 |
|------|----------|-----------|----------|
| **漏洞模式分类标签** | SystemConfig.skill_categories | VulnerabilityPatternSelector.tsx (第 23-42 行) | 删除 CATEGORY_LABELS，从 API 获取 |
| **技术栈分类** | TechStackOption.category 动态提取 | TechStackSection.tsx (第 29-43 行) | 删除硬编码，从数据动态提取 |

### P1 - 建议修复（重复定义，统一管理）

| 问题 | 重复次数 | 建议 |
|------|----------|------|
| **Skill 分类标签** | 5 处相同 | 无数据库，提取到共享常量 `src/lib/constants/skill-categories.ts` |
| **工具分类/执行器** | 3/2 处 | 无预设列表，提取到共享常量 |
| **漏洞状态/严重程度** | 4 处 | 状态机固定，提取到共享常量 |
| **语言扩展名映射** | 5 处 | 标准数据，提取到 `src/lib/language-map.ts` |

### P2 - 可保留（推断逻辑或 UI 辅助）

| 问题 | 原因 |
|------|------|
| **Skill 分类推断关键词** | 推断逻辑，无需配置化 |
| **技术栈推断关键词** | 推断逻辑，无需配置化 |
| **漏洞类型推断** | 推断逻辑，无需配置化 |
| **文件图标颜色** | UI 辅助 |
| **工作流节点类型** | 系统内置 |

---

## 六、hooks/lib 层硬编码分析

### 6.1 业务数据类（应迁移到数据库）

| 文件 | 导出名 | 数据类型 | 说明 |
|------|--------|----------|------|
| `src/types/permissions.ts` | `DEFAULT_ROLE_PERMISSIONS` | 角色权限映射 | 5 个角色的默认权限配置 |
| `src/types/workflow.ts` | `NODE_TYPES` | 工作流节点类型定义 | 8 种节点类型 |
| `src/types/workflow.ts` | `NODE_TYPE_MAP` | 节点类型映射 | 同上 |

### 6.2 函数返回硬编码模板

| 文件 | 函数名 | 内容 |
|------|--------|------|
| `src/lib/skill-builder.ts` | `getSkillDefaultTemplate()` | 600+ 行 Skill 模板 |
| `src/lib/skill-builder.ts` | `getFormatGuideData()` | 格式指南数据 |
| `src/lib/skill-builder.ts` | `buildSystemPrompt()` | 系统提示词 |

### 6.3 显示标签类（可保留）

| 文件 | 导出名 | 内容 |
|------|--------|------|
| `src/types/call-scene.ts` | `CALL_SCENE_LABELS` | 调用场景标签 |
| `src/types/tool.ts` | `TOOL_CATEGORY_LABELS` | 工具分类标签 |
| `src/types/tool.ts` | `TOOL_EXECUTOR_LABELS` | 执行器类型标签 |
| `src/types/audit.ts` | `ACTION_CATEGORIES` | 审计动作分类 |

### 6.4 Hooks 层（已正确实现）

- `useTechStackOptions` → API
- `useVulnerabilityPatterns` → API
- 其他 hooks 均从 API 获取数据，无硬编码

---

## 五、数据库可用性分析（关键）

### 已有数据库表/配置

| 数据库表/配置 | 存储内容 | 种子数据 | 对应硬编码 |
|--------------|----------|----------|-----------|
| **TechStackOption** | 技术栈选项 | seed-techstack.ts | ✅ 有数据库，应从数据库获取 |
| **VulnerabilityPattern** | 漏洞模式 (name, category 字段) | seed-vulnerability-patterns.ts | ✅ 有数据库，应从数据库获取 |
| **SystemConfig.skill_categories** | 漏洞分类列表 (18个分类) | seed-vulnerability-patterns.ts | ✅ 有数据库，应从 SystemConfig 获取 |
| **Tool** | 工具定义 (category 字段) | 无种子数据 | ⚠️ 有字段，但无预设分类列表 |
| **Vulnerability** | 漏洞记录 (status, severity 字段) | 无种子数据 | ⚠️ 有字段，但无预设状态列表 |
| **Role + Permission + UserRole** | 角色权限体系 | seed.ts | ✅ 有数据库 |
| **SkillDuplicateGroup** | 重复组状态 | 无种子数据 | ⚠️ 有字段 status/resolution |
| **SkillMergeRecord** | 合并记录状态 | 无种子数据 | ⚠️ 有字段 status |

### 硬编码 vs 数据库对比表

| 硬编码类别 | 数据库可用? | 种子数据 | 结论 |
|-----------|------------|----------|------|
| **Skill 分类标签** (code-audit 等 10 个) | ❌ 无 | 无 | **可硬编码** - 无数据库表，属于推断逻辑 |
| **漏洞模式分类** (injection 等 18 个) | ✅ SystemConfig.skill_categories | 有 | **应从数据库获取** - 删除硬编码 |
| **技术栈分类** (language/framework 等 5 个) | ✅ TechStackOption.category | 有 | **应从数据库动态提取** |
| **工具分类** (file/code 等 5 个) | ⚠️ Tool.category 字段存在 | 无种子 | **部分可用** - 分类值存在数据库，但无预设列表 |
| **工具执行器类型** (http/script 等 4 个) | ⚠️ Tool.executor 字段存在 | 无种子 | **部分可用** - 同上 |
| **漏洞状态** (new/confirmed 等 6 个) | ⚠️ Vulnerability.status 字段 | 无种子 | **部分可用** - 状态值在数据库，但无预设列表 |
| **漏洞严重程度** (critical/high 等 4 个) | ⚠️ Vulnerability.severity 字段 | 无种子 | **部分可用** - 同上 |
| **语言扩展名映射** (.js→JavaScript) | ❌ 无 | 无 | **可硬编码** - 编程语言标准，无需配置 |
| **Skills Governance 状态** | ⚠️ 各表有 status 字段 | 无种子 | **部分可用** - 状态值在数据库，但无预设列表 |
| **角色权限映射** | ✅ Role/Permission/UserRole | 有种子 | **应从数据库获取** |

### 结论：哪些必须改，哪些可以保留

**必须删除硬编码，改用数据库**：
1. ✅ **漏洞模式分类标签** - SystemConfig.skill_categories 已有数据
2. ✅ **技术栈分类** - TechStackOption.category 可动态提取唯一值
3. ✅ **角色权限映射** - 已有完整 RBAC 表

**可以保留硬编码（无数据库或标准数据）**：
1. ✅ **Skill 分类标签** (code-audit 等) - 无数据库，属于推断逻辑关键词
2. ✅ **语言扩展名映射** - 编程语言标准，稳定不变
3. ✅ **文件图标颜色** - UI 辅助，无需配置
4. ✅ **工作流节点类型** - 系统内置类型

**需要评估（有字段但无预设列表）**：
1. ⚠️ **工具分类/执行器** - Tool 表有字段，但无预设分类列表
   - 建议：保留硬编码或创建 SystemConfig.tool_categories
2. ⚠️ **漏洞状态/严重程度** - Vulnerability 表有字段，但无预设列表
   - 建议：保留硬编码（状态机固定）或创建 SystemConfig
3. ⚠️ **Skills Governance 状态** - 各表有 status，但无预设列表
   - 建议：保留硬编码（状态机固定）

---

## 六、建议修复方案

### 方案 A：共享常量文件（快速方案）

创建 `src/lib/constants/` 目录：
```
src/lib/constants/
├── skill-categories.ts    # Skill 分类标签
├── vulnerability.ts       # 漏洞状态、严重程度
├── tools.ts               # 工具分类、执行器类型
├── techstack.ts           # 技术栈分类
├── governance.ts          # Skills Governance 状态
├── language-map.ts        # 语言扩展名映射
└── index.ts               # 统一导出
```

### 方案 B：数据库配置表（彻底方案）

利用现有 `SystemConfig` 表，添加配置项：
- `skill_category_labels`
- `vulnerability_status_labels`
- `tool_categories`
- `governance_statuses`
- 等

创建 `/api/config/labels` 统一获取。

### 方案 C：混合方案（推荐）

1. **P0 问题** - 用方案 B（数据库）
2. **P1 问题** - 用方案 A（共享常量）
3. **P2 问题** - 逐步迁移到方案 B
4. **P3 问题** - 保持现状
