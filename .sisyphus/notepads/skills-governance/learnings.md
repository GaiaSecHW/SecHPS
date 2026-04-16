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