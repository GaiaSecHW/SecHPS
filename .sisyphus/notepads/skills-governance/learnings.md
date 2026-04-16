# Skills Governance - Learnings

## 项目架构关键发现

### Skills 加载流程
```
WorkflowNode (taskName + taskDescription)
  → SkillPredictionTask (异步预测)
  → /api/skills/match (LLM/关键词匹配)
  → SkillPrediction.matches (JSON结果)
  → copySkillsToProject() (技术栈过滤后拷贝)
  → 项目 .claude/skills/ 目录
```

### 关键植入点
- 创建时: `/api/skills` POST handler
- 编排时: `/api/skills/match` POST handler
- 评估启动: `copySkillsToProject()` 函数

### 现有技术栈过滤逻辑
位置: `src/services/skill-files.ts:327-353`
- Skill无技术栈 = 通用Skill，适合所有项目
- 有技术栈 → 需要匹配才拷贝

### Guardrails
- 不阻止Skill创建（仅提示）
- 不阻断编排流程（仅预警）
- 不删除原Skills（soft deprecation）
- 跨用户合并需要同意

## 时间戳
- 2026-04-16T08:15: Session started

## 数据模型设计 (Wave 1)

### 新增治理模型 (prisma/schema.prisma)
位置: 紧接 SkillEvolution 模型之后

1. **SkillObservationLog** - 观测日志
   - 每次预警触发时记录
   - 字段: triggerType, triggerContext(JSON), matches(JSON), issues(JSON), severity, status
   - 关联: skillId → Skill
   - 状态流转: pending → acknowledged → resolved/dismissed

2. **SkillObservationStats** - 观测统计
   - 聚合分析数据
   - 字段: totalObservations, warningCount, matchCount, overlapCount, matchRate, warningRate
   - 关联: skillId → Skill (@unique)
   - 用于: 长期趋势分析、预警阈值调整

3. **SkillNewImpactAnalysis** - 新增影响分析
   - 新 Skill 创建时的影响评估
   - 字段: similarSkills(JSON), overlapScore, affectedWorkflows(JSON), recommendation
   - 推荐: merge | keep_separate | deprecate_old

4. **SkillMergeRecord** - 合并记录
   - 追溯合并历史
   - 字段: sourceSkillId, targetSkillId, mergeReason, status
   - 跨用户合并需要: sourceOwnerConsent, targetOwnerConsent
   - 状态: pending → approved → completed/rejected/reverted

5. **SkillGovernanceConfig** - 治理配置
   - 阈值设置
   - 字段: configKey(@unique), thresholdValue, configValue(JSON), description
   - 示例键: similarity_threshold, overlap_warning_threshold

### Skill 模型扩展
新增关系字段:
- observationLogs: SkillObservationLog[]
- observationStats: SkillObservationStats?
- impactAnalyses: SkillNewImpactAnalysis[]

### SQLite 兼容性
- JSON 字段使用 String 类型存储
- 使用 @default, @updatedAt 标准修饰符
- 避免不支持的数据库特性

### 迁移命令
- `npx prisma db push` - 非交互式推送 schema
- `npx prisma generate` - 生成 TypeScript 类型
- 注意: Windows 环境可能有文件锁问题，需确保无 dev server 运行

- 2026-04-16T09:30: Governance models added successfully

## 相似度检测服务 (Wave 2)

### 新增服务文件
位置: `src/services/skill-similarity.ts`

### 三层相似度检测架构
1. **关键词匹配 (BM25风格)** - `computeKeywordSimilarity()`
   - 使用 tokenize() 分词（支持中文2-gram/3-gram）
   - IDF加权避免常见词主导
   - 返回: { score, matches }

2. **类别+CWE匹配** - `computeCategorySimilarity()`
   - OverlapType枚举: exact | semantic-overlap | techStack-overlap | trigger-overlap
   - 完全匹配优先级最高
   - CWE匹配次之（0.9分）
   - 类别匹配 + 技术栈重叠加权

3. **内容深度分析（可选LLM）** - `computeContentSimilarity()`
   - 默认关闭（enableLLMAnalysis: false）
   - 降级方案: Jaccard系数文本相似度
   - LLM失败时自动降级

### 阈值配置
```typescript
DEFAULT_THRESHOLDS = {
  overall: 0.75,           // 综合相似度阈值
  keywordWeight: 0.4,      // 关键词权重
  categoryWeight: 0.35,    // 类别权重
  contentWeight: 0.25,     // 内容权重
  enableLLMAnalysis: false // LLM分析开关
}
```

### 核心函数
- `findSimilarSkills(skill, allSkills, thresholds)` → SimilarSkill[]
- `findAllSimilarPairs(skills, thresholds)` → 相似技能对列表
- `checkSkillDuplication(newSkill, existingSkills)` → { isDuplicate, similarSkills, reason }

### 类型定义
- `SimilarSkill`: 相似技能结果（含similarity, overlapType, reason等）
- `SimilarityResult`: 详细相似度计算结果
- `OverlapType`: 重叠类型枚举
- `SkillForSimilarity`: 用于相似度计算的技能数据接口

### 参考来源
- 关键词权重映射: route.ts:422-433 categoryKeywords
- 技术栈匹配逻辑: skill-files.ts:327-353
- Skill模型字段: schema.prisma:603-654

- 2026-04-16T10:15: Skill similarity service created successfully

## 功能重复分析服务 (Wave 3)

### 新增服务文件
位置: `src/services/skill-overlap-analysis.ts`

### 核心类型定义
1. **UniquePoint** - 独特检测点
   - skillId, skillName
   - uniqueKeywords: 独特关键词列表
   - uniqueTechStack: 独特技术栈列表
   - uniqueCwe: 独特CWE标识
   - description: 独特性描述

2. **OverlapGroup** - 重叠组
   - groupName: 组名称（基于重叠类型）
   - skills: SimilarSkill[] 组内技能列表
   - overlapType: OverlapType 重叠类型
   - overlapScore: 组平均重叠得分
   - sharedKeywords: 共享关键词
   - uniquePoints: 各技能独特检测点

3. **OverlapAnalysis** - 重叠分析结果
   - timestamp, totalMatches, totalGroups
   - groups: OverlapGroup[] 重叠组列表
   - summary: 摘要统计（exactMatches, semanticOverlaps等）

### 聚类算法
`clusterSimilarSkills(skills, threshold)` → OverlapGroup[]
- 按重叠类型分组（exact, semantic-overlap, techStack-overlap, trigger-overlap）
- 在每个类型组内按相似度排序
- 简单阈值聚类：相似度相近的技能归为一组
- 默认阈值: 0.75

### 关键词提取
`extractSharedKeywords(skills)` → string[]
- 从技能名称、显示名称、技术栈、原因描述提取关键词
- 找出所有技能共有的关键词
- 技术栈关键词优先排序
- 复用 tokenize() 分词逻辑（支持中文2-gram/3-gram）

### 独特检测点提取
`extractUniquePoints(skill, groupSkills)` → UniquePoint
- 对比目标技能与组内其他技能的特征
- 提取独特关键词、独特技术栈、独特CWE
- 自动生成独特性描述

### 辅助函数
- `getHighRiskGroups(analysis, threshold)` → 高风险组列表
- `getGroupsByType(analysis, overlapType)` → 按类型筛选组
- `isSkillInOverlapGroup(analysis, skillId)` → 检查技能是否在重叠组
- `getGroupsForSkill(analysis, skillId)` → 获取技能所在的所有组
- `generateOverlapReport(analysis)` → 生成文本报告

### 设计原则
- 不保存处理状态（每次重新计算）
- 不对单个Skill进行全局扫描（只分析传入的matches列表）
- 简单阈值分组（不引入复杂聚类算法）
- 使用 skill-similarity.ts 的 SimilarSkill 类型

- 2026-04-16T10:45: Skill overlap analysis service created successfully

## 影响预测服务 (Wave 4)

### 新增服务文件
位置: `src/services/skill-impact-prediction.ts`

### 核心类型定义
1. **ImpactSeverity** - 影响严重程度
   - 枚举: 'low' | 'medium' | 'high'

2. **ImpactPrediction** - 影响预测结果
   - duplicateDetection: 是否会产生重复检测
   - estimatedRedundantReports: 预估冗余报告数
   - estimatedTokenIncrease: Token消耗增加百分比
   - overallSeverity: 总体影响严重程度
   - details: 影响详情（groupSize, overlapType, overlapScore, reasoning）

3. **ImpactPredictionConfig** - 预测配置
   - redundantReportFactor: 冗余报告系数（默认2）
   - tokenIncreaseFactor: Token增加系数（默认30）
   - mediumSeverityThreshold: 中等严重度阈值（默认4）
   - highSeverityThreshold: 高严重度阈值（默认8）

### 核心计算逻辑
1. **duplicateDetection判断**
   - 条件: group.skills.length > 1 && overlapType === 'semantic-overlap'
   - 语义重叠且多技能时会产生重复检测

2. **estimatedRedundantReports计算**
   - 公式: Math.floor(groupSize * redundantReportFactor)
   - 每个技能可能产生2个冗余报告

3. **estimatedTokenIncrease估算**
   - 公式: `${((groupSize - 1) * tokenIncreaseFactor).toFixed(0)}%`
   - 第一个技能不增加Token，后续每个增加30%

