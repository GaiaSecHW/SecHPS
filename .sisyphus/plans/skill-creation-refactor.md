# Skill 创建流程改造计划

## TL;DR

> **改造目标**：
> 1. Skill 创建时，`techStack` 改为单选语言，`category` 改为从 `VulnerabilityPattern` 表选择漏洞类型
> 2. 建立 Skill 内容标准模板，让大模型参考生成高质量 Skill
> 3. 建立 Skill 治理机制：检测重复、LLM 分析、人工审核
>
> **影响范围**：数据库存储格式、API 接收逻辑、两个前端创建页面、存量数据迁移、Skill 内容模板

---

## Context

### 现状

| 字段 | 现状 | 问题 |
|------|------|------|
| `techStack` | 多选，存 JSON 数组 | 用户希望单选语言 |
| `category` | 从 SystemConfig 表获取大类（code-audit 等）| 用户希望用 VulnerabilityPattern 的具体漏洞类型 |

### 现有数据来源

- `techStack` → `TechStackOption` 表 + 默认常量
- `category` → `SystemConfig` 表（key='skill_categories')

### 创建方式

1. 引导式创建：`/dashboard/skills/create-wizard`
2. 快速创建：`/dashboard/skills/create`
3. 提交 API：`POST /api/skills`

### 治理需求

用户希望：
- 每个 Skill 都是高质量的，解决一类问题
- 没有任何两个 Skill 的工作会有重合
- 创建时有"优秀实践"指导
- 存量 Skill 需要治理

### 现有治理基础设施

项目中已存在以下服务（可复用）：

| 组件 | 文件 | 功能 |
|------|------|------|
| `skill-llm-analysis.ts` | `src/services/` | LLM 分析两个 Skill 是否重复 |
| `skill-similarity.ts` | `src/services/` | 三层相似度检测（关键词、类别、内容） |
| `full-analysis API` | `src/app/api/admin/skills-governance/` | 全量分析 API |

**关键约束（用户明确要求）**：
1. "同一语言 + 同一漏洞类型可以有多个 Skill，但治理系统要感知"
2. "漏洞类型从 VulnerabilityPattern 选择，存 ID"
3. "重复组处理都是要人工审核的"
4. "LLM 分析的时机：创建后异步分析 + 用户手动触发全量分析"
5. "分析结果存储：新表 + 存储 LLM 的详细分析过程"
6. "模板不要放输出格式，大模型生成的内容也禁止包含输出格式"
7. "如果用户提供的内容不够，由大模型负责生成"
8. **⚠️ "存量数据的 techStack 和 category 数据不准"** - 迁移时需要 LLM 智能分析 Skill 内容来推断正确的语言和漏洞类型

---

## Work Objectives

### 核心目标

改造 Skill 创建流程，使每个 Skill 有明确的：
- **目标语言**（单选）
- **漏洞类型**（来自 VulnerabilityPattern）
- **高质量内容**（参考模板生成）

### 改造后数据流

```
TechStackOption 表 → 单选语言 → Skill.techStack (存单个 ID)

VulnerabilityPattern 表 → 漏洞类型下拉 → Skill.vulnerabilityPatternId (新增字段，存 ID)
```

### 具体改造点

1. **数据库**：字段存储格式改变 + 新增治理相关表
2. **API**：接收和存储逻辑调整 + 治理 API
3. **前端**：两个创建页面 UI 改造 + 治理界面
4. **存量数据**：迁移现有 121 个 Skill
5. **Skill 模板**：建立高质量内容模板供大模型参考

---

## Skill 内容模板（大模型生成参考）

### 模板结构

**禁止包含**：输出格式章节

