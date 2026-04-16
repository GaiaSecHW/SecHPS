# Skills 治理系统实施计划

## TL;DR

> **快速摘要**: 为AI4WEB平台的Skills库构建治理系统，核心功能包括：创建时提示相似Skills、编排时实时预警（功能重复分析）、观测模块（管理员分析+合并决策）、评估启动时治理过滤、Skill合并执行。
>
> **交付物**:
> - 扩展 `/api/skills` POST（创建提示）
> - 扩展 `/api/skills/match` 和 `/api/skills/predict-tasks`（编排预警）
> - 新建 `/api/admin/skills-governance/*`（观测模块API）
> - 新建观测Dashboard `/dashboard/admin/skills-governance/`
> - 扩展 `copySkillsToProject()`（评估启动过滤）
> - 新建合并执行服务 `skill-merge.ts`
> - 新增数据模型：SkillObservationLog, SkillObservationStats, SkillNewImpactAnalysis, SkillMergeRecord
>
> **预计工作量**: Medium（约4周）
> **并行执行**: YES - 5 waves
> **关键路径**: 数据模型 → 预警服务 → 编排集成 → 观测Dashboard → 合并执行

---

## Context

### 原始需求
用户希望解决Skills库的两大问题：
1. Skills写得不准（触发错误、描述模糊）
2. Skills功能重复（导致重复分析、冗余报告）

### 讨论要点

**核心发现：Skills通过Workflow编排控制，不是评估启动时直接加载**

Skills的加载流程：
```
WorkflowNode (taskName + taskDescription)
  → SkillPredictionTask (异步预测)
  → /api/skills/match (LLM/关键词匹配)
  → SkillPrediction.matches (JSON结果)
  → copySkillsToProject() (技术栈过滤后拷贝)
  → 项目 .claude/skills/ 目录
```

**治理逻辑的关键时机**：
- 创建时：提示相似Skills（不阻止）
- 编排时：实时预警（核心场景）
- 观测模块：管理员分析高频重复 + 合并决策
- 评估启动：基于管理员决策自动过滤
- 合并执行：内容合并/替代/技术栈区分

**动态Skills库处理策略**：
- 编排预警每次实时计算，不依赖历史状态
- 观测模块记录历史，用于管理员分析趋势
- 新增Skill自动触发影响分析，标记需审核

### Metis Review

**已处理的Gaps**:

| Gap类型 | 问题 | 处理方式 |
|---------|------|----------|
| **已明确** | Q1: 集成点决策 | 创建提示 + 编排预警（两者都做）|
| **已明确** | Q3: 合并语义 | soft deprecation，保留版本链 |
| **已明确** | Q5: 绑定模式 | advisory-only，不强制阻断 |
| **AMBIGUOUS** | Q2: 相似度阈值 | 默认0.75，可配置 |
| **MINOR** | Q4: 决策存储 | AuditLog + 新的SkillMergeRecord |

**Guardrails**:
- 不阻止Skill创建（仅提示）
- 不阻断编排（仅预警）
- 不删除原Skills（soft deprecation）
- 跨用户合并需要同意

---

## Work Objectives

### 核心目标
构建Skills治理系统，帮助用户和管理员识别功能重复，优化Skills库质量。

### 具体交付物
- 创建时提示：扩展 `/api/skills` POST，返回相似Skills警告
- 编排时预警：扩展 `/api/skills/match` 和 `/api/skills/predict-tasks`，返回功能重复分析
- 观测模块API：新建 `/api/admin/skills-governance/*`
- 观测Dashboard：新建 `/dashboard/admin/skills-governance/`
- 评估启动过滤：扩展 `copySkillsToProject()` 应用治理决策
- 合并执行：新建 `skill-merge.ts` 服务和 `/api/skills/merge` API

### 完成定义
- [ ] 创建新Skill时能看到相似Skills提示
- [ ] 编排Workflow时能看到功能重复预警和处理建议
- [ ] 管理员能在观测Dashboard看到高频重复Skills统计
- [ ] 管理员能执行Skill合并操作
- [ ] 评估启动时能自动过滤已合并/deprecated的Skills
- [ ] 所有治理操作有审计日志记录