4. **overallSeverity计算**
   - 评分系统（满分100+）
   - 重复检测: +30分
   - 冗余报告数: >=8 +40分, >=4 +25分, >0 +10分
   - Token增加: >=60% +30分, >=30% +20分, >0 +10分
   - 重叠得分: >=0.9 +20分, >=0.8 +10分
   - 总分>=70为high, >=40为medium, <40为low

### 核心函数
- `predictImpact(group, config)` → ImpactPrediction
- `calculateRedundantReports(groupSize, factor)` → number
- `calculateTokenIncrease(groupSize, factor)` → string
- `calculateSeverity(params)` → ImpactSeverity

### 辅助函数
- `predictBatchImpact(groups, config)` → 批量预测
- `getHighSeverityPredictions(predictions)` → 高风险预测列表
- `getMediumSeverityPredictions(predictions)` → 中等风险预测列表
- `summarizeImpactPredictions(predictions)` → 统计汇总
- `generateImpactReport(predictions)` → 生成文本报告

### 设计原则
- 不依赖实际SkillExecution数据（预测，不是统计）
- 不查询数据库获取历史数据
- 使用 skill-overlap-analysis.ts 的 OverlapGroup 类型
- 影响预测用于预警展示，帮助用户决策

### 参考来源
- SkillExecution统计字段: schema.prisma:662-702
- OverlapGroup结构: skill-overlap-analysis.ts:33-46

- 2026-04-16T11:15: Skill impact prediction service created successfully

## 处理建议生成服务 (Wave 5)

### 新增服务文件
位置: `src/services/skill-recommendations.ts`

### 核心类型定义
1. **RecommendationAction** - 建议动作类型
   - 枚举: 'merge' | 'techStack-split' | 'keep-all' | 'manual-review'
   - merge: 合并建议（有明确覆盖关系时）
   - techStack-split: 技术栈拆分建议（技术栈可以明确分开时）
   - keep-all: 保留全部建议（影响可控时）
   - manual-review: 人工审核建议（复杂情况需要人工审核）

2. **RecommendationPriority** - 建议优先级
   - 枚举: 'high' | 'medium' | 'low'

3. **ImpactPrediction** - 影响预测（来自T4）
   - duplicateDetection: 是否存在重复检测
   - estimatedRedundantReports: 预估冗余报告数
   - estimatedTokenIncrease: 预估Token增加量
   - overallSeverity: 'low' | 'medium' | 'high' | 'critical'
   - details: 影响详情

4. **Recommendation** - 处理建议
   - action: 建议动作
   - priority: 优先级
   - description: 建议描述
   - reason: 建议原因
   - expectedBenefit: 预期收益
   - targetSkill/sourceSkills: merge时的目标/来源
   - techStackSplitPlan: 技术栈拆分方案
   - reviewPoints: 需人工审核的点

5. **TechStackSplitPlan** - 技术栈拆分方案
   - skillId, skillName, techStack, uniqueKeywords

### 建议生成逻辑
1. **merge建议条件**
   - overlapScore >= 0.85（高度重叠）
   - overlapType为exact或semantic-overlap
   - 有明确的primary skill（独特检测点最少）

2. **techStack-split建议条件**
   - overlapType为techStack-overlap
   - 各skills有不同且可区分的techStack

3. **keep-all建议条件**
   - overallSeverity为low（影响可控）

4. **manual-review建议**
   - 复杂情况总是作为备选
   - 收集审核点：触发词重叠、独特CWE、独特关键词过多等

### 核心函数
- `generateRecommendations(overlapGroup, impact, config)` → Recommendation[]
- `suggestMerge(group)` → Recommendation
- `suggestTechStackSplit(group)` → Recommendation
- `suggestKeepAll(group, impact)` → Recommendation
- `suggestManualReview(group)` → Recommendation

### 辅助函数
- `getBestRecommendation(recommendations)` → 优先级最高的建议
- `getRecommendationByAction(recommendations, action)` → 按类型筛选
- `generateRecommendationReport(recommendations)` → 生成文本报告
- `isExecutableRecommendation(recommendation)` → 是否可自动执行
- `getRecommendationRisk(recommendation)` → 执行风险等级

### 设计原则
- 不自动执行建议（只生成建议）
- 不修改其他服务文件
- 不查询数据库
- 建议按优先级排序（merge优先，manual-review最后）
- 每个建议包含：action, priority, description, reason, expectedBenefit

### 参考来源
- OverlapGroup结构: skill-overlap-analysis.ts:33-46
- 技术栈匹配逻辑: skill-files.ts:246-353
- ImpactPrediction结构: skill-impact-prediction.ts（T4并行执行）

- 2026-04-16T11:30: Skill recommendations service created successfully

## POST Handler 相似度检测集成 (Wave 6)

### 修改文件
位置: `src/app/api/skills/route.ts`

### 新增导入
```typescript
import { findSimilarSkills, SkillForSimilarity, SimilarSkill } from '@/services/skill-similarity';
```

### 植入点
- 在 `prisma.skill.create()` 成功后（约 line 208）
- 在审计日志记录和磁盘保存之后
- 在返回响应之前

### 实现逻辑
1. **获取现有技能列表**
   - 查询条件: `userId`（同一作用域）, `isLatest: true`, 排除新创建的技能
   - Select: id, name, displayName, description, category, techStack, cwe, content

2. **转换数据格式**
   - techStack: JSON.parse() 从字符串转为数组
   - 构建 SkillForSimilarity[] 格式

3. **调用相似度检测**
   - `findSimilarSkills(newSkillForSimilarity, skillsForSimilarity)`
   - 使用默认阈值 0.75
   - 返回 SimilarSkill[]

4. **返回结构扩展**
   ```typescript
   { skill, governanceWarnings: { similarSkills, hasSimilar } }
   ```
   - governanceWarnings 为可选字段
   - hasSimilar: boolean（是否有相似技能）
   - similarSkills: SimilarSkill[]（相似技能列表）

### Guardrails 实现
- **不阻塞创建**: 相似度检测在 try-catch 中，失败不影响创建
- **仅提示**: governanceWarnings 作为附加字段返回，不阻止流程
- **错误处理**: 检测失败仅记录日志，不抛出异常

### 验证结果
- TypeScript 编译无错误
- Build 成功（npm run build）
- 返回结构正确扩展

- 2026-04-16T12:00: POST handler similarity detection integrated successfully 
 ## Skills Match API 治理预警集成 (Wave 6)

### 修改文件
位置: src/app/api/skills/match/route.ts

### 新增导入
- nalyzeSkillOverlap, OverlapGroup from skill-overlap-analysis
- predictImpact, ImpactPrediction from skill-impact-prediction
- generateRecommendations, Recommendation from skill-recommendations
- SimilarSkill, OverlapType from skill-similarity

### 新增类型定义
1. **GovernanceWarning** - 治理预警结构
   - overlapGroups: OverlapGroup[] 重叠组列表
   - impact: ImpactPrediction[] 影响预测列表
   - recommendations: Recommendation[] 处理建议列表
   - hasOverlap: boolean 是否存在重叠

### 新增函数
1. **convertToSimilarSkill(matches)** → SimilarSkill[]
   - 将 SkillMatch[] 转换为 SimilarSkill[]
   - 推断 overlapType: 基于 category 和 techStack
   - 估算 overlapScore: 基于 relevance
   - 设置 keywordScore: relevance * 0.7

2. **generateGovernanceWarning(matches)** → GovernanceWarning | null
   - 少于2个匹配时返回 null（无重复可能）
   - 调用 analyzeSkillOverlap(similarSkills)
   - 调用 predictImpact(group) 批量预测
   - 调用 generateRecommendations(group, impact) 批量生成建议
   - 失败时返回 null（不阻断主流程）

### 返回结构扩展
所有返回点新增 governanceWarning 字段:
- 无 Skills 时: governanceWarning: null
- 关键词匹配时: governanceWarning: generateGovernanceWarning(matches)
- LLM 匹配时: governanceWarning: generateGovernanceWarning(matches)

### 类型转换注意事项
- skill-impact-prediction.ts 的 ImpactPrediction.estimatedTokenIncrease 是 string
- skill-recommendations.ts 的 ImpactPrediction.estimatedTokenIncrease 是 number
- 需要手动转换: parseInt(p.estimatedTokenIncrease, 10)
- 需要填充 details 字段: affectedWorkflows, userConfusionRisk, selectionConflictRate

### Guardrails 验证
- 不阻断编排流程（失败返回 null）
- matches 始终返回（预警可选）
- 少于2个匹配时跳过分析

- 2026-04-16T12:00: Skills match API governance warning integration completed

## predict-tasks API 治理预警集成 (Wave 8)

### 修改文件
位置: `src/app/api/skills/predict-tasks/route.ts`

### 新增导入
```typescript
import { analyzeSkillOverlap, getHighRiskGroups } from '@/services/skill-overlap-analysis';
import type { SimilarSkill, OverlapType } from '@/services/skill-similarity';
```

### 植入点
- 在 `executePredictionTask()` 函数中
- 在 matches 生成后、保存结果前（约 line 280-300）
- 在 progress 90% 之后

### 实现逻辑
1. **转换 matches 为 SimilarSkill 格式**
   - 添加 overlapType、overlapScore、keywordScore 字段
   - 使用 `determineOverlapType()` 根据匹配结果确定重叠类型