```markdown
---
name: [skill-name]
description: |
  [角色定位] [漏洞类型] 检测专家
  适用技术栈：[语言/框架]
  触发条件：[关键词/场景]
  不适用场景：[明确排除，指引用户使用其他 Skill]
---

# [漏洞类型] 安全检测 Skill

## 0. 角色定位
- 你是专门检测 [漏洞类型] 的安全专家
- 你的核心职责是...
- 你不负责...（明确边界）

## 1. 漏洞概述
- [漏洞类型] 的定义
- 常见危害（真实案例简述）
- CWE/CVE 参考

## 2. 检测目标
- 明确列出要检测的代码模式
- 哪些文件/函数需要重点关注
- 检测深度说明（静态分析/动态验证）

## 3. 检测步骤
### 3.1 入口识别
- 如何找到检测入口
- 哪些模式值得深入

### 3.2 数据流追踪
- 用户输入 → 数据处理 → 输出/存储
- 关键变量命名模式

### 3.3 漏洞确认
- 如何验证漏洞存在
- 哪些是误报需要排除

## 4. 漏洞示例
### 4.1 基础示例
```language
// 有漏洞的代码
// 修复后的代码
```

### 4.2 隐蔽示例
```language
// 更难发现的漏洞变体
// 修复方法
```

## 5. 陷阱与边缘情况（最重要）
- **误报陷阱 1**：看似漏洞但实际安全的代码模式
- **误报陷阱 2**：需要上下文才能判断的情况
- **漏报陷阱**：容易遗漏的漏洞变体
- **边界情况**：特殊情况的处理建议

## 6. 修复建议
- 针对不同场景的修复方案
- 修复代码示例
- 验证修复是否有效

## 7. 参考资源
- CWE 编号和链接
- OWASP 指南
- 相关安全公告
```

### 大模型生成约束

1. **禁止包含输出格式**：模板不要放输出格式，大模型生成的内容也禁止包含输出格式
2. **内容必须完整**：如果用户提供的内容不够，由大模型负责生成完整内容
3. **参考 VulnerabilityPattern**：生成时参考 VulnerabilityPattern 表中的 patterns、exampleVulnerable、exampleFixed、fixGuidance 字段
4. **针对特定语言**：生成的 Skill 针对用户选择的单一语言，不是通用描述

---

## Skill 治理机制设计

### 治理流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Skill 创建/治理流程                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  用户创建 Skill                                                              │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────┐                               │
│  │ 1. 基础重复检测（预检查）                  │                               │
│  │    - 同语言 + 同漏洞类型？                │                               │
│  │    - 快速关键词匹配                       │                               │
│  └─────────────────────────────────────────┘                               │
│       │                                                                     │
│       ├── 无潜在重复 ───────────────────────────────────────┐               │
│       │                                                     │               │
│       ▼                                                     ▼               │
│  ┌─────────────────────────────────────────┐     ┌─────────────────────┐   │
│  │ 2. 创建 Skill（待分析状态）               │     │ 直接创建成功         │   │
│  │    status: 'pending_analysis'           │     │ status: 'active'    │   │
│  └─────────────────────────────────────────┘     └─────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────┐                               │
│  │ 3. 异步 LLM 深度分析（后台队列）           │                               │
│  │    - 调用 skill-llm-analysis.ts         │                               │
│  │    - 分析与现有 Skill 的语义相似度        │                               │
│  │    - 结果存入 SkillAnalysis 表          │                               │
│  └─────────────────────────────────────────┘                               │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────┐                               │
│  │ 4. 治理结果通知                          │                               │
│  │    - 发现重复 → 通知管理员审核            │                               │
│  │    - 无重复 → 标记为 active              │                               │
│  └─────────────────────────────────────────┘                               │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  管理员手动触发全量分析                                                       │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────┐                               │
│  │ 扫描所有 Skill，两两比较                  │                               │
│  │ → 生成重复组报告                          │                               │
│  │ → 人工审核决定：合并/保留/删除            │                               │
│  └─────────────────────────────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 数据库新增表

#### SkillAnalysis 表（存储 LLM 分析结果）

```prisma
model SkillAnalysis {
  id                String   @id @default(cuid())
  skillId           String   // 被分析的 Skill
  relatedSkillId    String?  // 相关的另一个 Skill（两两比较时）
  
  // 分析类型
  analysisType      String   // 'duplication_check' | 'full_analysis' | 'quality_review'
  
  // 分析结果
  isDuplicate       Boolean  @default(false)
  overlapType       String?  // 'exact' | 'subset' | 'related' | 'distinct'
  confidence        Float    @default(0)  // 0-1
  
  // LLM 详细分析过程
  llmReason         String?  // LLM 给出的判断理由
  keyDifferences    String?  // JSON: 主要差异点列表
  sharedFunctionality String? // JSON: 共享功能列表
  recommendation    String?  // 'merge' | 'keep_separate' | 'review'
  
  // 审核状态
  reviewStatus      String   @default('pending') // 'pending' | 'approved' | 'rejected'
  reviewedBy        String?  // 审核人
  reviewedAt        DateTime?
  reviewNotes       String?  // 审核备注
  
  // 元数据
  analyzedAt        DateTime @default(now())
  analyzedBy        String   @default('system') // 'system' | 'manual'
  
  createdAt         DateTime @default(now())
  
  skill             Skill    @relation(fields: [skillId], references: [id], onDelete: Cascade)
  
  @@index([skillId])
  @@index([reviewStatus])
  @@index([analysisType])
}
```