### 必须有
- 功能重复检测逻辑（三层：关键词 → 类别+CWE → 内容深度）
- 实时预警机制（编排时每次重新计算）
- 观测统计聚合（匹配率、重复率、选择率）
- 合并执行流程（版本管理、deprecated处理）
- 管理员Dashboard（高频重复排行、合并操作界面）

### 必须没有（Guardrails）
- 不能阻止Skill创建（仅提示）
- 不能阻断编排流程（仅预警，用户可选择忽略）
- 不能删除原Skills（使用soft deprecation）
- 不能强制合并（需要管理员审核）
- 不能自动合并（需要人工确认）

---

## Verification Strategy

### 测试决策
- **基础设施存在**: YES（Prisma + Jest/Vitest可选）
- **自动化测试**: Tests-after（实施后补充）
- **框架**: bun test 或 vitest
- **Agent-Executed QA**: ALWAYS（每个任务必须）

### QA政策
每个任务必须包含Agent-Executed QA Scenarios：
- 前端/UI：Playwright
- API/Backend：curl + 响应验证
- 服务层：bun test 或 手动验证

---

## Execution Strategy

### 并行执行波次

```
Wave 1 (基础：数据模型 + 核心服务 - 可立即开始):
├── Task 1: Prisma数据模型扩展 [quick]
├── Task 2: Skill相似度检测服务 [deep]
├── Task 3: 功能重复分析服务 [deep]
├── Task 4: 影响预测服务 [quick]
└── Task 5: 处理建议生成服务 [quick]

Wave 2 (预警集成 - 依赖Wave 1完成):
├── Task 6: 扩展/api/skills POST（创建提示）[quick]
├── Task 7: 扩展/api/skills/match（编排预警）[quick]
├── Task 8: 扩展/api/skills/predict-tasks（预警记录）[quick]
└── Task 9: 观测日志记录服务 [unspecified-high]

Wave 3 (观测模块 - 依赖Wave 1-2完成):
├── Task 10: 观测统计聚合服务 [deep]
├── Task 11: 观测API /api/admin/skills-governance/* [unspecified-high]
├── Task 12: 观测Dashboard总览页面 [visual-engineering]
├── Task 13: 高频重复排行页面 [visual-engineering]
└── Task 14: 新增Skill影响分析页面 [visual-engineering]

Wave 4 (合并执行 - 依赖Wave 1-3完成):
├── Task 15: Skill合并执行服务 [deep]
├── Task 16: 合并API /api/skills/merge [quick]
├── Task 17: 合并操作UI页面 [visual-engineering]
└── Task 18: 合并版本管理 [unspecified-high]

Wave 5 (评估集成 - 依赖Wave 1-4完成):
├── Task 19: 扩展copySkillsToProject（治理过滤）[quick]
├── Task 20: 治理过滤日志 [quick]
└── Task 21: 权限扩展 [quick]

Wave FINAL (验证 - 所有任务完成后):
├── Task F1: 计划合规审计 (oracle)
├── Task F2: 代码质量审查 (unspecified-high)
├── Task F3: 实际QA测试 (unspecified-high)
└── Task F4: Scope一致性检查 (deep)
→ 呈现结果 → 用户确认

关键路径: T1-T5 → T6-T9 → T10-T14 → T15-T18 → T19-T21 → F1-F4
并行加速: 约60%快于串行
最大并发: 5 (Wave 1)
```

---

## TODOs

### Wave 1: 数据模型 + 核心服务

- [x] 1. Prisma数据模型扩展

  **What to do**:
  - 在 prisma/schema.prisma 中添加新的数据模型
  - 运行 prisma migrate 生成迁移
  - 运行 prisma generate 更新客户端类型
  
  **新增模型**:
  ```
  SkillObservationLog - 观测日志（每次预警触发记录）
  SkillObservationStats - 观测统计（聚合分析）
  SkillNewImpactAnalysis - 新增Skill影响分析
  SkillMergeRecord - 合并记录（追溯）
  SkillGovernanceConfig - 治理配置（阈值设置）
  ```

  **Must NOT do**:
  - 不要修改现有Skill模型的字段结构
  - 不要删除现有模型
  - 不要改变现有索引

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-5)
  - **Blocks**: Tasks 6-9 (需要模型存在)
  - **Blocked By**: None

  **References**:
  - `prisma/schema.prisma:603-654` - Skill模型定义（参考字段风格）
  - `prisma/schema.prisma:700-727` - SkillEvolution模型（参考版本追踪模式）
  - `prisma/schema.prisma:200-251` - EvaluationSession模型（参考状态枚举）

  **QA Scenarios**:
  ```
  Scenario: 数据模型创建成功
    Tool: Bash
    Steps:
      1. 运行 prisma migrate dev --name add_governance_models
      2. 运行 prisma generate
      3. 验证迁移文件生成
    Expected Result: 迁移成功，无错误
    Evidence: .sisyphus/evidence/task-01-migration-success.txt

  Scenario: 模型类型可用
    Tool: Bash
    Steps:
      1. 在代码中导入新模型类型
      2. 验证类型定义存在
    Expected Result: TypeScript类型可用
    Evidence: .sisyphus/evidence/task-01-types-available.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(skills): add governance data models`
  - Files: prisma/schema.prisma, prisma/migrations/