2. **执行重叠分析**
   - `analyzeSkillOverlap(similarSkills)` → OverlapAnalysis
   - `getHighRiskGroups(overlapAnalysis)` → 高风险组列表

3. **生成 governanceWarning**
   - 结构: `{ hasWarning, severity, message, details }`
   - severity: 'low' | 'medium' | 'high' | 'critical'
   - details 包含: totalGroups, highRiskCount, summary, recommendations

4. **触发观测日志记录**
   - 条件: `overlapAnalysis.totalGroups > 0 && governanceWarning`
   - 为每个高风险组创建 SkillObservationLog 记录
   - triggerType: 'overlap_detected' 或 'similarity_warning'
   - 记录失败不影响主流程（catch 错误仅记录日志）

### 数据模型扩展
位置: `prisma/schema.prisma` SkillPredictionTask 模型

新增字段:
```prisma
// Skills Governance 预警信息
governanceWarning String? // JSON: 治理预警信息（重叠分析结果）
```

### GET Handler 扩展
- 解析 governanceWarning 字段返回给客户端
- `task.governanceWarning ? JSON.parse(task.governanceWarning) : null`

### 辅助函数
1. **determineOverlapType(match, workflowTechStack)** → OverlapType
   - 技术栈匹配 → 'techStack-overlap'
   - 高相关性(>=0.85) → 'semantic-overlap'
   - 中等相关性(>=0.75) → 'trigger-overlap'
   - 默认 → 'semantic-overlap'

2. **generateGovernanceWarning(overlapAnalysis, highRiskGroups)** → Warning | null
   - 无重叠返回 null
   - 高风险组>=3 → 'critical'
   - 高风险组>=1 → 'high'
   - semanticOverlaps>=2 → 'medium'
   - 其他 → 'low'

3. **generateWarningMessage(severity, analysis, groups)** → string
   - 根据严重程度生成预警消息
   - 包含重叠组数量、完全匹配数、语义重叠数

4. **generateRecommendations(analysis, groups)** → string[]
   - 高风险组建议
   - 完全匹配建议
   - 语义重叠建议
   - 技术栈重叠建议

5. **triggerObservationLog(params)** → Promise<void>
   - 为高风险组创建观测日志
   - 为完全匹配创建额外预警日志
   - 错误处理：失败不影响主流程

6. **mapSeverityToLogLevel(severity)** → string
   - 将治理严重程度映射到日志级别

### Guardrails 实现
- **不阻断预测流程**: 重叠分析和观测日志在 try-catch 中
- **仅预警**: governanceWarning 作为附加字段返回
- **观测日志失败不影响主流程**: catch 错误仅记录日志

### 验证结果
- TypeScript 编译无错误（仅 deprecation warning）
- Prisma schema 已更新（需重启 dev server 后运行 prisma generate）

### 注意事项
- Windows 环境可能有文件锁问题，需确保无 dev server 运行后再运行 `npx prisma generate`
- 观测日志记录为 T9 提供触发点，T9 可基于此实现完整的观测日志系统

- 2026-04-16T16:45: predict-tasks API governance warning integrated successfully

## 观测日志服务 (Wave 9)

### 新增服务文件
位置: `src/services/skill-observation-log.ts`

### 核心类型定义
1. **ObservationContext** - 观测日志上下文
   - workflowId, nodeId, userId, taskId
   - taskName, taskDescription, groupName
   - overlapType, overlapScore

2. **LogObservationParams** - 观测日志参数
   - matches: SimilarSkill[] 匹配的技能列表
   - warning: { hasWarning, severity, message, details }
   - context: ObservationContext

3. **ObservationLogResult** - 观测日志创建结果
   - success: boolean
   - logIds: string[] 创建的日志ID列表
   - error?: string 错误信息

4. **UpdateStatsParams** - 统计更新参数
   - matchCount, overlapCount, warningCount
   - responseTime, matchScore

### 核心函数
1. **logObservation(params)** → ObservationLogResult
   - 为每个匹配的 Skill 创建观测日志记录
   - 使用 prisma.skillObservationLog.create()
   - 自动调用 updateObservationStats 更新统计
   - 错误不阻断主流程（返回 success: false）

2. **updateObservationStats(skillId, params)** → void
   - 使用 prisma.skillObservationStats.upsert()
   - 累加 totalObservations, matchCount, overlapCount, warningCount
   - 计算比率: matchRate, warningRate
   - 更新平均响应时间和匹配分数
   - 更新 firstObservedAt, lastObservedAt

3. **getObservationStats(skillId)** → SkillObservationStats | null
   - 查询指定 Skill 的观测统计
   - 使用 prisma.skillObservationStats.findUnique()

4. **getHighFrequencySkills(limit)** → SkillObservationStats[]
   - 返回 overlapCount 高的 Skills 统计列表
   - 按 overlapCount DESC, warningCount DESC 排序
   - 包含关联的 Skill 基本信息（id, name, displayName, category）

### 辅助函数
1. **getObservationLogs(params)** → SkillObservationLog[]
   - 查询观测日志列表
   - 支持按 skillId, triggerType, severity, status 筛选
   - 支持分页（limit, offset）

2. **updateLogStatus(logId, status, resolvedBy, resolution)** → boolean
   - 更新观测日志状态
   - 状态: acknowledged | resolved | dismissed
   - 记录 resolvedAt, resolvedBy, resolution

3. **determineTriggerType(warning, match)** → string
   - 完全匹配 → 'similarity_warning'
   - 高严重度预警 → 'overlap_detected'
   - 技术栈重叠 → 'overlap_detected'
   - 语义重叠 → 'overlap_detected'

4. **mapSeverityToLogLevel(severity)** → string
   - critical → 'critical'
   - high → 'high'
   - medium → 'medium'
   - low → 'low'

### 设计原则
- 错误处理不阻断主流程（所有函数都有 try-catch）
- 使用 AuditLogger 模式（静态类方法）
- JSON 字段使用 JSON.stringify 存储
- 统计更新使用 upsert（创建或更新）
- 高频查询使用索引字段（overlapCount, warningCount）

### 导出便捷函数
```typescript
export const logObservation = SkillObservationLogService.logObservation;
export const updateObservationStats = SkillObservationLogService.updateObservationStats;
export const getObservationStats = SkillObservationLogService.getObservationStats;
export const getHighFrequencySkills = SkillObservationLogService.getHighFrequencySkills;
export const getObservationLogs = SkillObservationLogService.getObservationLogs;
export const updateLogStatus = SkillObservationLogService.updateLogStatus;
```

### 参考来源
- AuditLogger 模式: src/lib/audit/logger.ts
- SkillObservationLog 模型: prisma/schema.prisma:742-773
- SkillObservationStats 模型: prisma/schema.prisma:776-807
- triggerObservationLog 调用点: src/app/api/skills/predict-tasks/route.ts:824-913

### 验证结果
- TypeScript 编译无错误
- Build 成功（npm run build）
- 所有函数实现完整

- 2026-04-16T17:30: Skill observation log service created successfully

## 观测统计聚合服务 (Wave 10)

### 新增服务文件
位置: `src/services/skill-observation-stats.ts`

### 核心类型定义
1. **ObservationStatsSummary** - 统计摘要结构
   - totalSkills: 有观测记录的 Skills 总数
   - totalObservations: 总观测次数
   - totalWarnings: 总预警次数
   - totalMatches: 总匹配次数
   - totalOverlaps: 总重叠检测次数
   - avgMatchRate: 平均匹配率
   - avgWarningRate: 平均预警率
   - highRiskSkills: 高风险 Skills 数量（warningRate >= 0.5）
   - recentObservations: 最近7天观测次数

2. **OverlapPairStats** - 重叠对统计
   - skillId1, skillName1, skillId2, skillName2
   - overlapCount: 共同出现次数
   - overlapScore: 平均重叠得分
   - overlapType: 重叠类型
   - firstObservedAt, lastObservedAt

3. **TrendDataPoint** - 趋势数据点
   - date: 日期 YYYY-MM-DD
   - value: 数值
   - change: 相比前一天的百分比变化

4. **TrendData** - 趋势数据
   - skillId, skillName, metric, period
   - data: TrendDataPoint[]
   - trendDirection: 'up' | 'down' | 'stable'
   - trendPercentage: 趋势百分比变化
   - summary: 趋势摘要描述

5. **SkillStatsWithDetails** - 带详情的统计
   - 包含 SkillObservationStats 所有字段
   - skillName, skillDisplayName, skillCategory
   - riskLevel: 'low' | 'medium' | 'high' | 'critical'
   - trend: TrendData | null

### 核心聚合函数
1. **aggregateObservationStats(skillId)** → AggregationResult
   - 从观测日志重新计算统计数据
   - 解析 matches JSON 字段计算 matchCount, overlapCount
   - 计算比率: matchRate, warningRate
   - 使用 upsert 更新或创建统计记录
   - 无观测日志时创建空统计记录

2. **aggregateAllStats()** → GlobalAggregationResult
   - 对所有有观测日志的 Skills 执行聚合
   - 批量处理（每次10个，避免数据库压力）
   - 返回处理数量