#### SkillDuplicateGroup 表（重复组管理）

```prisma
model SkillDuplicateGroup {
  id                String   @id @default(cuid())
  name              String?  // 组名（可选）
  language          String   // 共同语言
  vulnerabilityType String   // 共同漏洞类型
  
  // 组状态
  status            String   @default('pending_review') // 'pending_review' | 'resolved'
  resolution        String?  // 'merged' | 'keep_all' | 'deleted_duplicates'
  resolvedBy        String?
  resolvedAt        DateTime?
  resolutionNotes   String?
  
  // 统计
  skillCount        Int      @default(0)
  
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  members           SkillDuplicateGroupMember[]
  
  @@index([status])
  @@index([language])
}

model SkillDuplicateGroupMember {
  id                String   @id @default(cuid())
  groupId           String
  skillId           String
  
  // 在组中的角色
  role              String   @default('member') // 'primary' | 'member' | 'duplicate'
  similarityScore   Float    @default(0)
  
  joinedAt          DateTime @default(now())
  
  group             SkillDuplicateGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  skill             Skill              @relation(fields: [skillId], references: [id], onDelete: Cascade)
  
  @@unique([groupId, skillId])
  @@index([groupId])
  @@index([skillId])
}
```

### API 设计

#### 1. 创建时异步分析

```typescript
// POST /api/skills - 创建后触发异步分析
async function createSkill(data) {
  // 1. 创建 Skill
  const skill = await prisma.skill.create({...});
  
  // 2. 预检查：快速判断是否有潜在重复
  const potentialDuplicates = await quickDuplicateCheck(skill);
  
  // 3. 异步触发深度分析（不阻塞响应）
  if (potentialDuplicates.length > 0) {
    queueAnalysisJob(skill.id, potentialDuplicates);
    // 返回时标记为待分析
    return { skill, status: 'pending_analysis' };
  }
  
  return { skill, status: 'active' };
}
```

#### 2. 全量分析 API

```typescript
// POST /api/admin/skills-governance/full-analysis
async function runFullAnalysis() {
  // 1. 获取所有 Skill
  const skills = await prisma.skill.findMany();
  
  // 2. 两两比较（智能过滤）
  const pairs = filterPairsForLLMAnalysis(skills);
  
  // 3. 批量 LLM 分析
  const results = await batchAnalyzeSkills(pairs);
  
  // 4. 存储结果
  for (const result of results.results) {
    await prisma.skillAnalysis.create({
      data: {
        skillId: result.skillA,
        relatedSkillId: result.skillB,
        analysisType: 'full_analysis',
        ...result.analysis,
      }
    });
  }
  
  // 5. 生成重复组
  const groups = generateDuplicateGroups(results);
  for (const group of groups) {
    await prisma.skillDuplicateGroup.create({...});
  }
  
  return { total: results.total, groups: groups.length };
}
```

#### 3. 治理审核 API

```typescript
// PATCH /api/admin/skills-governance/review/:id
async function reviewAnalysis(analysisId, decision) {
  const analysis = await prisma.skillAnalysis.update({
    where: { id: analysisId },
    data: {
      reviewStatus: decision.status,
      reviewedBy: decision.reviewer,
      reviewedAt: new Date(),
      reviewNotes: decision.notes,
    }
  });
  
  // 如果决定合并或删除，触发后续操作
  if (decision.action === 'merge') {
    await mergeSkills(analysis.skillId, analysis.relatedSkillId);
  }
  
  return analysis;
}
```

### 前端治理界面

#### 1. 治理仪表盘

位置：`/dashboard/skills/governance`

功能：
- 显示待审核的重复组数量
- 显示最近的分析结果
- 快速操作入口

#### 2. 重复组列表

位置：`/dashboard/skills/governance/duplicates`

功能：
- 按语言/漏洞类型分组显示
- 每组显示成员 Skill 及相似度
- 审核/合并/删除操作

#### 3. 分析结果详情

位置：`/dashboard/skills/governance/analysis/:id`