---

- [x] 2. Skill相似度检测服务

  **What to do**:
  - 创建 src/services/skill-similarity.ts
  - 实现三层相似度检测：
    1. 关键词匹配（BM25风格）
    2. 类别+CWE匹配
    3. 内容深度分析（可选LLM）
  - 定义相似度阈值（默认0.75，可配置）

  **Must NOT do**:
  - 不要引入外部向量数据库（用SQLite+JSON）
  - 不要阻塞式调用LLM（可选，降级方案必须有）
  - 不要修改现有技能匹配逻辑

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3-5)
  - **Blocks**: Tasks 6-8 (需要相似度检测)
  - **Blocked By**: None

  **References**:
  - `src/app/api/skills/match/route.ts:405-490` - simpleKeywordMatch函数（参考关键词匹配）
  - `src/app/api/skills/match/route.ts:422-433` - categoryKeywords映射（参考类别关键词）
  - `prisma/schema.prisma:603-654` - Skill模型（techStack, category, cwe字段）

  **QA Scenarios**:
  ```
  Scenario: 关键词相似度检测
    Tool: Bash (bun test)
    Steps:
      1. 创建测试用例：两个相似Skills
      2. 调用 computeKeywordSimilarity(a, b)
      3. 验证返回相似度分数
    Expected Result: 相似度 > 0.5
    Evidence: .sisyphus/evidence/task-02-keyword-similarity.txt

  Scenario: 类别+CWE匹配
    Tool: Bash (bun test)
    Steps:
      1. 创建测试：相同category和CWE的Skills
      2. 调用 computeCategorySimilarity(a, b)
      3. 验证返回匹配结果
    Expected Result: overlapType = 'semantic-overlap'
    Evidence: .sisyphus/evidence/task-02-category-match.txt
  ```

  **Commit**: YES (groups with Wave 1)

---

- [x] 3. 功能重复分析服务

  **What to do**:
  - 创建 src/services/skill-overlap-analysis.ts
  - 实现重复组聚类逻辑
  - 实现重叠分析（sharedKeywords, uniquePoints）
  - 返回完整的 OverlapAnalysis 结构

  **Must NOT do**:
  - 不要对单个Skill进行全局扫描（只分析匹配到的Skills）
  - 不要保存"处理状态"（每次重新计算）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-2, 4-5)
  - **Blocks**: Tasks 7-8
  - **Blocked By**: Task 2 (需要相似度检测)

  **References**:
  - `src/app/api/skills/match/route.ts:105-124` - skillSummaries构建（参考数据结构）
  - `src/types/skills.ts` - Skill相关类型定义

  **QA Scenarios**:
  ```
  Scenario: 重复组聚类
    Tool: Bash (bun test)
    Steps:
      1. 输入3个SQL注入类Skills
      2. 调用 analyzeSkillOverlap(matches)
      3. 验证返回重复组
    Expected Result: 1个重复组，3个成员
    Evidence: .sisyphus/evidence/task-03-cluster-result.txt
  ```

  **Commit**: YES (groups with Wave 1)

---