3. **getFrequentOverlapPairs(limit)** → OverlapPairStats[]
   - 分析哪些 Skills 经常一起出现在观测日志中
   - 解析 matches JSON 找出所有重叠对
   - 统计共同出现次数、平均重叠得分
   - 按重叠次数排序

4. **calculateTrend(skillId, days, metric)** → TrendData | null
   - 计算指定 Skill 在指定天数内的趋势
   - 支持指标: observations | warnings | matches | overlaps
   - 按日期分组统计
   - 计算趋势方向和百分比变化
   - 自动生成趋势摘要描述

5. **getTopOverlapSkills(limit)** → SkillStatsWithDetails[]
   - 返回 overlapCount 最高的 Skills
   - 按 overlapCount DESC, warningCount DESC 排序
   - 包含关联的 Skill 基本信息

6. **getStatsSummary()** → ObservationStatsSummary
   - 获取全局观测统计摘要
   - 计算汇总数据（总数、平均比率）
   - 统计高风险 Skills 数量
   - 查询最近7天观测次数

### 辅助函数
1. **calculateRiskLevel(warningRate, overlapCount)** → riskLevel
   - warningRate >= 0.7 → 'critical'
   - warningRate >= 0.5 → 'high'
   - overlapCount >= 10 或 warningRate >= 0.3 → 'medium'
   - 其他 → 'low'

2. **generateTrendSummary(metric, direction, percentage, days)** → string
   - 根据趋势方向和百分比生成摘要描述
   - 支持中文描述（近7天、近30天）

3. **getSkillStatsWithTrend(skillId, trendDays)** → SkillStatsWithDetails | null
   - 获取带趋势的 Skill 统计详情
   - 自动计算趋势数据

4. **getBatchStatsWithTrend(skillIds, trendDays)** → SkillStatsWithDetails[]
   - 批量获取带趋势的 Skill 统计

5. **getWarningSkills(limit)** → SkillStatsWithDetails[]
   - 获取预警 Skills 列表
   - 按 warningRate DESC, warningCount DESC 排序

6. **cleanupStaleStats(days)** → number
   - 清理超过指定天数无更新的统计记录
   - 只删除无观测的记录（totalObservations = 0）

### 设计原则
- 错误处理不阻断主流程（所有函数都有 try-catch）
- 使用静态类方法模式（SkillObservationStatsService）
- JSON 字段解析失败时跳过该记录
- 批量处理避免数据库压力
- 趋势计算支持多种指标和周期

### 导出便捷函数
```typescript
export const aggregateObservationStats = SkillObservationStatsService.aggregateObservationStats;
export const aggregateAllStats = SkillObservationStatsService.aggregateAllStats;
export const getFrequentOverlapPairs = SkillObservationStatsService.getFrequentOverlapPairs;
export const calculateTrend = SkillObservationStatsService.calculateTrend;
export const getTopOverlapSkills = SkillObservationStatsService.getTopOverlapSkills;
export const getStatsSummary = SkillObservationStatsService.getStatsSummary;
export const getSkillStatsWithTrend = SkillObservationStatsService.getSkillStatsWithTrend;
export const getBatchStatsWithTrend = SkillObservationStatsService.getBatchStatsWithTrend;
export const getWarningSkills = SkillObservationStatsService.getWarningSkills;
export const cleanupStaleStats = SkillObservationStatsService.cleanupStaleStats;
```

### 参考来源
- SkillObservationLogService 模式: src/services/skill-observation-log.ts
- SkillObservationStats 模型: prisma/schema.prisma:776-807
- SkillObservationLog 模型: prisma/schema.prisma:742-773

### 验证结果
- TypeScript 编译无错误
- Build 成功（npm run build）
- 所有聚合函数实现完整

- 2026-04-16T18:00: Skill observation stats aggregation service created successfully

## 观测API (Wave 11)

### 新增 API 路由
位置: `src/app/api/admin/skills-governance/`

### 路由结构
```
src/app/api/admin/skills-governance/
├── route.ts                    # 主路由 - 观测模块总览
├── stats/route.ts              # 统计摘要 API
├── high-frequency/route.ts     # 高频重叠排行 API
├── new-impact/route.ts         # 新增 Skill 影响分析 API
└── merge-candidates/route.ts   # 合并候选 API
```

### API 端点详情

1. **GET /api/admin/skills-governance** - 观测模块总览
   - 返回: statsSummary, topOverlapSkills(前5), overlapPairs(前5), pendingItems
   - pendingItems: { impactAnalysis: count, mergeRecords: count }
   - 权限: PERMISSIONS.SKILL_READ

2. **GET /api/admin/skills-governance/stats** - 统计摘要
   - 返回: ObservationStatsSummary 结构
   - 字段: totalSkills, totalObservations, totalWarnings, totalMatches, totalOverlaps, avgMatchRate, avgWarningRate, highRiskSkills, recentObservations
   - 权限: PERMISSIONS.SKILL_READ

3. **GET /api/admin/skills-governance/high-frequency** - 高频重叠排行
   - 参数: limit (默认20)
   - 返回: { skills: SkillStatsWithDetails[], overlapPairs: OverlapPairStats[] }
   - 权限: PERMISSIONS.SKILL_READ

4. **GET /api/admin/skills-governance/new-impact** - 新增 Skill 影响分析
   - 参数: page, limit, status, skillId, minOverlapScore
   - 返回: 分页的 SkillNewImpactAnalysis 列表
   - 包含: skill 基本信息, similarSkills(JSON解析), affectedWorkflows(JSON解析)
   - 权限: PERMISSIONS.SKILL_READ

5. **GET /api/admin/skills-governance/merge-candidates** - 合并候选
   - 参数: limit (默认20), minOverlapScore (默认0.75)
   - 返回: { candidates, pendingMergeRecords, summary }
   - candidates: 基于 overlapPairs 构建，包含 recommendation (merge/techStack-split/manual-review)
   - pendingMergeRecords: 待处理的 SkillMergeRecord 列表
   - summary: 统计汇总
   - 权限: PERMISSIONS.SKILL_READ

### 认证模式
- 使用 `authenticateRequest()` from `@/lib/api-auth`
- 检查 `PERMISSIONS.SKILL_READ` 权限
- 失败返回 `authErrorResponse(auth)`

### 错误处理
- 所有路由使用 try-catch 包裹
- 错误时返回 `{ error: '服务器内部错误' }` (status: 500)
- 使用 `logger.errorNoUser()` 记录错误日志
- 使用 `logger.access()` 记录访问日志

### 数据模型注意事项
- SkillMergeRecord 模型没有定义 Skill 关系（只有 sourceSkillId/targetSkillId 字段）
- 需要手动查询 Skill 信息并构建 Map
- SkillNewImpactAnalysis 有 skill 关系，可以使用 include
- JSON 字段需要手动解析（similarSkills, affectedWorkflows, mergeDetails）

### SimilarSkill 类型要求
- 必须包含: skillId, skillName, displayName, category, techStack, similarity, overlapType, overlapScore, keywordScore, reason
- techStack 为 string[] 类型
- overlapType 为 OverlapType 枚举类型

### 验证结果
- TypeScript 编译无错误
- Build 成功（npm run build）
- 所有 API 路由实现完整

- 2026-04-16T18:30: Skills Governance observation API routes created successfully

## 观测Dashboard总览页面 (Wave 12)

### 新增页面文件
位置: `src/app/dashboard/admin/skills-governance/page.tsx`

### 页面结构
1. **Header区域**
   - 标题: "Skills 观测治理"
   - 描述: "监控 Skills 重复检测、重叠预警和治理建议"
   - 刷新按钮: 手动刷新数据

2. **Stats Cards (4个统计卡片)**
   - Skills总数: 有观测记录的 Skills 数量
   - 预警记录: 总预警次数 + 预警率
   - 高频重复: 高风险 Skills 数量 (预警率≥50%)
   - 待处理: 影响分析 + 合并记录待处理数量

3. **Summary Stats Bar**
   - 总观测次数、匹配次数、重叠检测、最近7天观测
   - 平均匹配率百分比显示

4. **Tab Navigation (4个标签页)**
   - 高频重复: 显示 topOverlapSkills 前5个，点击跳转详情页
   - 重复组: 显示 overlapPairs 前5个，点击跳转合并候选页
   - 新增影响: 显示待处理影响分析数量，点击跳转处理页
   - 趋势: 显示最近7天观测和平均预警率，点击跳转详细趋势页

### 类型定义
```typescript
interface ObservationStatsSummary {
  totalSkills, totalObservations, totalWarnings, totalMatches, totalOverlaps,
  avgMatchRate, avgWarningRate, highRiskSkills, recentObservations
}

interface TopOverlapSkill {
  skillId, skillName, skillDisplayName, skillCategory,
  overlapCount, warningCount, riskLevel
}

interface OverlapPair {
  skillId1, skillName1, skillId2, skillName2,
  overlapCount, overlapScore, overlapType
}

interface PendingItems {
  impactAnalysis, mergeRecords
}
```

### UI组件模式
- Stats Card: 白色背景 + 圆角阴影 + 图标 + 数值 + 描述
- Tab Navigation: 底部边框 + 活动标签蓝色高亮
- List Item: 灰色背景 + hover效果 + 点击跳转
- Risk Level Badge: 颜色映射 (critical=red, high=orange, medium=yellow, low=green)
- Overlap Type Badge: 蓝色背景 + 中文标签