功能：
- 显示 LLM 详细分析过程
- 显示两个 Skill 的对比
- 审核操作界面

---

## Verification Strategy

### QA 方式

- Agent 执行后验证：
  1. 创建新 Skill，检查 techStack 和 category 存储是否正确
  2. 检查存量数据迁移是否完整
  3. 检查前端下拉框数据是否正确加载

---

## Execution Strategy

### 并行执行波浪

```
Wave 1 (基础准备):
├── T1: 调研 VulnerabilityPattern 表数据结构
├── T2: 调研 TechStackOption 表数据结构
└── T3: 设计 API 接口变更方案

Wave 2 (数据库变更):
├── T4: 备份现有 Skill 数据
└── T5: 修改数据库表结构（新增字段 + 新表）

Wave 3 (治理逻辑开发):
├── T6: 开发重复检测逻辑（同语言 + 同漏洞类型）
├── T7: 集成 LLM 深度分析服务
└── T8: 开发治理 API 端点

Wave 4 (存量数据治理迁移):
├── T9: LLM 智能分析存量 Skill
└── T10: 生成治理报告

Wave 5 (API 改造):
├── T11: 新增 VulnerabilityPattern 列表 API
├── T12: 改造 POST /api/skills 接收逻辑
└── T13: 改造 Skill 查询 API

Wave 6 (前端改造):
├── T14: 改造快速创建页面 UI
├── T15: 改造引导式创建页面 UI
└── T16: 新增治理界面

Wave FINAL (验证):
├── T17: 测试创建流程 + 异步分析
└── T18: 验证存量数据治理结果

Wave MANUAL (人工审核 - 最后执行):
├── T19: 人工审核存量迁移结果
└── T20: 人工审核重复组处理
```

---

## TODOs

### Wave 1: 基础准备

- [ ] 1. 调研 VulnerabilityPattern 表数据结构

  **What to do**:
  - 查看 VulnerabilityPattern 表字段
  - 了解现有数据有哪些漏洞类型
  - 确认哪些字段用于下拉选项（name、displayName、id）

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 1 (with T2, T3)

- [ ] 2. 调研 TechStackOption 表数据结构

  **What to do**:
  - 查看 TechStackOption 表字段
  - 了解现有数据有哪些语言选项
  - 确认 category 字段是否可以用于筛选"语言"类型

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 1 (with T1, T3)

- [ ] 3. 设计 API 接口变更方案

  **What to do**:
  - 分析 POST /api/skills 接收逻辑需要哪些改动
  - 设计 VulnerabilityPattern 列表 API 返回格式
  - 确认 techstack-options API 是否需要改动

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 1 (with T1, T2)

---

### Wave 2: 数据库变更

- [ ] 4. 备份现有 Skill 数据

  **What to do**:
  - 导出所有 Skill 数据到 JSON 文件
  - 记录 techStack 和 category 的原始值
  - 生成备份报告

  **⚠️ 重要约束**：存量数据的 `techStack` 和 `category` **数据不准**，迁移时需要 LLM 智能分析

  **Backup Script**:
  ```javascript
  // scripts/backup-skills.js
  // 导出 data/skills-backup-{timestamp}.json
  // 包含所有 Skill 原始数据（包括 content 用于 LLM 分析）
  ```

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 2 (with T5)

- [ ] 5. 修改数据库表结构

  **What to do**:
  - 添加 Skill.vulnerabilityPatternId 字段（替代 category）
  - 创建 SkillAnalysis 表
  - 创建 SkillDuplicateGroup 和 SkillDuplicateGroupMember 表
  - 添加 Skill.migrationStatus 字段（标记迁移状态）
  - 保留原有 category 字段（迁移完成后删除）
  - 运行 prisma migrate

  **Schema Changes**:
  ```prisma
  model Skill {
    // 新增字段
    vulnerabilityPatternId String?  // 替代 category
    vulnerabilityPattern   VulnerabilityPattern? @relation(...)
    migrationStatus        String   @default("pending") // 'pending' | 'analyzing' | 'migrated' | 'failed'
    migrationNotes         String?  // 迁移备注
    
    // 保留原字段（迁移期间）
    category               String?  // 迁移后删除
    techStack              String?  // 保持原有格式，新增 techStackId
    techStackId            String?  // 新字段：单个语言 ID
  }
  ```

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 2 (with T4)

