# Skill 进化功能开发计划

## TL;DR

> **Quick Summary**: 开发 Skill 自进化功能，基于本平台执行数据（SkillExecution + Vulnerability），同时分析误报和正确发现案例，LLM 生成平衡改进建议，追踪新版本效果，实现精准率和召回率的平衡提升。
>
> **Deliverables**:
> - 精准率/召回率计算服务
> - 案例提取服务（误报 + 正确发现）
> - LLM 平衡改进建议服务
> - 定时任务调度
> - 版本效果追踪
> - 前端管理界面
>
> **Estimated Effort**: Medium (2-4 weeks)
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Wave 1 → Wave 2 → Wave 3 → Wave 4

---

## Context

### 核心澄清

**❌ 错误理解（之前）**：
- 数据源：`~/.claude/projects/*.jsonl`（外部 Claude Code 日志）
- 只分析误报
- 这是 AutonomousEvolution 的模式

**✅ 正确理解（现在）**：
- 数据源：本平台 `SkillExecution` + `Vulnerability`
- 同时分析误报和正确发现
- 平衡精准率和召回率

### ⚠️ 关键问题：平衡精准率和召回率

如果只分析误报来优化 Skill：
- 过度放宽规则以减少误报
- 导致原本能发现的真漏洞也发现不了
- 精准率提高，但召回率下降

**解决方案**：同时分析两类数据
1. **误报案例（false_positive）**：要避免的
2. **正确发现案例（confirmed）**：要保留的

### 数据源确认

```
SkillExecution (执行记录)
├── findingsCount      = 发现漏洞总数
├── confirmedCount     = 确认是真漏洞的数量
├── falsePositiveCount = 标记为误报的数量
└── 精准率 = confirmedCount / findingsCount

Vulnerability (漏洞详情)
├── status = 'false_positive' → 误报案例（要避免）
├── status = 'confirmed'      → 正确发现（要保留）
├── title, description        → 内容
└── filePath, codeSnippet     → 位置
```

### 用户决策

| 决策项 | 选择 |
|--------|------|
| 进化目标 | 提高精准率（减少误报），同时保持召回率 |
| 触发机制 | 定时自动分析 |
| 进化方式 | LLM 分析误报+正确发现，平衡改进 |
| 验证方式 | 新版本效果对比 |

---

## Work Objectives

### Core Objective
构建 Skill 进化闭环：执行 → 标记 → 分析（误报+正确发现）→ 平衡改进 → 追踪效果

### Concrete Deliverables

**后端服务**:
- `src/services/skill-evolution/metrics-calculator.ts` - 精准率/召回率计算
- `src/services/skill-evolution/case-extractor.ts` - 提取误报和正确发现案例
- `src/services/skill-evolution/balance-analyzer.ts` - LLM 平衡分析
- `src/services/skill-evolution/evolution-scheduler.ts` - 定时任务

**API 端点**:
- `GET /api/skills/[id]/metrics` - Skill 效果指标
- `GET /api/skills/[id]/cases` - 误报+正确发现案例
- `POST /api/skills/[id]/analyze` - 分析并生成改进建议
- `POST /api/skills/[id]/evolve` - 应用改进建议
- `GET /api/skills/evolution/tasks` - 进化任务列表

**前端页面**:
- Skill 效果指标展示
- 案例分析页面
- 进化建议查看
- 版本效果对比

### Definition of Done
- [ ] 可以计算每个 Skill 的精准率和召回率
- [ ] 可以提取 Skill 的误报案例和正确发现案例
- [ ] LLM 可以同时分析两类案例，生成平衡改进建议
- [ ] 可以基于建议创建 Skill 新版本
- [ ] 新版本执行后可以对比效果
- [ ] 定时任务可以自动扫描并触发进化

### Must Have
- 精准率/召回率计算
- 误报案例提取
- 正确发现案例提取
- LLM 平衡改进建议
- 版本效果追踪

### Must NOT Have (Guardrails)
- ❌ 使用外部日志数据
- ❌ 只分析误报（必须同时分析正确发现）
- ❌ 自动应用改进（需要人工确认）
- ❌ 多 Skill 协同进化

---

## Verification Strategy

### QA Policy
Every task MUST include agent-executed QA scenarios.
- **Frontend/UI**: Use Playwright
- **API/Backend**: Use Bash (curl)
- **Services**: Use Bash (bun/node)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - 数据服务):
├── Task 1: 精准率/召回率计算服务 [quick]
├── Task 2: 案例提取服务（误报+正确发现）[quick]
├── Task 3: 数据模型扩展 [quick]
└── Task 4: API 骨架 [quick]