### API调用
- `/api/admin/skills-governance` → 获取总览数据
- 返回结构: `{ data: { stats, topOverlapSkills, overlapPairs, pendingItems } }`

### 路由跳转
- 高频重复详情: `/dashboard/admin/skills-governance/high-frequency`
- 合并候选: `/dashboard/admin/skills-governance/merge-candidates`
- 新增影响: `/dashboard/admin/skills-governance/new-impact`
- 趋势详情: `/dashboard/admin/skills-governance/trends`
- Skill详情: `/dashboard/skills/${skillId}`

### TypeScript注意事项
- 可选链 `?.` 后的数值比较需要使用 `?? 0` 处理 undefined
- 例如: `(overview?.pendingItems.impactAnalysis ?? 0) > 0`

### 验证结果
- TypeScript 编译无错误
- Build 成功（npm run build）
- 页面路由: `/dashboard/admin/skills-governance`

- 2026-04-16T19:00: Skills Governance dashboard overview page created successfully

## ��Ƶ�ظ�����ҳ�� (Wave 13)

### ����ҳ���ļ�
λ��: src/app/dashboard/admin/skills-governance/high-frequency/page.tsx

### ҳ�湦��
1. **��������** - ��ʾ��Ƶ�ص� Skills ����
   - ������: ǰ3��ʹ�ò�ɫ���£���/��/�ƣ�������ʹ������
   - Skill����: ��ʾ displayName �� skillName
   - ����: ʹ�� categoryLabels ӳ�����ķ�����
   - �ظ�����: ʹ�� AlertTriangle ͼ�꣬��ɫ���ݴ����仯
   - ѡ����: ���������ӻ�����ʾ�ٷֱ�
   - Ԥ����: ���������ӻ�����ɫ����Ԥ���ʱ仯
   - ����״̬: riskLevel ӳ�䣨low=��ɫ, medium=��ɫ, high=��ɫ, critical=��ɫ��
   - ���۲�: ���ڸ�ʽ����ʾ

2. **����������ť**
   - ����������: CheckCircle ͼ�꣬��ɫ��ť
   - ��������ϲ�: Merge ͼ�꣬��ɫ��ť����Ҫ����2��ѡ��
   - ��������: Download ͼ�꣬��ɫ��ť������ JSON �����ļ�

3. **�ص��Ա���** - ��ʾ��Ƶ�ص���
   - Skill 1 / Skill 2 ����
   - �ص������͵÷֣����������ӻ���
   - �ص����ͱ�ǩ��exact=��ɫ, semantic-overlap=��ɫ, techStack-overlap=��ɫ��

### ��������
`	ypescript
interface SkillStatsWithDetails {
  id: string;
  skillId: string;
  skillName: string;
  skillDisplayName: string;
  skillCategory: string;
  totalObservations: number;
  warningCount: number;
  matchCount: number;
  overlapCount: number;
  matchRate: number;
  warningRate: number;
  avgMatchScore: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface OverlapPairStats {
  skillId1: string;
  skillName1: string;
  skillId2: string;
  skillName2: string;
  overlapCount: number;
  overlapScore: number;
  overlapType: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}
`

### UI ���ģʽ
- ������: ��� Search ͼ�꣬�Ҳ������
- ѡ���: ȫѡ��ѡ�� + ���и�ѡ��
- ������: ʹ�� div + bg-gray-200 + bg-blue-500/orange-500/red-500
- ״̬����: ʹ�� px-2 py-1 text-xs rounded-full + bg/text ��ɫ���
- ����: min-w-full divide-y divide-gray-200 + hover:bg-gray-50

### ���յȼ���ɫӳ��
`	ypescript
const riskLevelConfig: Record<string, { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-green-100', text: 'text-green-800', label: '�ͷ���' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '�з���' },
  high: { bg: 'bg-orange-100', text: 'text-orange-800', label: '�߷���' },
  critical: { bg: 'bg-red-100', text: 'text-red-800', label: '����' },
};
`

### ��������ṹ
`	ypescript
{
  generatedAt: string;
  totalSkills: number;
  totalOverlapPairs: number;
  skills: Array<{
    name: string;
    skillId: string;
    category: string;
    overlapCount: number;
    matchRate: string;
    warningRate: string;
    riskLevel: string;
    lastObserved: string;
  }>;
  overlapPairs: Array<{
    skill1: string;
    skill2: string;
    overlapCount: number;
    overlapScore: string;
    overlapType: string;
  }>;
}
`

### ע������
- lucide-react û�� Separate ͼ�꣬ʹ�� ArrowRightLeft ���
- ��������ʹ�� Blob + URL.createObjectURL ʵ���ļ�����
- ����������Ҫ����ѡ��1��ϲ�������Ҫ����2�
- API ������Ҫ Authorization: Bearer token

### ��֤���
- TypeScript �����޴���
- Build �ɹ���npm run build��
- ҳ��·��: /dashboard/admin/skills-governance/high-frequency

- 2026-04-16T17:15: High-frequency ranking table page created successfully
## 新增Skill影响分析页面 (Wave 14)

### 新增页面文件
位置: src/app/dashboard/admin/skills-governance/new-impact/page.tsx

### 页面功能
1. **列表展示**
   - Skill名称（显示名称 + 内部名称 + 分类）
   - 相似度（重叠分数，带颜色标识）
   - 相似对象（相似Skills列表，最多显示3个）
   - 审核状态（pending/analyzed/actioned/dismissed）
   - 推荐操作（merge/keep_separate/deprecate_old）

2. **筛选功能**
   - 搜索：按Skill ID搜索
   - 状态筛选：所有状态/待审核/已分析/已处理/已忽略
   - 重叠度筛选：所有重叠度/高重叠(≥85%)/中重叠(≥75%)/低重叠(≥60%)

3. **审核操作按钮**
   - 批准合并（紫色按钮）
   - 保持独立（蓝色按钮）
   - 标记待审核（黄色按钮）
   - 查看详情（蓝色按钮）

4. **详情模态框**
   - 基本信息：Skill ID、名称、分类、重叠分数、创建时间
   - 相似Skills列表：显示所有相似Skills及其相似度
   - 推荐操作：显示推荐类型和原因
   - 受影响的工作流：显示可能受影响的Workflow列表
   - 处理时间线：创建时间、分析时间、处理时间

### 状态徽章颜色
`	ypescript
statusColors = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  analyzed: 'bg-blue-100 text-blue-800 border-blue-200',
  actioned: 'bg-green-100 text-green-800 border-green-200',
  dismissed: 'bg-gray-100 text-gray-600 border-gray-200',
}
`

### 推荐操作图标
`	ypescript
recommendationConfig = {
  merge: { icon: GitMerge, color: 'bg-purple-100 text-purple-800' },
  keep_separate: { icon: ArrowRightLeft, color: 'bg-blue-100 text-blue-800' },
  deprecate_old: { icon: Archive, color: 'bg-orange-100 text-orange-800' },
}
`

### 重叠分数颜色标识
- ≥85%: 红色 + 加粗 + AlertTriangle图标
- ≥75%: 橙色
- ≥60%: 黄色
- <60%: 绿色
- null: 灰色（未计算）

### 分页支持
- 默认20条/页
- 支持10/20/50/100条/页选择
- 首页/上一页/下一页/末页导航

### API调用
- GET /api/admin/skills-governance/new-impact
- 参数: page, limit, status, skillId, minOverlapScore
- 返回: { data: ImpactAnalysis[], pagination: Pagination }

### 注意事项
- lucide-react 没有 Separate 图标，使用 ArrowRightLeft 替代
- 详情模态框使用全屏覆盖模式（fixed inset-0 bg-white z-50）
- 操作按钮仅在 status === 'pending' 时显示

### 验证结果
- TypeScript 编译无错误
- Build 成功（npm run build）
- 页面路由: /dashboard/admin/skills-governance/new-impact

- 2026-04-16T17:10: New impact analysis page created successfully

## Skill合并执行服务 (Wave 15)

### 新增服务文件
位置: `src/services/skill-merge.ts`

### 核心类型定义
1. **MergeStrategy** - 合并策略类型
   - 枚举: 'content-merge' | 'replace' | 'techStack-split'

2. **MergeOptions** - 合并选项
   - strategy: MergeStrategy 合并策略
   - targetSkillId: string 目标 Skill ID
   - sourceSkillIds: string[] 源 Skill IDs
   - mergeReason: string 合并原因（similarity | duplicate | consolidation | user_request）
   - userId: string 执行合并的用户 ID
   - newSkillName?: string 新 Skill 名称（content-merge 可选）
   - newSkillDisplayName?: string 新 Skill 显示名称（content-merge 可选）

3. **MergeResult** - 合并结果
   - success: boolean 是否成功
   - mergedSkill?: Skill 合并后的 Skill
   - deprecatedSkills?: Skill[] 废弃的 Skills
   - updatedSkills?: Skill[] 更新的 Skills（techStack-split）
   - mergeRecord?: SkillMergeRecord 审计记录
   - error?: string 错误信息

4. **MergeDetails** - 合并详情（存储在 mergeDetails JSON）
   - strategy: MergeStrategy
   - originalTargetSkill: 原目标 Skill 信息
   - originalSourceSkills: 原源 Skills 信息
   - mergedContent?: string 合并后的内容（content-merge）
   - techStackAssignments?: 技术栈分配方案（techStack-split）
   - mergedAt: string 合并时间
   - mergedBy: string 合并执行者