- [x] 4. 影响预测服务

  **What to do**:
  - 创建 src/services/skill-impact-prediction.ts
  - 实现影响预测逻辑：
    - duplicateDetection判断
    - estimatedRedundantReports计算
    - estimatedTokenIncrease估算
    - overallSeverity计算

  **Must NOT do**:
  - 不要依赖实际执行数据（预测，不是统计）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 7-8
  - **Blocked By**: Task 3 (需要重复分析)

  **References**:
  - `prisma/schema.prisma:657-697` - SkillExecution模型（参考统计字段）

  **QA Scenarios**:
  ```
  Scenario: 影响预测计算
    Tool: Bash (bun test)
    Steps:
      1. 输入重复组（3个Skills）
      2. 调用 predictImpact(overlapGroup)
      3. 验证返回影响预测
    Expected Result: duplicateDetection=true, estimatedRedundantReports=4
    Evidence: .sisyphus/evidence/task-04-impact-prediction.txt
  ```

  **Commit**: YES (groups with Wave 1)

---

- [x] 5. 处理建议生成服务

  **What to do**:
  - 创建 src/services/skill-recommendations.ts
  - 实现建议生成逻辑：
    - merge建议（有覆盖关系）
    - techStack-split建议（技术栈可分）
    - keep-all建议（影响可控）
    - manual-review建议（复杂情况）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 7-8
  - **Blocked By**: Task 3, 4 (需要重复分析和影响预测)

  **References**:
  - `src/services/skill-files.ts:246-353` - 技术栈匹配逻辑（参考techStack-split建议）

  **QA Scenarios**:
  ```
  Scenario: 建议生成
    Tool: Bash (bun test)
    Steps:
      1. 输入重复组+影响预测
      2. 调用 generateRecommendations(overlapGroup, impact)
      3. 验证返回建议列表
    Expected Result: 至少1个建议，优先级排序正确
    Evidence: .sisyphus/evidence/task-05-recommendations.txt
  ```

  **Commit**: YES (groups with Wave 1)

---

### Wave 2: 预警集成

- [ ] 6. 扩展/api/skills POST（创建提示）

  **What to do**:
  - 修改 src/app/api/skills/route.ts POST handler
  - 在创建成功后调用相似度检测
  - 返回 governanceWarnings 字段（可选，非阻塞）

  **Must NOT do**:
  - 不要阻止Skill创建（仅提示）
  - 不要改变现有返回结构（添加新字段，不替换）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7-9)
  - **Blocks**: None
  - **Blocked By**: Wave 1 (Tasks 1-5)

  **References**:
  - `src/app/api/skills/route.ts:129-231` - POST handler（植入点）
  - `src/lib/api-auth.ts` - authenticateRequest（参考认证模式）

  **QA Scenarios**:
  ```
  Scenario: 创建时相似提示
    Tool: Bash (curl)
    Steps:
      1. POST /api/skills 创建新Skill
      2. 验证返回包含 governanceWarnings
    Expected Result: skill创建成功，warnings可选存在
    Evidence: .sisyphus/evidence/task-06-create-warning.txt
  ```

  **Commit**: YES (groups with Wave 2)

---

- [ ] 7. 扩展/api/skills/match（编排预警）

  **What to do**:
  - 修改 src/app/api/skills/match/route.ts POST handler
  - 在匹配成功后调用功能重复分析
  - 返回 governanceWarning 字段（完整的预警结构）

  **Must NOT do**:
  - 不要阻断编排流程
  - 不要改变现有matches返回结构

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: Wave 1, Task 2, 3, 4, 5

  **References**:
  - `src/app/api/skills/match/route.ts:34-204` - POST handler（植入点）
  - `src/app/api/skills/match/route.ts:195-199` - 返回结构（扩展点）

  **QA Scenarios**:
  ```
  Scenario: 编排时预警返回
    Tool: Bash (curl)
    Steps:
      1. POST /api/skills/match 匹配Skills
      2. 验证返回包含 governanceWarning
    Expected Result: matches + governanceWarning 同时返回
    Evidence: .sisyphus/evidence/task-07-match-warning.txt
  ```

  **Commit**: YES (groups with Wave 2)

---

- [ ] 8. 扩展/api/skills/predict-tasks（预警记录）

  **What to do**:
  - 查找 predict-tasks API 或创建
  - 扩展返回 governanceWarning
  - 触发观测日志记录

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 9
  - **Blocked By**: Wave 1

  **References**:
  - `src/app/api/skills/predict/route.ts` - 参考predict API

  **QA Scenarios**:
  ```
  Scenario: 预测任务预警
    Tool: Bash (curl)
    Steps:
      1. POST /api/skills/predict-tasks
      2. 验证预警记录
    Expected Result: governanceWarning + 观测日志记录
    Evidence: .sisyphus/evidence/task-08-predict-warning.txt
  ```

  **Commit**: YES (groups with Wave 2)