- [ ] 6. 运行 prisma migrate

  **What to do**:
  - 执行 `npx prisma migrate dev --name add-skill-governance`
  - 验证表结构正确

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: NO（依赖 T5）
  - Blocked By: T5

---

### Wave 3: 治理逻辑开发

- [ ] 6. 开发重复检测逻辑

  **What to do**:
  - 实现"同语言 + 同漏洞类型"快速检测
  - 集成现有 `skill-similarity.ts` 服务
  - 新增 Skill 创建时自动触发预检查
  - 将检测结果存入 SkillAnalysis 表

  **Detection Rules**:
  ```javascript
  // 快速预检查：同语言 + 同漏洞类型
  function quickDuplicateCheck(newSkill, existingSkills) {
    return existingSkills.filter(s => 
      s.techStackId === newSkill.techStackId &&
      s.vulnerabilityPatternId === newSkill.vulnerabilityPatternId
    );
  }
  
  // 深度检测：调用 LLM 分析
  async function deepDuplicateCheck(skillA, skillB) {
    return await analyzeSkillDuplication(skillA, skillB);
  }
  ```

  **References**:
  - `src/services/skill-similarity.ts` - 相似度检测服务
  - `src/services/skill-llm-analysis.ts` - LLM 分析服务

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 3 (with T7, T8)

- [ ] 7. 集成 LLM 深度分析服务 + 存量数据智能迁移

  **What to do**:
  - 复用现有 `skill-llm-analysis.ts`
  - **新增：LLM 智能推断存量 Skill 的语言和漏洞类型**（因为存量数据不准）
  - 实现异步分析队列
  - 将分析过程和结果存入 SkillAnalysis 表

  **⚠️ 存量数据智能迁移**（关键）：
  ```javascript
  // LLM 分析存量 Skill，推断正确的语言和漏洞类型
  async function inferSkillMetadata(skill) {
    const prompt = `
      分析以下 Skill 内容，推断：
      1. 主要编程语言（只能选一个）
      2. 漏洞类型（从已知列表中选择最匹配的）
      
      Skill 名称: ${skill.name}
      Skill 描述: ${skill.description}
      Skill 内容: ${skill.content?.substring(0, 3000)}
      原始 techStack: ${skill.techStack}（可能不准）
      原始 category: ${skill.category}（可能不准）
      
      返回 JSON: { language: string, vulnerabilityPatternId: string, confidence: number }
    `;
    
    return await callLLM(prompt);
  }
  ```

  **References**:
  - `src/services/skill-llm-analysis.ts` - LLM 分析服务

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 3 (with T6, T8)

- [ ] 8. 开发治理 API 端点

  **What to do**:
  - GET /api/admin/skills-governance/status - 获取治理状态概览
  - POST /api/admin/skills-governance/full-analysis - 触发全量分析
  - GET /api/admin/skills-governance/duplicates - 获取重复组列表
  - GET /api/admin/skills-governance/analysis/:id - 获取分析详情
  - PATCH /api/admin/skills-governance/analysis/:id/review - 审核分析结果
  - POST /api/admin/skills-governance/merge - 合并 Skill
  - **POST /api/admin/skills-governance/migrate-legacy** - 存量数据迁移（LLM 推断）

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 3 (with T6, T7)

---

### Wave 4: 存量数据治理迁移

- [ ] 9. LLM 智能分析存量 Skill

  **What to do**:
  - 读取备份数据
  - 对每个存量 Skill 调用 LLM 推断：
    - 正确的编程语言（techStackId）
    - 正确的漏洞类型（vulnerabilityPatternId）
  - 存储 LLM 推断结果和置信度
  - 标记低置信度记录待人工确认

  **⚠️ 存量数据不准的处理策略**：
  ```javascript
  async function migrateLegacySkills(backupSkills) {
    const results = [];
    
    for (const skill of backupSkills) {
      // 1. LLM 推断正确的元数据
      const inference = await inferSkillMetadata(skill);
      
      // 2. 根据置信度决定处理方式
      if (inference.confidence >= 0.8) {
        // 高置信度：自动迁移
        skill.techStackId = inference.language;
        skill.vulnerabilityPatternId = inference.vulnerabilityPatternId;
        skill.migrationStatus = 'migrated';
      } else if (inference.confidence >= 0.5) {
        // 中置信度：待人工确认
        skill.techStackId = inference.language;
        skill.vulnerabilityPatternId = inference.vulnerabilityPatternId;
        skill.migrationStatus = 'pending_review';
        skill.migrationNotes = `LLM 推断置信度 ${inference.confidence}，需人工确认`;
      } else {
        // 低置信度：标记失败
        skill.migrationStatus = 'failed';
        skill.migrationNotes = `LLM 无法确定元数据，置信度过低`;
      }
      
      results.push({ skill, inference });
    }
    
    return results;
  }
  ```

  **Recommended Agent Profile**:
  - Category: `deep`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: NO（依赖 Wave 3）
  - Blocked By: T8