### 三种合并策略实现

#### 1. content-merge（内容合并）
- 合并 frontmatter 字段：
  - name: 使用 newSkillName 或 `{targetSkill.name}-merged`
  - displayName: 使用 newSkillDisplayName 或 `{targetSkill.displayName} (合并版)`
  - description: 取最长的描述
  - category: 继承目标 Skill 的分类
  - severity: 取最高的严重程度（critical > high > medium > low > info）
  - cwe: 取第一个非空的 CWE
  - techStack: 取所有技术栈的并集
- 合并内容：使用 `\n\n---\n\n` 分隔符拼接所有 Skills 的内容
- 版本管理：取最大版本号 + 1，parentId 引用目标 Skill
- Soft Deprecation：标记所有原 Skills 的 isLatest=false
- 审计记录：为每个源 Skill 和目标 Skill 创建 SkillMergeRecord

#### 2. replace（替代合并）
- 目标 Skill 创建新版本，添加合并说明到内容末尾
- 版本管理：目标 Skill 版本号 + 1，parentId 引用原目标 Skill
- Soft Deprecation：标记所有源 Skills 的 isLatest=false
- 审计记录：为每个源 Skill 创建 SkillMergeRecord

#### 3. techStack-split（技术栈区分）
- 保持 Skills 分离，不创建新 Skill
- 为每个 Skill 分配独特的技术栈：
  - 如果已有技术栈，保持不变
  - 如果没有技术栈，从名称推断（使用 inferTechStackFromSkillName）
- 版本管理：每个 Skill 创建新版本，更新 techStack 字段
- 审计记录：创建一条合并记录，记录整个拆分操作

### 技术栈推断逻辑
`inferTechStackFromSkillName(name, displayName)` → string[]
- 关键词映射：Java, Python, JavaScript, TypeScript, Go, Rust, C/C++, PHP, Ruby, Swift, Kotlin, Scala, Database, Cloud, Security, API, Web, Mobile, DevOps
- 组合 name 和 displayName 进行关键词匹配
- 未推断出技术栈时返回空数组（表示通用 Skill）

### 辅助函数
1. **createMergeRequest(options)** → 创建合并请求（用于跨用户合并）
   - 创建 pending 状态的 SkillMergeRecord
   - 设置 sourceOwnerConsent 和 targetOwnerConsent

2. **approveMergeRequest(mergeRecordId, userId, isSourceOwner)** → 批准合并请求
   - 更新同意状态
   - 所有方同意后自动更新状态为 approved

3. **revertMerge(mergeRecordId, userId)** → 撤销合并
   - 标记合并后的 Skill 为废弃（isLatest=false）
   - 恢复原 Skills 的 isLatest=true
   - 更新合并记录状态为 reverted

4. **getMergeHistory(skillId)** → 获取合并历史
   - 查询 sourceSkillId 或 targetSkillId 匹配的记录

5. **getPendingMergeRequests(userId)** → 获取待处理的合并请求
   - 查询 status='pending' 的记录
   - 可按 userId 筛选用户相关的请求

6. **checkMergeCompatibility(targetSkillId, sourceSkillIds)** → 检查合并兼容性
   - 检查 Skills 是否存在
   - 检查是否为最新版本
   - 检查是否为内置 Skill（不能合并）
   - 检查是否跨用户（需要同意）
   - 检查是否已在待处理合并中

### 设计原则
- 不删除原 Skills（Soft Deprecation：isLatest=false）
- 不阻断版本链（parentId 引用保持完整）
- 跨用户合并需要同意（sourceOwnerConsent + targetOwnerConsent）
- 审计记录完整（MergeDetails JSON 存储所有原始信息）
- 支持撤销合并（revertMerge 恢复原状态）

### 参考来源
- createSkillVersion 模式: src/services/skills.ts:253-340
- rollbackSkillVersion 模式: src/services/skills.ts:345-429
- saveSkillToDisk 模式: src/services/skill-files.ts:129-201
- SkillMergeRecord 模型: prisma/schema.prisma:845-880
- Skill 模型版本字段: prisma/schema.prisma:629-633

### 验证结果
- TypeScript 编译无错误（skill-merge.ts）
- Build 有预存错误（ralph-loop-agent-wrapper.ts，非本次修改）
- 所有合并策略实现完整

- 2026-04-16T20:00: Skill merge execution service created successfully

## 合并版本管理 (Wave 18)

### 版本链验证结果
位置: `src/services/skill-merge.ts`

1. **版本号递增** ✓
   - content-merge: `version = maxVersion + 1` (Line 209-210)
   - replace: `version = targetSkill.version + 1` (Line 349)
   - techStack-split: `version = skill.version + 1` (Line 512)

2. **parentId 引用** ✓
   - content-merge: `parentId = targetSkill.id` (Line 227)
   - replace: `parentId = targetSkill.id` (Line 376)
   - techStack-split: `parentId = skill.id` (Line 535)

3. **isLatest 标记** ✓
   - 合并后的 Skill: `isLatest = true`
   - 废弃的原 Skills: `isLatest = false`
   - 所有策略都正确处理 isLatest 状态

4. **版本链可追溯** ✓
   - 通过 parentId 可以追溯到原始 Skill
   - 版本链完整，无断裂

### SkillMergeRecord 创建验证
位置: `src/services/skill-merge.ts`

1. **记录创建完整** ✓
   - content-merge: 为每个源 Skill 和目标 Skill 创建记录 (Lines 282-316)
   - replace: 为每个源 Skill 创建记录 (Lines 420-438)
   - techStack-split: 创建一条主记录 (Lines 576-589)

2. **字段完整性** ✓
   - sourceSkillId: 源 Skill ID
   - targetSkillId: 目标 Skill ID
   - mergeReason: 合并原因
   - mergeDetails: JSON 存储完整合并信息
   - status: 'completed'
   - mergedBy: 执行用户 ID
   - mergedAt: 合并时间
   - completedAt: 完成时间
   - sourceOwnerConsent/targetOwnerConsent: 同意状态

### 新增功能

1. **观测统计更新** ✓
   - 新增导入: `aggregateObservationStats` from skill-observation-stats.ts
   - 新增函数: `updateObservationStatsAfterMerge(mergedSkillId, affectedSkillIds)`
   - 合并后自动更新观测统计
   - 撤销合并后也更新观测统计
   - 错误处理不阻断主流程

2. **版本历史查询** ✓
   - 新增函数: `getSkillVersionHistory(skillId)` → Skill[]
   - 返回指定 Skill 的所有版本链（从最新到最旧）
   - 通过 parentId 链遍历历史版本
   - 支持从任意版本开始查询

3. **完整合并历史** ✓
   - 新增函数: `getFullMergeHistory(skillId)` → { asSource, asTarget, allRecords }
   - 返回作为源 Skill 和目标 Skill 的所有合并记录
   - 合并并去重所有记录

### 设计原则
- 观测统计更新失败不影响合并结果（catch 错误仅记录日志）
- 版本链完整可追溯（parentId 引用保持完整）
- Soft Deprecation（isLatest=false，不删除原 Skills）
- 审计记录完整（MergeDetails JSON 存储所有原始信息）

### 验证结果
- TypeScript 编译无错误
- Build 成功（npm run build）
- 所有版本管理功能实现完整

- 2026-04-16T21:00: Merge version management completed successfully

## 合并API (Wave 16)

### 新增 API 路由
位置: `src/app/api/skills/merge/route.ts`

### POST Handler - 执行合并操作

**请求体结构**:
```typescript
{
  strategy: 'content-merge' | 'replace' | 'techStack-split',
  targetSkillId: string,
  sourceSkillIds: string[],
  mergeReason: string,
  newSkillName?: string,
  newSkillDisplayName?: string
}
```

**响应结构**:
```typescript
{
  success: boolean,
  mergedSkill?: Skill,
  deprecatedSkills?: Skill[],
  updatedSkills?: Skill[],
  mergeRecord?: SkillMergeRecord,
  warnings?: string[]
}
```

**处理流程**:
1. 认证和权限检查（SKILL_UPDATE）
2. 解析请求体并验证必填字段
3. 验证策略类型（content-merge | replace | techStack-split）
4. 检查合并兼容性（checkMergeCompatibility）
5. 执行合并（executeSkillMerge）
6. 记录审计日志
7. 返回成功结果

**错误处理**:
- 400: 缺少必填字段、无效策略、兼容性检查失败
- 401: 未授权
- 403: 无权限
- 500: 服务器内部错误

### GET Handler - 获取合并候选

**查询参数**:
- limit: 返回数量限制（默认20）
- minOverlapScore: 最小重叠分数（默认0.75）
- page: 页码（默认1）

**响应结构**:
```typescript
{
  candidates: Array<{
    skillId: string,
    skillName: string,
    skillDisplayName: string,
    category: string,
    techStack: string[],
    similarSkills: Array<{
      skillId: string,
      skillName: string,
      skillDisplayName: string,
      overlapScore: number,
      overlapType: string
    }>,
    overlapScore: number,
    recommendation: 'merge' | 'techStack-split' | 'manual-review'
  }>,
  pendingMergeRecords: SkillMergeRecord[],
  summary: {
    totalCandidates: number,
    pendingCount: number,
    highOverlapCount: number
  },
  pagination: { page, limit, total, totalPages }
}
```