---

- [ ] 9. 观测日志记录服务

  **What to do**:
  - 创建 src/services/skill-observation-log.ts
  - 实现观测日志写入逻辑
  - 实现观测统计更新逻辑

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 10
  - **Blocked By**: Task 1 (需要模型), Task 8 (触发点)

  **References**:
  - `src/lib/audit/logger.ts` - AuditLogger（参考日志模式）
  - `prisma/schema.prisma` - SkillObservationLog模型

  **QA Scenarios**:
  ```
  Scenario: 观测日志记录
    Tool: Bash (bun test)
    Steps:
      1. 模拟预警触发
      2. 调用 logObservation(matches, warning)
      3. 验证数据库记录
    Expected Result: SkillObservationLog记录存在
    Evidence: .sisyphus/evidence/task-09-observation-log.txt
  ```

  **Commit**: YES (groups with Wave 2)

---

### Wave 3: 观测模块

- [ ] 10. 观测统计聚合服务

  **What to do**:
  - 创建 src/services/skill-observation-stats.ts
  - 实现统计聚合：
    - matchCount, overlapCount
    - selectedRate, rejectedRate
    - frequentOverlapWith
    - trend计算

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11-14)
  - **Blocks**: Task 11
  - **Blocked By**: Task 9 (需要日志数据)

  **References**:
  - `prisma/schema.prisma` - SkillObservationStats模型

  **QA Scenarios**:
  ```
  Scenario: 统计聚合计算
    Tool: Bash (bun test)
    Steps:
      1. 创建多条观测日志
      2. 调用 aggregateObservationStats(skillId)
      3. 验证返回统计
    Expected Result: matchCount, overlapCount等字段存在
    Evidence: .sisyphus/evidence/task-10-stats-aggregation.txt
  ```

  **Commit**: YES (groups with Wave 3)

---