- [ ] 10. 生成治理报告

  **What to do**:
  - 统计迁移成功/失败/待审核数量
  - 统计发现的重复组数量
  - 生成待人工审核列表：
    - 低置信度推断
    - 潜在重复 Skill
  - 生成详细迁移报告

  **Report Content**:
  ```javascript
  {
    total: 121,
    migrated: 85,        // 高置信度自动迁移
    pendingReview: 25,   // 中置信度待审核
    failed: 11,          // 低置信度失败
    duplicateGroups: 12,
    pendingReviewList: [
      {
        skillId: 'xxx',
        skillName: 'SQL Injection Detection',
        originalTechStack: ['Java', 'MySQL'],
        inferredLanguage: 'Java',
        originalCategory: 'code-audit',
        inferredVulnerability: 'SQL Injection',
        confidence: 0.65,
        reason: '内容涉及 SQL 拼接检测，但语言特征不明显'
      },
      // ...
    ]
  }
  ```

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: NO（依赖 T9）
  - Blocked By: T9

---

### Wave 5: API 改造

- [ ] 11. 新增 VulnerabilityPattern 列表 API

  **What to do**:
  - 创建 GET /api/vulnerability-patterns API
  - 返回漏洞类型列表（id、name、displayName、category）
  - 支持按 category 筛选（可选）

  **References**:
  - `src/app/api/admin/categories/route.ts` - 参考现有分类 API 结构
  - `prisma/schema.prisma:VulnerabilityPattern` - 数据模型

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 5 (with T12, T13)

- [ ] 12. 改造 POST /api/skills 接收逻辑

  **What to do**:
  - techStack 改为接收单个 ID（存入 techStackId）
  - category 改为接收 VulnerabilityPattern 的 ID（存入 vulnerabilityPatternId）
  - 验证 ID 是否存在于对应表中
  - 创建后异步触发重复检测

  **References**:
  - `src/app/api/skills/route.ts` - 现有创建逻辑
  - `src/services/skill-llm-analysis.ts` - LLM 分析服务

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 5 (with T11, T13)

- [ ] 13. 改造 Skill 查询 API

  **What to do**:
  - GET /api/skills 返回新增字段（techStackId, vulnerabilityPatternId）
  - 关联查询 TechStackOption 和 VulnerabilityPattern 显示名称
  - 支持按语言和漏洞类型筛选

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 5 (with T14, T15)

---

### Wave 6: 前端改造

- [ ] 17. 改造快速创建页面 UI

  **What to do**:
  - techStack：多选改单选下拉框（调用 techstack-options API）
  - category：数据源改为 VulnerabilityPattern API，存入 vulnerabilityPatternId
  - 添加"参考模板生成"选项
  - 保持其他字段不变

  **References**:
  - `src/app/dashboard/skills/create/page.tsx` - 现有页面

  **Recommended Agent Profile**:
  - Category: `visual-engineering`
  - Skills: `['frontend-ui-ux']`

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 6 (with T18, T19)

- [ ] 18. 改造引导式创建页面 UI

  **What to do**:
  - techStack：多选改单选
  - category：数据源改为 VulnerabilityPattern API
  - 添加 Skill 内容模板预览
  - 可能需要调整步骤布局

  **References**:
  - `src/app/dashboard/skills/create-wizard/page.tsx` - 现有页面
  - `src/app/dashboard/skills/create-wizard/IntentStep.tsx` - 第一步组件

  **Recommended Agent Profile**:
  - Category: `visual-engineering`
  - Skills: `['frontend-ui-ux']`

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 6 (with T17, T19)

- [ ] 19. 新增治理界面

  **What to do**:
  - 创建治理仪表盘 `/dashboard/skills/governance`
  - 创建重复组列表 `/dashboard/skills/governance/duplicates`
  - 创建分析详情页 `/dashboard/skills/governance/analysis/:id`
  - **创建存量迁移审核页 `/dashboard/skills/governance/migration`**（审核 LLM 推断结果）
  - 实现审核操作界面

  **Recommended Agent Profile**:
  - Category: `visual-engineering`
  - Skills: `['frontend-ui-ux']`

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 6 (with T17, T18)