**处理流程**:
1. 认证和权限检查（SKILL_READ）
2. 解析查询参数
3. 获取高频重叠对（getFrequentOverlapPairs）
4. 筛选符合条件的重叠对
5. 构建 Skill 信息 Map
6. 构建合并候选列表（按技能分组重叠对）
7. 推断推荐操作（merge/techStack-split/manual-review）
8. 按重叠分数排序并分页
9. 获取待处理的合并记录
10. 返回结果

**推荐操作推断逻辑**:
- overlapScore >= 0.85 → 'merge'
- overlapType === 'techStack-overlap' → 'techStack-split'
- 其他 → 'manual-review'

### 权限检查
- POST: PERMISSIONS.SKILL_UPDATE
- GET: PERMISSIONS.SKILL_READ

### Logger 使用注意事项
- `logger.infoWithUser` 不存在，应使用 `logger.create` 或 `logger.info`
- `logger.access` 参数顺序: (module, payload, resource, details)
- payload 是 JWTPayload 类型，不是 string

### 验证结果
- TypeScript 编译无错误
- Build 成功（npm run build）
- API 路由实现完整

- 2026-04-16T22:00: Skills merge API created successfully

## 合并操作UI页面 (Wave 17)

### 新增页面文件
位置: `src/app/dashboard/admin/skills-governance/merge/page.tsx`

### 页面功能
1. **合并候选快速选择**
   - 显示前6个合并候选
   - 点击候选自动填充目标 Skill 和源 Skills
   - 根据推荐自动选择策略（merge → content-merge, techStack-split → techStack-split）

2. **策略选择组件**
   - 三种策略卡片式展示：
     - content-merge（内容合并）：紫色主题，GitMerge 图标
     - replace（替代合并）：蓝色主题，Replace 图标
     - techStack-split（技术栈区分）：绿色主题，ArrowRightLeft 图标
   - 每个策略显示描述和详细说明
   - 点击卡片切换策略

3. **目标/源选择组件**
   - 搜索框：实时搜索 Skills（300ms 防抖）
   - 搜索结果下拉列表：点击选择目标或源
   - 目标 Skill 显示区：蓝色背景，显示名称、分类、技术栈
   - 源 Skills 显示区：紫色背景，支持多选，显示列表
   - 新 Skill 名称输入（content-merge 策略）：可选填写新名称和显示名

4. **合并原因选择**
   - 四种原因按钮：高度相似、重复检测、整合优化、用户请求
   - 点击按钮切换原因

5. **预览组件**
   - 兼容性检查按钮：调用 POST /api/skills/merge 检查兼容性
   - 问题显示区：红色背景，列出必须解决的问题
   - 警告显示区：黄色背景，列出建议关注的警告
   - 合并预览摘要：绿色背景，显示策略、目标、源、原因
   - 执行后效果说明：列出具体会发生的变化

6. **执行按钮**
   - 禁用条件：未完成步骤 1-3 或兼容性检查未通过
   - 点击弹出确认对话框
   - 确认对话框：显示合并详情和警告提示
   - 执行成功后显示结果，2秒后跳转到合并后的 Skill 详情页

### 类型定义
```typescript
interface MergeCandidate {
  skillId: string;
  skillName: string;
  skillDisplayName: string;
  category: string;
  techStack: string[];
  similarSkills: Array<{
    skillId: string;
    skillName: string;
    skillDisplayName: string;
    overlapScore: number;
    overlapType: string;
  }>;
  overlapScore: number;
  recommendation: 'merge' | 'techStack-split' | 'manual-review';
}

interface SkillInfo {
  id: string;
  name: string;
  displayName: string;
  category: string;
  techStack: string[];
  version: number;
  isLatest: boolean;
  content?: string;
}

interface CompatibilityCheck {
  compatible: boolean;
  issues: string[];
  warnings: string[];
}

interface MergeResult {
  success: boolean;
  mergedSkill?: SkillInfo;
  deprecatedSkills?: SkillInfo[];
  updatedSkills?: SkillInfo[];
  mergeRecord?: { id: string; status: string };
  warnings?: string[];
  error?: string;
}
```

### UI 组件模式
- 策略卡片：border-2 + cursor-pointer + transition-all + 颜色主题
- 搜索框：relative + Search 图标 + 防抖搜索
- Skill 显示区：p-4 + bg-blue-50/purple-50 + border + rounded-lg
- 状态徽章：px-2 py-1 text-xs rounded-full + bg/text 颜色组合
- 确认对话框：fixed inset-0 bg-black bg-opacity-50 + z-50 + max-w-md

### 重叠分数颜色标识
- ≥85%: 红色 + 加粗 (text-red-600 font-bold)
- ≥75%: 橙色 (text-orange-600)
- ≥60%: 黄色 (text-yellow-600)
- <60%: 绿色 (text-green-600)

### API 调用
- GET /api/skills/merge?limit=50 → 获取合并候选
- GET /api/skills?search=...&limit=20 → 搜索 Skills
- POST /api/skills/merge → 执行合并（含兼容性检查）

### 路由跳转
- 返回总览: `/dashboard/admin/skills-governance`
- 查看全部候选: `/dashboard/admin/skills-governance/merge-candidates`
- 合并后跳转: `/dashboard/skills/${mergedSkill.id}`

### 注意事项
- lucide-react 没有 Separate 图标，使用 ArrowRightLeft 替代
- 兼容性检查通过 POST API 实现（API 内部调用 checkMergeCompatibility）
- 执行成功后自动跳转，使用 setTimeout 2秒延迟
- 确认对话框使用 fixed 定位覆盖全屏

### 验证结果
- TypeScript 编译无错误
- Build 成功（npm run build）
- 页面路由: `/dashboard/admin/skills-governance/merge`