- [ ] 11. 观测API /api/admin/skills-governance/*

  **What to do**:
  - 创建 src/app/api/admin/skills-governance/route.ts
  - 创建子路由：
    - /stats - 统计总览
    - /high-frequency - 高频重复排行
    - /new-impact - 新增Skill影响
    - /merge-candidates - 合并候选

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 12-14
  - **Blocked By**: Task 10

  **References**:
  - `src/app/api/admin/audit-logs/route.ts` - 参考admin API模式
  - `src/types/permissions.ts` - 参考权限定义

  **QA Scenarios**:
  ```
  Scenario: 观测统计API
    Tool: Bash (curl)
    Steps:
      1. GET /api/admin/skills-governance/stats
      2. 验证返回结构
    Expected Result: {highFrequencyDuplicates, mergeCandidates, ...}
    Evidence: .sisyphus/evidence/task-11-governance-api.txt
  ```

  **Commit**: YES (groups with Wave 3)

---

- [ ] 12. 观测Dashboard总览页面

  **What to do**:
  - 创建 src/app/dashboard/admin/skills-governance/page.tsx
  - 实现总览卡片（Skills总数、预警记录、高频重复、待处理）
  - 实现Tab切换（高频重复、重复组、新增影响、趋势）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: ['/frontend-ui-ux']

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Task 11

  **References**:
  - `src/app/dashboard/admin/tools/page.tsx` - 参考admin dashboard布局
  - `src/app/dashboard/skills/page.tsx:1-200` - 参考Skills列表页面样式

  **QA Scenarios**:
  ```
  Scenario: Dashboard页面渲染
    Tool: Playwright
    Steps:
      1. 打开 /dashboard/admin/skills-governance
      2. 验证总览卡片显示
      3. 验证Tab切换功能
    Expected Result: 页面正常渲染，数据展示
    Evidence: .sisyphus/evidence/task-12-dashboard-screenshot.png
  ```

  **Commit**: YES (groups with Wave 3)

---

- [ ] 13. 高频重复排行页面

  **What to do**:
  - 创建排行表格组件
  - 显示：排名、Skill名称、重复次数、选择率、决策状态
  - 实现批量操作按钮

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: ['/frontend-ui-ux']

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Task 11, 12

  **QA Scenarios**:
  ```
  Scenario: 排行表格显示
    Tool: Playwright
    Steps:
      1. 打开Dashboard，切换到高频重复Tab
      2. 验证表格数据
    Expected Result: 排行数据正确显示
    Evidence: .sisyphus/evidence/task-13-ranking-table.png
  ```

  **Commit**: YES (groups with Wave 3)

---

- [ ] 14. 新增Skill影响分析页面

  **What to do**:
  - 创建新增影响列表组件
  - 显示：Skill名称、相似度、相似对象、审核状态
  - 实现审核操作按钮

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: ['/frontend-ui-ux']

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Task 11, 12

  **QA Scenarios**:
  ```
  Scenario: 新增影响显示
    Tool: Playwright
    Steps:
      1. 打开Dashboard，切换到新增影响Tab
      2. 验证新增Skills列表
    Expected Result: 新增影响分析正确显示
    Evidence: .sisyphus/evidence/task-14-new-impact.png
  ```

  **Commit**: YES (groups with Wave 3)

---

### Wave 4: 合并执行

- [ ] 15. Skill合并执行服务

  **What to do**:
  - 创建 src/services/skill-merge.ts
  - 实现三种合并策略：
    1. content-merge: 内容合并
    2. replace: 替代合并
    3. techStack-split: 技术栈区分
  - 实现版本管理逻辑
  - 实现soft deprecation逻辑

  **Must NOT do**:
  - 不要删除原Skills（soft deprecation）
  - 不要破坏版本链（保留parentId引用）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16-18)
  - **Blocks**: Task 19
  - **Blocked By**: Wave 1-3

  **References**:
  - `src/services/skills.ts:105-150` - createSkill（参考创建逻辑）
  - `prisma/schema.prisma:603-654` - Skill模型（version, parentId字段）
  - `src/services/skill-files.ts:129-201` - saveSkillToDisk（参考磁盘写入）

  **QA Scenarios**:
  ```
  Scenario: 内容合并执行
    Tool: Bash (bun test)
    Steps:
      1. 准备target + sources Skills
      2. 调用 mergeSkills(target, sources, 'content-merge')
      3. 验证合并结果
    Expected Result: 新Skill创建，原Skills deprecated
    Evidence: .sisyphus/evidence/task-15-merge-execution.txt
  ```

  **Commit**: YES (groups with Wave 4)

---

- [ ] 16. 合并API /api/skills/merge

  **What to do**:
  - 创建 src/app/api/skills/merge/route.ts
  - POST handler: 执行合并操作
  - GET handler: 获取合并候选
  - 权限检查: SKILL_MERGE

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 17
  - **Blocked By**: Task 15

  **QA Scenarios**:
  ```
  Scenario: 合并API调用
    Tool: Bash (curl)
    Steps:
      1. POST /api/skills/merge
      2. 验证返回合并结果
    Expected Result: mergedSkill + deprecatedSkills
    Evidence: .sisyphus/evidence/task-16-merge-api.txt
  ```

  **Commit**: YES (groups with Wave 4)

---

- [ ] 17. 合并操作UI页面

  **What to do**:
  - 创建 src/app/dashboard/admin/skills-governance/merge/page.tsx
  - 实现策略选择组件
  - 实现目标/来源选择组件
  - 实现预览组件
  - 实现执行按钮

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: ['/frontend-ui-ux']

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: Task 16

  **QA Scenarios**:
  ```
  Scenario: 合并UI操作
    Tool: Playwright
    Steps:
      1. 打开合并页面
      2. 选择策略、目标、来源
      3. 验证预览显示
      4. 点击执行合并
    Expected Result: 合并成功提示
    Evidence: .sisyphus/evidence/task-17-merge-ui.png
  ```

  **Commit**: YES (groups with Wave 4)

---

- [ ] 18. 合并版本管理

  **What to do**:
  - 确保合并后版本链正确
  - 创建SkillMergeRecord记录
  - 更新观测统计

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: Task 15

  **QA Scenarios**:
  ```
  Scenario: 版本链验证
    Tool: Bash (bun test)
    Steps:
      1. 合并后查询Skills
      2. 验证parentId链
      3. 验证isLatest标记
    Expected Result: 版本链正确，deprecated Skills isLatest=false
    Evidence: .sisyphus/evidence/task-18-version-chain.txt
  ```

  **Commit**: YES (groups with Wave 4)

---

### Wave 5: 评估集成

- [ ] 19. 扩展copySkillsToProject（治理过滤）

  **What to do**:
  - 修改 src/services/skill-files.ts copySkillsToProject()
  - 在技术栈过滤后添加治理过滤
  - 应用管理员决策（merge-target, delete等）
  - 过滤deprecated Skills

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 20-21)
  - **Blocks**: None
  - **Blocked By**: Wave 1-4

  **References**:
  - `src/services/skill-files.ts:250-409` - copySkillsToProject（植入点）
  - `src/services/skill-files.ts:327-353` - 技术栈过滤（参考过滤逻辑）

  **QA Scenarios**:
  ```
  Scenario: 治理过滤生效
    Tool: Bash (curl)
    Steps:
      1. 启动评估（POST /api/projects/[id]/start）
      2. 验证拷贝的Skills
      3. 检查deprecated Skills是否被过滤
    Expected Result: deprecated Skills不拷贝
    Evidence: .sisyphus/evidence/task-19-governance-filter.txt
  ```

  **Commit**: YES (groups with Wave 5)

---

- [ ] 20. 治理过滤日志

  **What to do**:
  - 创建 src/services/skill-governance-log.ts
  - 记录过滤原因（合并入、deprecated等）
  - 关联到评估记录

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: Task 19

  **QA Scenarios**:
  ```
  Scenario: 过滤日志记录
    Tool: Bash (bun test)
    Steps:
      1. 模拟评估启动过滤
      2. 验证日志记录
    Expected Result: 过滤日志包含reason
    Evidence: .sisyphus/evidence/task-20-filter-log.txt
  ```

  **Commit**: YES (groups with Wave 5)

---

- [ ] 21. 权限扩展

  **What to do**:
  - 在 src/types/permissions.ts 添加新权限：
    - SKILL_GOVERNANCE_READ
    - SKILL_GOVERNANCE_UPDATE
    - SKILL_MERGE
    - SKILL_APPROVE
  - 在权限系统中注册新权限

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/types/permissions.ts` - 现有权限定义
  - `prisma/schema.prisma` - Permission模型

  **QA Scenarios**:
  ```
  Scenario: 权限定义可用
    Tool: Bash
    Steps:
      1. 导入新权限常量
      2. 验证类型存在
    Expected Result: PERMISSIONS.SKILL_MERGE存在
    Evidence: .sisyphus/evidence/task-21-permissions.txt
  ```

  **Commit**: YES (groups with Wave 5)

---

## Final Verification Wave

### F1. 计划合规审计 — oracle
读取计划全文。验证每个"必须有"是否有实施存在。验证每个"必须没有"是否在代码库中未找到。检查证据文件。对比交付物与计划。

### F2. 代码质量审查 — unspecified-high
运行 tsc --noEmit + linter + bun test。审查变更文件。检查AI slop模式。

### F3. 实际QA测试 — unspecified-high
从干净状态开始。执行每个任务的QA场景。测试跨任务集成。

### F4. Scope一致性检查 — deep
对比任务描述与实际diff。验证没有超出scope的改动。

---

## Commit Strategy

按功能模块分组提交：
- Wave 1: `feat(skills): add governance data models and core services`
- Wave 2: `feat(skills): add creation and orchestration governance warnings`
- Wave 3: `feat(skills): add observation module API and dashboard`
- Wave 4: `feat(skills): add merge execution service and UI`
- Wave 5: `feat(skills): add governance filter for evaluation startup`

---

## Success Criteria

### 验证命令
```bash
# 创建时提示测试
curl -X POST /api/skills -d '{"name":"test-skill","description":"测试"}'
# Expected: {"skill":{...},"governanceWarnings":[...]}

# 编排预警测试
curl -X POST /api/skills/match -d '{"taskName":"SQL注入检测"}'
# Expected: {"matches":[...],"governanceWarning":{...}}

# 观测Dashboard测试
curl -X GET /api/admin/skills-governance/stats
# Expected: {"highFrequencyDuplicates":[...]}
```

### 最终检查清单
- [ ] 所有"必须有"已存在
- [ ] 所有"必须没有"未出现
- [ ] 所有API返回正确格式
- [ ] Dashboard可正常访问
- [ ] 合并操作可执行