---

### Wave FINAL: 验证

- [ ] 20. 测试创建流程 + 异步分析

  **What to do**:
  - 使用快速创建页面创建新 Skill
  - 使用引导式创建页面创建新 Skill
  - 检查数据库存储是否正确
  - 检查异步分析是否触发

  **QA Scenarios**:
  - 快速创建：选择语言 + 漏洞类型 → 提交 → 检查数据库
  - 引导式创建：完成所有步骤 → 检查数据库
  - 重复检测：创建相似 Skill → 检查是否被标记

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

- [ ] 21. 验证存量数据治理结果

  **What to do**:
  - 检查 LLM 推断的迁移数据是否合理
  - 确认人工审核完成
  - 运行全量分析验证治理功能
  - 生成最终报告

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []
  - Skills: `['frontend-ui-ux']`

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 6 (with T15, T16)

---

### Wave FINAL: 验证

- [ ] 18. 测试创建流程

  **What to do**:
  - 使用快速创建页面创建新 Skill
  - 使用引导式创建页面创建新 Skill
  - 检查数据库存储是否正确
  - 检查异步分析是否触发

  **QA Scenarios**:
  - 快速创建：选择语言 + 漏洞类型 → 提交 → 检查数据库
  - 引导式创建：完成所有步骤 → 检查数据库
  - 重复检测：创建相似 Skill → 检查是否被标记

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

- [ ] 19. 验证存量数据

  **What to do**:
  - 检查迁移后的数据是否正确
  - 确认无法迁移的记录已被标记
  - 运行全量分析验证治理功能
  - 生成最终报告

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 2 (with T5, T6)

- [ ] 5. 改造 POST /api/skills 接收逻辑

  **What to do**:
  - techStack 改为接收单个 ID（不再转 JSON 数组）
  - category 改为接收 VulnerabilityPattern 的 ID
  - 验证 ID 是否存在于对应表中

  **References**:
  - `src/app/api/skills/route.ts` - 现有创建逻辑

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 2 (with T4, T6)

- [ ] 6. 改造 techstack-options API（支持语言筛选）

  **What to do**:
  - 如果 TechStackOption 表有多种类型（语言、框架、数据库等）
  - 添加 category 参数筛选只返回"语言"类型
  - 或确认现有数据是否只有语言

  **References**:
  - `src/app/api/techstack-options/route.ts` - 现有 API

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 2 (with T4, T5)

---

### Wave 3: 前端改造

- [ ] 7. 改造快速创建页面 UI

  **What to do**:
  - techStack：多选改单选下拉框
  - category：数据源改为 VulnerabilityPattern API
  - 保持其他字段不变

  **References**:
  - `src/app/dashboard/skills/create/page.tsx` - 现有页面

  **Recommended Agent Profile**:
  - Category: `visual-engineering`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 3 (with T8)

- [ ] 8. 改造引导式创建页面 UI

  **What to do**:
  - techStack：多选改单选
  - category：数据源改为 VulnerabilityPattern API
  - 可能需要调整步骤布局

  **References**:
  - `src/app/dashboard/skills/create-wizard/page.tsx` - 现有页面
  - `src/app/dashboard/skills/create-wizard/IntentStep.tsx` - 第一步组件

  **Recommended Agent Profile**:
  - Category: `visual-engineering`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 3 (with T7)

---

### Wave 4: 存量数据迁移

- [ ] 9. 备份现有 Skill 数据

  **What to do**:
  - 导出所有 Skill 数据到 JSON 文件
  - 记录 techStack 和 category 的原始值
  - 生成备份报告

  **Backup Script**:
  ```javascript
  // scripts/backup-skills.js
  // 导出 data/skills-backup-{timestamp}.json
  // 包含所有 Skill 原始数据
  ```

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 4 (with T10)

- [ ] 10. 修改数据库表结构

  **What to do**:
  - 添加 Skill.vulnerabilityPatternId 字段
  - 创建 SkillAnalysis 表
  - 创建 SkillDuplicateGroup 和 SkillDuplicateGroupMember 表
  - 保留原有 category 字段（迁移完成后删除）
  - 运行 prisma migrate

  **Schema Changes**:
  ```prisma
  model Skill {
    // 新增字段
    vulnerabilityPatternId String?  // 替代 category
    vulnerabilityPattern   VulnerabilityPattern? @relation(...)
    
    // 保留原字段（迁移期间）
    category               String?  // 迁移后删除
  }
  ```

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 4 (with T9)