Wave 2 (Core Logic - LLM 分析):
├── Task 5: LLM 平衡分析服务 [deep]
├── Task 6: 改进建议生成 [deep]
├── Task 7: 版本创建集成 [quick]
└── Task 8: 效果对比计算 [quick]

Wave 3 (Scheduling - 定时任务):
├── Task 9: 定时任务调度器 [unspecified-high]
├── Task 10: 进化任务管理 [unspecified-high]
└── Task 11: 触发条件配置 [quick]

Wave 4 (Frontend - 管理界面):
├── Task 12: 效果指标展示页面 [visual-engineering]
├── Task 13: 案例分析页面 [visual-engineering]
├── Task 14: 进化建议查看页面 [visual-engineering]
└── Task 15: 版本效果对比页面 [visual-engineering]
```

### Critical Path
Task 1 → Task 2 → Task 5 → Task 6 → Task 9 → Task 12

---

## TODOs

### Wave 1: Foundation (数据服务)

- [x] 1. **精准率/召回率计算服务** - metrics-calculator.ts

  **What to do**:
  - 创建 `src/services/skill-evolution/metrics-calculator.ts`
  - 实现精准率、召回率计算
  - 支持按时间范围统计

  **接口设计**:
  ```typescript
  interface SkillMetrics {
    skillId: string;
    totalExecutions: number;
    totalFindings: number;
    confirmedCount: number;
    falsePositiveCount: number;
    pendingCount: number;
    precision: number;        // 精准率 = confirmed / (confirmed + falsePositive)
    recall: number;           // 召回率（需要外部验证数据）
    falsePositiveRate: number;
  }

  export async function calculateSkillMetrics(
    skillId: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<SkillMetrics>

  export async function getLowPrecisionSkills(
    threshold: number
  ): Promise<SkillMetrics[]>
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 5, 9
  - **Blocked By**: None

  **References**:
  - `prisma/schema.prisma:859-891` - SkillExecution 模型
  - `prisma/schema.prisma:786-838` - Skill 模型

  **QA Scenarios**:
  ```
  Scenario: 精准率计算测试
    Tool: Bash (curl)
    Steps:
      1. curl -X GET "http://localhost:3000/api/skills/{skill-id}/metrics" \
         -H "Authorization: Bearer {token}"
      2. 验证 precision = confirmedCount / (confirmedCount + falsePositiveCount)
    Expected Result: 计算结果正确
    Evidence: .sisyphus/evidence/task-1-metrics.json
  ```

---

- [x] 2. **案例提取服务** - case-extractor.ts

  **What to do**:
  - 创建 `src/services/skill-evolution/case-extractor.ts`
  - 查询两类数据：
    - `Vulnerability` 中 `status = 'false_positive'`（误报）
    - `Vulnerability` 中 `status = 'confirmed'`（正确发现）
  - ⚠️ 必须同时获取两类数据，用于平衡优化
  - ⚠️ 精简案例内容，避免超出 LLM 上下文限制

  **案例精简策略**（业界实践：Selective Retrieval + Context Compression）:
  ```
  当前方案：最近 N 个（简单有效）
  ├── 按时间倒序取最近的 N 个误报（默认 10）
  ├── 按时间倒序取最近的 M 个正确发现（默认 10）
  └── 理由：最近的案例最能反映当前问题

  将来扩展：RAG 相似度检索（数据量大时）
  ├── 用 Skill 内容作为查询向量
  ├── 在向量数据库中搜索相似案例
  └── 返回最相关的 Top-K 案例

  单个案例保留内容：
  ├── title: 完整保留 (~50-100 字符)
  ├── description: 截断到 200 字符
  ├── filePath: 完整保留 (~50 字符)
  ├── codeSnippet: 只保留关键行（前后各 3 行）
  └── 不取: details, aiAnalysis 等大字段

  Token 预算：
  ├── 10 误报案例 × ~300 tokens = ~3000 tokens
  ├── 10 正确发现 × ~300 tokens = ~3000 tokens
  ├── Skill 内容 = ~2000 tokens
  ├── Prompt 模板 = ~500 tokens
  └── 总计 ~8500 tokens (远小于 128K 上下文)
  ```

  **接口设计**:
  ```typescript
  // 精简案例格式
  interface CompactCase {
    vulnerabilityId: string;
    title: string;                    // 完整保留
    description: string;              // 截断到 200 字符
    filePath?: string;                // 完整保留
    codeSnippetPreview?: string;      // 只保留关键行
    status: 'false_positive' | 'confirmed';
    markedAt: Date;
  }

  // 获取精简案例（用于 LLM 分析）
  export async function getCompactCases(
    skillId: string,
    options?: {
      falsePositiveLimit?: number;    // 默认 10
      confirmedLimit?: number;        // 默认 10
      maxDescriptionLength?: number;  // 默认 200
      codeSnippetLines?: number;      // 默认 6 (前后各 3 行)
    }
  ): Promise<{
    falsePositives: CompactCase[];
    confirmedCases: CompactCase[];
    totalFalsePositives: number;      // 总数（用于 UI 显示）
    totalConfirmed: number;
  }>

  // 获取完整案例（用于 UI 详情展示）
  export async function getFullCase(
    vulnerabilityId: string
  ): Promise<Vulnerability>
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `prisma/schema.prisma:1224-1264` - Vulnerability 模型
  - `prisma/schema.prisma:859-891` - SkillExecution 模型

  **QA Scenarios**:
  ```
  Scenario: 案例提取测试
    Tool: Bash (curl)
    Steps:
      1. curl -X GET "http://localhost:3000/api/skills/{skill-id}/cases" \
         -H "Authorization: Bearer {token}"
      2. 验证返回 falsePositives 和 confirmedCases 两类数据
      3. 验证 description 长度 <= 200
      4. 验证 codeSnippetPreview 行数 <= 6
    Expected Result: 两类数据都存在，内容已精简
    Evidence: .sisyphus/evidence/task-2-cases.json
  ```

---

- [x] 3. **数据模型扩展** - SkillEvolutionTask + SkillImprovement + SkillEvolutionConfig

  **What to do**:
  - 在 `prisma/schema.prisma` 添加新模型
  - 运行 `npx prisma db push`

  **模型设计**:
  ```prisma
  // 进化配置表（新建）
  model SkillEvolutionConfig {
    id                    String   @id @default("default")
    
    // 触发条件
    precisionThreshold    Float    @default(0.7)    // 精准率阈值
    minFalsePositives     Int      @default(5)      // 最少误报数
    minConfirmed          Int      @default(3)      // 最少正确发现数
    
    // 案例数量
    falsePositiveLimit    Int      @default(10)     // 误报案例数
    confirmedLimit        Int      @default(10)     // 正确发现数
    
    // 调度设置
    scheduleCron          String   @default("0 3 * * *")  // 定时任务
    maxDailyTasks         Int      @default(10)     // 每日最大任务数
    
    // 内容精简
    maxDescriptionLength  Int      @default(200)    // 描述最大长度
    codeSnippetLines      Int      @default(6)      // 代码片段行数
    
    isActive              Boolean  @default(true)
    updatedAt             DateTime @updatedAt
  }

  // 进化任务表
  model SkillEvolutionTask {
    id                String    @id
    skillId           String
    triggerReason     String    // "low_precision" | "high_false_positive" | "manual"
    falsePositiveCount Int
    confirmedCount    Int
    precisionBefore   Float
    status            String    @default("pending")
    analysisResult    String?
    improvementId     String?
    newVersionId      String?
    precisionAfter    Float?
    recallAfter       Float?
    createdAt         DateTime  @default(now())
    completedAt       DateTime?
    Skill             Skill     @relation(fields: [skillId], references: [id])
  }

  // 改进建议表
  model SkillImprovement {
    id                String    @id
    skillId           String
    taskId            String?
    falsePositiveCases String   // JSON
    confirmedCases    String    // JSON
    analysis          String    // LLM 分析
    suggestions       String    // JSON
    improvedContent   String?
    status            String    @default("pending")
    createdAt         DateTime  @default(now())
    Skill             Skill     @relation(fields: [skillId], references: [id])
  }
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 5, 6, 9
  - **Blocked By**: None

---

- [x] 4. **API 骨架** - 效果指标相关路由

  **What to do**:
  - 创建 `src/app/api/skills/[id]/metrics/route.ts`
  - 创建 `src/app/api/skills/[id]/cases/route.ts`
  - 创建 `src/app/api/skills/[id]/analyze/route.ts`
  - 创建 `src/app/api/skills/[id]/evolve/route.ts`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 12, 13
  - **Blocked By**: None

---

### Wave 2: Core Logic (LLM 分析)

- [x] 5. **LLM 平衡分析服务** - balance-analyzer.ts

  **What to do**:
  - 创建 `src/services/skill-evolution/balance-analyzer.ts`
  - 调用 LLM 同时分析误报和正确发现
  - 返回平衡改进建议

  **接口设计**:
  ```typescript
  interface BalanceAnalysisResult {
    // 误报分析
    falsePositivePatterns: string[];
    falsePositiveCauses: string[];
    
    // 正确发现分析
    confirmedPatterns: string[];
    confirmedStrengths: string[];  // 必须保留的规则
    
    // 平衡建议
    recommendations: Array<{
      type: 'add_rule' | 'modify_rule' | 'add_exception' | 'refine_pattern';
      description: string;
      impact: 'reduce_false_positive' | 'maintain_detection' | 'both';
    }>;
    
    // 警告
    warnings: string[];  // 如"此改进可能影响召回率"
  }

  export async function analyzeBalance(
    skillContent: string,
    falsePositives: FalsePositiveCase[],
    confirmedCases: ConfirmedCase[]
  ): Promise<BalanceAnalysisResult>
  ```

  **Prompt 设计**:
  ```markdown
  你是一个安全检测专家，请分析以下案例：

  ## Skill 定义
  {skillContent}

  ## 误报案例（要避免的）
  {falsePositives}
  → 这些被误判为漏洞，实际上不是

  ## 正确发现案例（要保留的）
  {confirmedCases}
  → 这些是真正的漏洞，必须能继续发现

  请分析：
  1. 误报的共同特点是什么？为什么误判？
  2. 正确发现的共同特点是什么？Skill 哪些规则是正确的？
  3. 如何改进 Skill，既能减少误报，又不影响正确发现？
  4. 有哪些改进可能影响召回率？需要特别注意什么？
  ```

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 核心 LLM 交互，需要设计平衡分析的 prompt
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 6
  - **Blocked By**: Tasks 1, 2, 3

  **References**:
  - `src/lib/model-client.ts` - LLM 调用
  - `src/services/skill-governance.ts` - LLM 分析模式参考

  **QA Scenarios**:
  ```
  Scenario: 平衡分析测试
    Tool: Bash (curl)
    Steps:
      1. curl -X POST "http://localhost:3000/api/skills/{skill-id}/analyze" \
         -H "Authorization: Bearer {token}"
      2. 验证返回 falsePositivePatterns 和 confirmedPatterns
      3. 验证 recommendations 包含平衡建议
    Expected Result: 分析结果包含两类分析和平衡建议
    Evidence: .sisyphus/evidence/task-5-analysis.json
  ```

---

- [x] 6. **改进建议生成** - improvement-generator.ts

  **What to do**:
  - 创建 `src/services/skill-evolution/improvement-generator.ts`
  - 基于平衡分析结果生成改进后的 Skill 内容
  - 保存到 SkillImprovement 表

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 3, 5

---

- [x] 7. **版本创建集成** - 调用现有版本管理

  **What to do**:
  - 实现基于改进建议创建 Skill 新版本
  - 调用现有的版本管理逻辑
  - 记录到 SkillEvolution 表

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 9
  - **Blocked By**: Task 6

  **References**:
  - `src/app/api/skills/[id]/route.ts:136-212` - 版本创建逻辑

---

- [x] 8. **效果对比计算** - 新旧版本指标对比

  **What to do**:
  - 实现新旧版本效果对比
  - 计算精准率和召回率变化
  - 判断进化是否成功

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

---

### Wave 3: Scheduling (定时任务)

- [x] 9. **定时任务调度器** - evolution-scheduler.ts

  **What to do**:
  - 创建 `src/services/skill-evolution/evolution-scheduler.ts`
  - 定时扫描所有 Skill 的精准率
  - 对低精准率 Skill 创建进化任务

  **配置**:
  ```typescript
  export const EVOLUTION_CONFIG = {
    SCHEDULE_CRON: '0 3 * * *',
    PRECISION_THRESHOLD: 0.7,
    MIN_FALSE_POSITIVES: 5,
    MIN_CONFIRMED: 3,          // 新增：最少正确发现数才分析
    MAX_DAILY_TASKS: 10,
  };
  ```

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 1, 7

---

- [x] 10. **进化任务管理** - 任务队列、状态追踪

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

---

- [x] 11. **触发条件配置** - 阈值设置

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

---

### Wave 4: Frontend (管理界面)

- [ ] 12. **Skill 进化管理首页**

  **What to do**:
  - 创建 Skill 进化管理页面（嵌入 Skill 管理页面）
  - 显示全局效果概览（总 Skills、平均精准率、进化次数）
  - 显示进化配置区域（可编辑）
  - 显示待进化 Skills 列表
  - 显示进化任务历史

  **交互需求**:
  ```
  1. 点击"误报数" → 跳转到该 Skill 的漏洞列表（筛选 status='false_positive'）
  2. 点击"正确发现数" → 跳转到该 Skill 的漏洞列表（筛选 status='confirmed'）
  3. 点击"分析" → 进入进化分析页面
  4. 点击"详情" → 查看 Skill 详情
  ```

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

---

- [ ] 13. **漏洞列表页面**

  **What to do**:
  - 创建漏洞列表页面（支持按 Skill 和状态筛选）
  - 支持筛选：全部 / 误报 / 正确发现 / 未确认
  - 显示漏洞标题、文件位置、时间
  - 支持点击查看详情

  **路由设计**:
  ```
  /vulnerabilities?skillId={id}&status=false_positive
  /vulnerabilities?skillId={id}&status=confirmed
  ```

  **交互需求**:
  ```
  1. 从 Skill 进化页面点击"误报数"跳转
  2. 点击某条漏洞 → 跳转到漏洞明细页
  ```

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

---

- [ ] 14. **漏洞明细页面**

  **What to do**:
  - 创建漏洞明细页面
  - 显示：基本信息、位置、代码片段、描述、AI 分析、标记历史
  - 代码片段高亮显示（标记相关行）

  **显示内容**:
  ```
  - 基本信息: 标题、状态、严重程度、CWE
  - 位置: 文件路径、行号、代码片段（高亮）
  - 描述: 详细描述、Skill 误判原因
  - AI 分析: LLM 分析内容（如有）
  - 标记历史: 谁在什么时候标记的
  ```

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

---

- [ ] 15. **进化分析页面**

  **What to do**:
  - 创建进化分析页面
  - 显示：当前效果、误报案例列表、正确发现案例列表
  - 显示 LLM 分析结果
  - 显示改进后的 Skill 内容预览（diff）
  - 支持应用/拒绝改进建议

  **交互需求**:
  ```
  1. 查看误报案例详情 → 跳转漏洞明细页
  2. 查看正确发现详情 → 跳转漏洞明细页
  3. 应用改进 → 创建新版本 Skill
  4. 拒绝改进 → 记录拒绝原因
  ```

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

---

- [ ] 16. **版本效果对比页面**

  **What to do**:
  - 创建版本效果对比页面
  - 显示新旧版本精准率对比
  - 显示趋势图表
  - 支持回滚操作

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
- [ ] F2. **Code Quality Review** — `unspecified-high`
- [ ] F3. **Real Manual QA** — `unspecified-high`
- [ ] F4. **Scope Fidelity Check** — `deep`

---

## Success Criteria

### Verification Commands

```bash
# 1. 精准率计算测试
curl -X GET "http://localhost:3000/api/skills/{skill-id}/metrics" \
  -H "Authorization: Bearer {token}"
# Expected: { precision: 0.85, falsePositiveRate: 0.15, ... }

# 2. 案例获取测试（两类数据）
curl -X GET "http://localhost:3000/api/skills/{skill-id}/cases" \
  -H "Authorization: Bearer {token}"
# Expected: { falsePositives: [...], confirmedCases: [...] }

# 3. 平衡分析测试
curl -X POST "http://localhost:3000/api/skills/{skill-id}/analyze" \
  -H "Authorization: Bearer {token}"
# Expected: { falsePositivePatterns: [...], confirmedPatterns: [...], recommendations: [...] }

# 4. 进化任务测试
curl -X POST "http://localhost:3000/api/skills/{skill-id}/evolve" \
  -H "Authorization: Bearer {token}" \
  -d '{"improvementId": "imp-xxx"}'
# Expected: { newVersion: 2, status: "completed" }
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] 同时分析误报和正确发现
- [ ] LLM 返回平衡改进建议
- [ ] 所有 API 测试通过