- 2026-04-16T23:00: Merge operation UI page created successfully 
 # #   CgP�ibU\  ( W a v e   2 1 )  
  
 # # #   �e�XCgP�8^ϑ 
 MOn:   s r c / t y p e s / p e r m i s s i o n s . t s  
  
 �e�X4 *N  S k i l l s   G o v e r n a n c e   CgP�:  
 -   S K I L L _ G O V E R N A N C E _ R E A D :   ' s k i l l - g o v e r n a n c e : r e a d '   -   �gw�lt�Nh�g�T�~�� 
 -   S K I L L _ G O V E R N A N C E _ U P D A T E :   ' s k i l l - g o v e r n a n c e : u p d a t e '   -   �f�e�ltM�n0nx����f� 
 -   S K I L L _ M E R G E :   ' s k i l l : m e r g e '   -   gbL�  S k i l l   Tv^�d\O 
 -   S K I L L _ A P P R O V E :   ' s k i l l : a p p r o v e '   -   yb�Q�_Yt�vTv^��Bl��(u7b	� 
  
 # # #   CgP�<h_ 
 -   �ltCgP�:   s k i l l - g o v e r n a n c e : a c t i o n ��r�z!jWW	� 
 -   �d\OCgP�:   s k i l l : a c t i o n �ibU\�s	g  S k i l l   !jWW	� 
  
 # # #   �����~�g 
 -   T y p e S c r i p t   ы�e�� 
 -   B u i l d   b�R�n p m   r u n   b u i l d 	� 
 -   CgP�8^ϑ�]�m�R0R  P E R M I S S I O N S   �[a� 
  
 -   2 0 2 6 - 0 4 - 1 6 T 2 2 : 0 0 :   S k i l l s   G o v e r n a n c e   p e r m i s s i o n s   e x t e n d e d   s u c c e s s f u l l y  
  
 ## 治理过滤日志服务 (Wave 20)

### 新增服务文件
位置: `src/services/skill-governance-filter-log.ts`

### 核心类型定义
1. **FilterReason** - 过滤原因类型
   - 枚举: 'deprecated' | 'merged' | 'pending-merge'

2. **FilteredSkillInfo** - 过滤�?Skill 信息
   - skillId, skillName, reason, mergedInto(可�?

3. **LogGovernanceFilterParams** - 过滤日志参数
   - evaluationId, projectId, filteredSkills, userId(可�?, timestamp(可�?

4. **GovernanceFilterLogResult** - 日志创建结果
   - success, logId(可�?, error(可�?

5. **GovernanceFilterLogDetails** - 日志详情（存储在 AuditLog.details�?   - evaluationId, projectId, filteredSkills, timestamp

6. **RetrievedGovernanceFilterLog** - 查询到的过滤日志
   - id, userId, action, resource, details, ipAddress, userAgent, createdAt

### 核心函数
1. **logGovernanceFilter(params)** �?GovernanceFilterLogResult
   - 使用 AuditLog 表存储过滤日�?   - action: 'governance_filter'
   - resource: `evaluation:${evaluationId}`
   - details: JSON.stringify(GovernanceFilterLogDetails)
   - 无过�?Skills 时不记录（返�?success: true�?   - 错误不阻断主流程（返�?success: false�?
2. **getGovernanceFilterLogs(evaluationId)** �?RetrievedGovernanceFilterLog[]
   - 查询指定评估的所有过滤日�?   - 解析 details JSON 字段
   - �?createdAt DESC 排序

3. **getProjectFilterHistory(projectId, limit)** �?RetrievedGovernanceFilterLog[]
   - 查询指定项目的所有过滤日�?   - 过滤 details JSON �?projectId 匹配的记�?   - 默认返回 50 �?
4. **getSkillFilterHistory(skillId, limit)** �?Skill 过滤记录列表
   - 查询指定 Skill 被过滤的历史
   - 返回: evaluationId, projectId, reason, mergedInto, timestamp, logCreatedAt

5. **getFilterReasonStats(projectId?)** �?过滤原因统计
   - 统计 deprecated, merged, pendingMerge 的数�?   - 可按项目筛选或全局统计

6. **batchLogGovernanceFilter(paramsList)** �?批量创建结果
   - 批量记录多个过滤日志
   - 返回: successCount, failedCount, logIds, errors

### 存储模式
使用 AuditLog 表存储，不创建新�?Prisma 模型:
```typescript
await prisma.auditLog.create({
  data: {
    userId: userId || null,
    action: 'governance_filter',
    resource: `evaluation:${evaluationId}`,
    details: JSON.stringify({
      projectId,
      filteredSkills,
      timestamp: new Date().toISOString()
    })
  }
});
```

### 设计原则
- 不创建新�?Prisma 模型（复�?AuditLog�?- 错误处理不阻断主流程（所有函数都�?try-catch�?- 使用静态类方法模式（SkillGovernanceFilterLogService�?- JSON 字段使用 JSON.stringify 存储
- 无过�?Skills 时不记录日志

### 导出便捷函数
```typescript
export const logGovernanceFilter = SkillGovernanceFilterLogService.logGovernanceFilter;
export const getGovernanceFilterLogs = SkillGovernanceFilterLogService.getGovernanceFilterLogs;
export const getProjectFilterHistory = SkillGovernanceFilterLogService.getProjectFilterHistory;
export const getSkillFilterHistory = SkillGovernanceFilterLogService.getSkillFilterHistory;
export const getFilterReasonStats = SkillGovernanceFilterLogService.getFilterReasonStats;
export const batchLogGovernanceFilter = SkillGovernanceFilterLogService.batchLogGovernanceFilter;
```

### Prisma Schema 修复
修复�?SkillMergeRecord 模型的关系定�?
- 新增 sourceSkill �?targetSkill 关系字段
- 使用 @relation("SkillMergeSource") �?@relation("SkillMergeTarget")
- Skill 模型新增 mergeRecordsAsSource �?mergeRecordsAsTarget 关系

### 参考来�?- AuditLogger 模式: src/lib/audit/logger.ts
- SkillObservationLogService 模式: src/services/skill-observation-log.ts
- AuditLog 模型: prisma/schema.prisma

### 验证结果
- TypeScript 编译无错�?- Build 成功（npm run build�?- Prisma client 重新生成成功

- 2026-04-16T21:30: Governance filter log service created successfully

## 治理过滤 (Wave 19)

### 修改文件
位置: `src/services/skill-files.ts`

### 新增导入
```typescript
import { prisma } from '@/lib/prisma';
```

### 新增类型定义
```typescript
export interface FilteredSkillInfo {
  skillId: string;
  skillName: string;
  reason: 'deprecated' | 'merged' | 'pending_merge';
  mergedInto?: string;  // 合并目标 Skill 名称（仅 merged 时）
}
```

### 扩展 CopyResult 接口
```typescript
export interface CopyResult {
  success: number;
  failed: number;
  errors: string[];
  copiedSkills: string[];
  filteredSkills?: FilteredSkillInfo[];  // 治理过滤的 Skills
}
```

### 治理过滤逻辑
植入点: 技术栈过滤后（约 line 365），拷贝逻辑前

过滤规则:
1. **deprecated**: `isLatest = false` → Skill 已废弃，跳过
2. **merged**: 有 `completed` SkillMergeRecord → Skill 已合并到其他 Skill，跳过
3. **pending_merge**: 有 `pending` SkillMergeRecord → Skill 正在合并流程中，跳过

实现逻辑:
```typescript
// 查询数据库中的 Skill 记录
const dbSkill = await prisma.skill.findUnique({
  where: { id: metadata.id },
  select: { id: true, name: true, displayName: true, isLatest: true },
});

if (dbSkill) {
  // 检查是否废弃
  if (!dbSkill.isLatest) {
    result.filteredSkills.push({ skillId, skillName, reason: 'deprecated' });
    continue;
  }
  
  // 检查是否已合并
  const completedMergeRecords = await prisma.skillMergeRecord.findMany({
    where: { sourceSkillId: metadata.id, status: 'completed' },
  });
  if (completedMergeRecords.length > 0) {
    // 手动查询目标 Skill 名称
    const targetSkill = await prisma.skill.findUnique({
      where: { id: mergeRecord.targetSkillId },
      select: { name: true, displayName: true },
    });
    result.filteredSkills.push({ skillId, skillName, reason: 'merged', mergedInto: targetSkillName });
    continue;
  }
  
  // 检查是否有待处理的合并请求
  const pendingMergeRecords = await prisma.skillMergeRecord.findMany({
    where: {
      OR: [
        { sourceSkillId: metadata.id, status: 'pending' },
        { targetSkillId: metadata.id, status: 'pending' },
      ],
    },
  });
  if (pendingMergeRecords.length > 0) {
    result.filteredSkills.push({ skillId, skillName, reason: 'pending_merge' });
    continue;
  }
}
```

### 日志输出
- `[SkillFiles] 治理过滤: ${metadata.name} 已废弃 (isLatest=false)`
- `[SkillFiles] 治理过滤: ${metadata.name} 已合并到 ${targetSkillName}`
- `[SkillFiles] 治理过滤: ${metadata.name} 正在合并流程中 (${pendingMergeRecords.length} 个待处理请求)`
- `[SkillFiles] 治理过滤查询失败: ${metadata.name}` (错误时)

### 设计原则
- 治理过滤失败不阻断拷贝流程（try-catch 包裹）
- 使用 metadata.id 查询数据库 Skill 记录
- SkillMergeRecord 模型无 Skill 关系，需手动查询目标 Skill
- 返回 filteredSkills 数组供调用方使用

### 注意事项
- SkillMergeRecord 模型没有定义 Skill 关系（只有 sourceSkillId/targetSkillId 字段）
- 需要手动查询目标 Skill 信息
- 治理过滤在技术栈过滤之后执行
- 过滤结果不影响 success/failed 计数（仅记录在 filteredSkills）

### 验证结果
- TypeScript 编译无错误
- Build 成功（npm run build）
- 治理过滤逻辑实现完整

- 2026-04-16T22:00: Governance filter in copySkillsToProject completed successfully

---

## Plan Compliance Audit (F1) - 2026-04-16 Final

### VERDICT: ✅ APPROVE

All plan requirements verified and implemented correctly.

### 必须有 Verification Summary

| # | Requirement | Status | Evidence Location |
|---|-------------|--------|-------------------|
| 1 | 功能重复检测逻辑（三层） | ✅ PASS | `skill-similarity.ts:131-413` |
| 2 | 实时预警机制 | ✅ PASS | `match/route.ts:89-145` |
| 3 | 观测统计聚合 | ✅ PASS | `skill-observation-stats.ts:125-257` |
| 4 | 合并执行流程 | ✅ PASS | `skill-merge.ts:163-622` |
| 5 | 管理员Dashboard | ✅ PASS | `skills-governance/page.tsx + merge/page.tsx` |

### 必须没有 Verification Summary

| # | Guardrail | Status | Evidence |
|---|-----------|--------|----------|
| 1 | 不能阻止Skill创建 | ✅ PASS | `route.ts:285` - skill created, warnings advisory |
| 2 | 不能阻断编排流程 | ✅ PASS | `match/route.ts:286-324` - matches + warning together |
| 3 | 不能删除原Skills | ✅ PASS | `skill-merge.ts:239-256` - isLatest=false only |
| 4 | 不能强制合并 | ✅ PASS | `merge/route.ts:54` - requires SKILL_UPDATE permission |
| 5 | 不能自动合并 | ✅ PASS | `merge/page.tsx:958-997` - confirmation dialog required |

### Commit Wave Alignment

| Wave | Commit Hash | Description |
|------|-------------|-------------|
| 1 | 8e56f5c1 | governance data models and core services |
| 2 | 403f98b1 | creation and orchestration governance warnings |
| 3 | 1ffc6a42 | observation module API and dashboard |
| 4 | 8bc34f27 | merge execution service and UI |
| 5 | 5999c310 | governance filter for evaluation startup |

### Guardrails Violation Search Results

- `skill.delete` / `deleteMany`: **None found** ✅
- `autoMerge` / `auto.*merge`: **None found** ✅
- `forceMerge` / `force.*merge`: **None found** ✅

### Data Models Verified

All governance models present in `prisma/schema.prisma`:
- SkillObservationLog (Line 748)
- SkillObservationStats (Line 782)
- SkillNewImpactAnalysis (Line 816)
- SkillMergeRecord (Line 850)
- SkillGovernanceConfig (Line 891)

### Final Conclusion

The Skills Governance System implementation fully complies with the plan specifications. All mandatory features are present, all guardrails are respected, and the commit history aligns with the planned execution waves.