- [ ] 11. 编写迁移规则代码

  **What to do**:
  - 读取备份数据
  - 定义迁移规则：
    - techStack: JSON 数组 → 取第一个值作为语言 ID
    - category: 字符串 → 查找/创建 VulnerabilityPattern 对应记录
  - 处理特殊情况：
    - 无法匹配的 category → 创建新的 VulnerabilityPattern 或标记待人工处理
    - 空 techStack → 标记待人工处理
  - 生成迁移预览报告（不实际执行）

  **Migration Rules**:
  ```javascript
  // scripts/migrate-skills-rules.js
  
  // 规则 1: techStack 迁移
  function migrateTechStack(oldTechStack) {
    // JSON 数组 → 取第一个元素
    // 查找 TechStackOption 表中对应的 ID
    // 如果找不到，返回 null（待人工处理）
  }
  
  // 规则 2: category 迁移
  function migrateCategory(oldCategory, skillName, skillDescription) {
    // 查找 VulnerabilityPattern 表中匹配的记录
    // 匹配优先级：name > displayName > category 字段
    // 如果找不到：
    //   - 根据 skill 内容智能推断
    //   - 无法推断则创建新的 VulnerabilityPattern
  }
  
  // 规则 3: 生成迁移报告
  function generateMigrationReport(skills) {
    // 每条记录的迁移结果
    // 自动迁移数量
    // 需人工处理数量
    // 冲突详情
  }
  ```

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: NO（依赖 T9, T10）
  - Blocked By: T9, T10

- [ ] 12. 执行迁移 + 人工审核

  **What to do**:
  - 运行迁移脚本
  - 生成迁移报告：
    - 成功迁移数量
    - 无法自动迁移的记录列表
  - 提供人工审核界面/API
  - 等待人工确认处理无法迁移的记录

  **Execution Flow**:
  ```
  1. 运行迁移脚本（预览模式）
  2. 检查报告，确认规则正确
  3. 运行迁移脚本（执行模式）
  4. 验证迁移结果
  5. 人工处理失败记录
  6. 删除旧 category 字段
  ```

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: NO（依赖 T11）
  - Blocked By: T11

---

## Commit Strategy

每个 Wave 完成后提交：
- Wave 2: `feat(skills): add governance tables and backup legacy data`
- Wave 3: `feat(skills): implement governance logic and LLM analysis`
- Wave 4: `feat(skills): migrate legacy skills with LLM inference`
- Wave 5: `feat(skills): refactor API for single language and vulnerability pattern`
- Wave 6: `feat(skills): refactor creation pages and add governance UI`

---

## Success Criteria

### 验证命令

```bash
# 测试 VulnerabilityPattern API
curl http://localhost:3000/api/vulnerability-patterns

# 创建 Skill 测试
curl -X POST http://localhost:3000/api/skills -d '{"techStackId":"xxx","vulnerabilityPatternId":"yyy",...}'

# 检查存量数据迁移状态
sqlite3 prisma/dev.db "SELECT migrationStatus, COUNT(*) FROM Skill GROUP BY migrationStatus;"

# 检查治理分析结果
sqlite3 prisma/dev.db "SELECT reviewStatus, COUNT(*) FROM SkillAnalysis GROUP BY reviewStatus;"
```

### 最终 Checklist

- [ ] techStack 单选功能正常（前端 + API）
- [ ] vulnerabilityPatternId 正确存储和查询
- [ ] 存量数据 LLM 推断完成
- [ ] 人工审核完成（中低置信度记录）
- [ ] 重复组检测和审核流程正常
- [ ] 治理界面可用
- [ ] 创建后异步分析正常触发
curl -X POST http://localhost:3000/api/skills -d '{"techStack":"xxx","category":"yyy",...}'

# 检查存量数据
sqlite3 prisma/dev.db "SELECT techStack, category FROM Skill LIMIT 10;"
```

### 最终 Checklist

- [ ] techStack 单选功能正常
- [ ] category 数据来自 VulnerabilityPattern
- [ ] 存量数据迁移完成
- [ ] 无法迁移的记录已人工处理