# AI 漏洞挖掘平台 - Phase 1: 数据层基础 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立完整的数据模型和核心 API 路由，为后续功能模块提供数据基础。

**Architecture:** 扩展现有 Prisma schema 添加 11 个新模型，创建对应的 API 路由实现 CRUD 操作，遵循现有项目的 Next.js App Router + Prisma + SQLite 技术栈。

**Tech Stack:** Next.js 16 App Router, Prisma ORM, SQLite, TypeScript, React 19

---

## 文件结构

```
prisma/
├── schema.prisma              # 修改：添加新模型
└── seed-skills.ts             # 新增：Skills 种子数据

src/
├── types/
│   └── skills.ts              # 新增：Skills 类型定义
│   └── vulnerability.ts        # 新增：漏洞类型定义
│   └── scan.ts                 # 新增：扫描类型定义
│   └── code.ts                 # 新增：代码理解类型定义
│
├── app/api/
│   ├── skills/
│   │   ├── route.ts            # 新增：GET/POST Skills
│   │   ├── categories/route.ts # 新增：GET 分类列表
│   │   └── [id]/
│   │       ├── route.ts        # 新增：GET/PUT/DELETE Skill
│   │       ├── duplicate/route.ts  # 新增：POST 复制
│   │       ├── executions/route.ts # 新增：GET 执行历史
│   │       ├── test/route.ts   # 新增：POST 测试
│   │       ├── evolve/route.ts # 新增：POST 进化
│   │       ├── evolutions/route.ts # 新增：GET 进化历史
│   │       └── feedback/route.ts  # 新增：POST 反馈
│   │
│   ├── vulnerabilities/
│   │   ├── route.ts            # 新增：GET/POST 漏洞
│   │   ├── stats/route.ts      # 新增：GET 统计
│   │   ├── export/route.ts     # 新增：GET 导出
│   │   └── [id]/
│   │       ├── route.ts        # 新增：GET/PUT/DELETE 漏洞
│   │       ├── confirm/route.ts    # 新增：POST 确认
│   │       ├── false-positive/route.ts # 新增：POST 误报
│   │       ├── fix/route.ts        # 新增：POST 修复
│   │       └── verify/route.ts     # 新增：POST 验证
│   │
│   ├── patterns/
│   │   ├── route.ts            # 新增：GET/POST 模式
│   │   ├── categories/route.ts # 新增：GET 分类
│   │   └── [id]/
│   │       ├── route.ts        # 新增：GET/PUT/DELETE 模式
│   │       └── skills/route.ts # 新增：GET 关联 Skills
│   │
│   ├── scans/
│   │   ├── route.ts            # 新增：GET/POST 扫描任务
│   │   └── [id]/
│   │       ├── route.ts        # 新增：GET/PUT/DELETE 任务
│   │       ├── start/route.ts  # 新增：POST 启动
│   │       ├── cancel/route.ts # 新增：POST 取消
│   │       ├── progress/route.ts # 新增：GET 进度(SSE)
│   │       └── reports/
│   │           ├── route.ts    # 新增：GET 报告列表
│   │           └── export/route.ts # 新增：POST 导出
│   │
│   ├── code/
│   │   ├── analyze/route.ts    # 新增：POST 分析项目
│   │   └── [projectId]/
│   │       ├── structure/route.ts  # 新增：GET 项目结构
│   │       ├── knowledge/route.ts  # 新增：GET 代码知识
│   │       ├── graph/route.ts      # 新增：GET 调用图
│   │       ├── dataflow/route.ts   # 新增：GET 数据流
│   │       └── search/route.ts     # 新增：GET 搜索实体
│   │
│   ├── tools/
│   │   ├── route.ts            # 新增：GET 工具列表
│   │   └── [id]/
│   │       ├── route.ts        # 新增：GET 工具详情
│   │       ├── execute/route.ts    # 新增：POST 执行
│   │       └── validate/route.ts   # 新增：POST 验证参数
│   │
│   └── agent/
│       ├── execute/route.ts    # 新增：POST 执行 Skill
│       ├── chat/route.ts       # 新增：POST 与 Agent 对话
│       └── executions/
│           └── [id]/
│               ├── route.ts    # 新增：GET 执行状态
│               └── cancel/route.ts # 新增：POST 取消
│
└── lib/
    ├── services/
    │   ├── skill.service.ts    # 新增：Skill 业务逻辑
    │   ├── vulnerability.service.ts # 新增：漏洞业务逻辑
    │   ├── pattern.service.ts  # 新增：模式业务逻辑
    │   ├── scan.service.ts     # 新增：扫描业务逻辑
    │   └── code.service.ts     # 新增：代码分析业务逻辑
    │
    └── tools/
        ├── index.ts            # 新增：工具注册
        ├── read-file.ts        # 新增：读取文件工具
        ├── write-file.ts       # 新增：写入文件工具
        ├── search-pattern.ts   # 新增：搜索模式工具
        ├── list-directory.ts   # 新增：列出目录工具
        └── parse-code.ts       # 新增：解析代码工具
```

---

## Task 1: 更新 Prisma Schema - 基础模型

**Files:**
- Modify: `prisma/schema.prisma`

**添加新模型到 schema 文件末尾（在 RouterConfig 之后）：**

- [ ] **Step 1: 添加 Skill 模型**

```prisma
// ============================================
// AI 漏洞挖掘平台 - Skills 系统
// ============================================

// Skill 定义
model Skill {
  id          String   @id @default(cuid())
  name        String   @unique
  displayName String
  description String
  category    String   // code-audit, auth, sensitive, api, config, crypto, web, business, client, cloud
  cwe         String?  // CWE 编号，如 CWE-89
  severity    String   // critical, high, medium, low, info
  
  // Prompt 定义
  systemPrompt String  // 系统提示词
  userPrompt   String  // 用户提示词模板（支持变量）
  
  // 工具和参数
  tools       String   // JSON: ["read_file", "search_pattern"]
  parameters  String   // JSON: 参数定义
  
  // 状态
  isActive    Boolean  @default(true)
  isBuiltin   Boolean  @default(true)  // 是否内置（不可删除）
  version     Int      @default(1)
  
  // 进化相关
  successRate Float?   // 成功率
  avgDuration Int?     // 平均执行时间（毫秒）
  execCount   Int      @default(0)     // 执行次数
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // 关系
  executions  SkillExecution[]
  evolutions  SkillEvolution[]
  
  @@index([category])
  @@index([isActive])
}
```

- [ ] **Step 2: 添加 SkillExecution 模型**

```prisma
// Skill 执行记录
model SkillExecution {
  id          String   @id @default(cuid())
  skillId     String
  projectId   String
  scanTaskId  String?
  
  // 输入输出
  input       String   // JSON: 输入参数
  output      String?  // JSON: 输出结果
  
  // 执行状态
  status      String   @default("pending") // pending, running, completed, failed, cancelled
  startedAt   DateTime?
  completedAt DateTime?
  duration    Int?     // 执行时长（毫秒）
  error       String?
  
  // 结果
  findingsCount   Int @default(0)  // 发现数量
  confirmedCount  Int @default(0)  // 确认数量
  falsePositiveCount Int @default(0) // 误报数量
  
  // Token 使用
  inputTokens  Int?
  outputTokens Int?
  
  createdAt   DateTime @default(now())
  
  // 关系
  skill       Skill    @relation(fields: [skillId], references: [id], onDelete: Cascade)
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  scanTask    ScanTask? @relation(fields: [scanTaskId], references: [id], onDelete: SetNull)
  vulnerabilities Vulnerability[]
  
  @@index([skillId])
  @@index([projectId])
  @@index([status])
  @@index([createdAt])
}
```

- [ ] **Step 3: 添加 SkillEvolution 模型**

```prisma
// Skill 进化记录
model SkillEvolution {
  id          String   @id @default(cuid())
  skillId     String
  
  // 版本信息
  fromVersion Int
  toVersion   Int
  
  // 变更内容
  changeType  String   // prompt-update, parameter-tune, tool-add, tool-remove
  changeDesc  String   // 变更描述
  beforeData  String   // JSON: 变更前数据
  afterData   String   // JSON: 变更后数据
  
  // 变更原因
  reason      String   // 手动调整 | 自动优化 | 误报反馈 | 漏报反馈
  
  // 效果评估
  beforeRate  Float?   // 变更前成功率
  afterRate   Float?   // 变更后成功率
  
  createdAt   DateTime @default(now())
  
  skill       Skill    @relation(fields: [skillId], references: [id], onDelete: Cascade)
  
  @@index([skillId])
  @@index([createdAt])
}
```

- [ ] **Step 4: 运行 Prisma 迁移**

```bash
npx prisma migrate dev --name add_skills_system
```

Expected output:
```
Applying migration `20250403_add_skills_system`
The following migration(s) have been created and applied:
prisma/migrations/.../migration.sql
```

- [ ] **Step 5: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add Skill, SkillExecution, SkillEvolution models"
```

---

## Task 2: 更新 Prisma Schema - 漏洞管理模型

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 添加 Vulnerability 模型**

```prisma
// ============================================
// 漏洞管理
// ============================================

// 漏洞记录
model Vulnerability {
  id          String   @id @default(cuid())
  projectId   String
  skillExecutionId String?
  
  // 基本信息
  title       String
  description String
  type        String   // SQL注入, XSS, 等等
  cwe         String?  // CWE 编号
  severity    String   // critical, high, medium, low, info
  
  // 位置信息
  filePath    String?
  lineStart   Int?
  lineEnd     Int?
  codeSnippet String?  // 漏洞代码片段
  
  // 详情
  details     String?  // JSON: 详细信息
  aiAnalysis  String?  // AI 分析结果
  fixSuggestion String? // 修复建议
  
  // 状态管理
  status      String   @default("new") // new, confirmed, false-positive, fixed, verified, closed
  confirmedBy String?  // 确认人
  confirmedAt DateTime?
  fixedBy     String?  // 修复人
  fixedAt     DateTime?
  verifiedBy  String?  // 验证人
  verifiedAt  DateTime?
  
  // 备注
  notes       String?  // 处理备注
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // 关系
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  execution   SkillExecution? @relation(fields: [skillExecutionId], references: [id], onDelete: SetNull)
  
  @@index([projectId])
  @@index([status])
  @@index([severity])
  @@index([type])
  @@index([createdAt])
}
```

- [ ] **Step 2: 添加 VulnerabilityPattern 模型**

```prisma
// 漏洞模式库
model VulnerabilityPattern {
  id          String   @id @default(cuid())
  
  // 基本信息
  name        String   @unique
  displayName String
  description String
  category    String
  
  // CWE/CVE 映射
  cwe         String?
  cve         String?
  
  // 检测规则
  patterns    String   // JSON: 检测模式列表
  languages   String   // JSON: 适用语言
  
  // 示例
  exampleVulnerable String? // 漏洞示例代码
  exampleFixed      String? // 修复示例代码
  
  // 修复建议
  fixGuidance String?  // 修复指导
  
  // 状态
  isActive    Boolean  @default(true)
  isBuiltin   Boolean  @default(true)
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([category])
  @@index([isActive])
}
```

- [ ] **Step 3: 运行 Prisma 迁移**

```bash
npx prisma migrate dev --name add_vulnerability_models
```

- [ ] **Step 4: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add Vulnerability and VulnerabilityPattern models"
```

---

## Task 3: 更新 Prisma Schema - 扫描任务模型

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 添加 ScanTask 模型**

```prisma
// ============================================
// 自动化扫描
// ============================================

// 扫描任务
model ScanTask {
  id          String   @id @default(cuid())
  projectId   String
  userId      String
  
  // 任务配置
  name        String
  description String?
  skillIds    String   // JSON: 选中的 Skill ID 列表
  
  // 调度配置
  schedule    String?  // cron 表达式，null 表示手动触发
  nextRunAt   DateTime?
  
  // 执行状态
  status      String   @default("pending") // pending, running, completed, failed, cancelled
  startedAt   DateTime?
  completedAt DateTime?
  progress    Int      @default(0) // 0-100
  currentSkill String? // 当前执行的 Skill
  
  // 统计
  totalSkills    Int   @default(0)
  completedSkills Int  @default(0)
  findingsCount   Int  @default(0)
  
  // 错误信息
  error       String?
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // 关系
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  executions  SkillExecution[]
  reports     ScanReport[]
  
  @@index([projectId])
  @@index([status])
  @@index([createdAt])
}
```

- [ ] **Step 2: 添加 ScanReport 模型**

```prisma
// 扫描报告
model ScanReport {
  id          String   @id @default(cuid())
  scanTaskId  String
  projectId   String
  
  // 报告内容
  summary     String   // JSON: 摘要统计
  details     String   // JSON: 详细结果
  
  // 导出格式
  format      String   @default("json") // json, pdf, html, sarif
  
  createdAt   DateTime @default(now())
  
  scanTask    ScanTask @relation(fields: [scanTaskId], references: [id], onDelete: Cascade)
  
  @@index([scanTaskId])
  @@index([projectId])
}
```

- [ ] **Step 3: 运行 Prisma 迁移**

```bash
npx prisma migrate dev --name add_scan_models
```

- [ ] **Step 4: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add ScanTask and ScanReport models"
```

---

## Task 4: 更新 Prisma Schema - 代码理解模型

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 添加 ProjectStructure 模型**

```prisma
// ============================================
// 代码理解
// ============================================

// 项目结构
model ProjectStructure {
  id          String   @id @default(cuid())
  projectId   String   @unique
  
  // 结构数据
  structure   String   // JSON: 目录树结构
  fileCount   Int      @default(0)
  codeCount   Int      @default(0) // 代码文件数
  languageStats String // JSON: 语言统计
  
  // 分析状态
  status      String   @default("pending") // pending, analyzing, completed, failed
  analyzedAt  DateTime?
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@index([projectId])
}
```

- [ ] **Step 2: 添加 CodeKnowledge 模型**

```prisma
// 代码知识
model CodeKnowledge {
  id          String   @id @default(cuid())
  projectId   String
  
  // 实体信息
  entityType  String   // function, class, interface, variable, import, call
  name        String
  filePath    String
  lineStart   Int
  lineEnd     Int?
  
  // 关系
  parentId    String?  // 父实体ID（如类包含方法）
  calls       String?  // JSON: 调用的函数列表
  calledBy    String?  // JSON: 被调用的函数列表
  
  // 详情
  signature   String?  // 函数签名
  docstring   String?  // 文档字符串
  code        String?  // 代码片段
  
  // AI 分析
  summary     String?  // AI 生成的摘要
  riskScore   Float?   // 风险评分
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@index([projectId])
  @@index([entityType])
  @@index([name])
}
```

- [ ] **Step 3: 添加 DataFlow 模型**

```prisma
// 数据流记录
model DataFlow {
  id          String   @id @default(cuid())
  projectId   String
  
  // 数据流信息
  sourceId    String   // 数据源实体ID
  sinkId      String   // 数据汇实体ID
  sourceName  String
  sinkName    String
  
  // 路径
  path        String   // JSON: 数据流路径
  
  // 安全相关
  isUserInput Boolean  @default(false)
  isSensitive Boolean  @default(false)
  
  createdAt   DateTime @default(now())
  
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@index([projectId])
  @@index([sourceId])
  @@index([sinkId])
}
```

- [ ] **Step 4: 运行 Prisma 迁移**

```bash
npx prisma migrate dev --name add_code_understanding_models
```

- [ ] **Step 5: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add ProjectStructure, CodeKnowledge, DataFlow models"
```

---

## Task 5: 更新 Prisma Schema - 工具模型和关系

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 添加 Tool 模型**

```prisma
// ============================================
// 工具定义
// ============================================

// 工具定义
model Tool {
  id          String   @id @default(cuid())
  name        String   @unique
  displayName String
  description String
  category    String   // file, code, security, network, system
  
  // 工具参数定义
  parameters  String   // JSON: 参数 schema
  
  // 执行配置
  executor    String   // builtin, mcp, http, script
  executorConfig String? // JSON: 执行器配置
  
  // 安全配置
  requiresPermission Boolean @default(false)
  allowedInSandbox   Boolean @default(true)
  timeout            Int     @default(30000) // 超时时间（毫秒）
  
  // 状态
  isActive    Boolean  @default(true)
  isBuiltin   Boolean  @default(true)
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([category])
  @@index([isActive])
}
```

- [ ] **Step 2: 更新 Project 模型添加关系**

在 Project 模型中添加关系字段：

```prisma
// 在 Project 模型末尾添加（在 evaluations 关系之后）

  // 新增关系
  structures      ProjectStructure[]
  codeKnowledge   CodeKnowledge[]
  dataFlows       DataFlow[]
  scanTasks       ScanTask[]
  skillExecutions SkillExecution[]
  vulnerabilities Vulnerability[]
```

- [ ] **Step 3: 运行 Prisma 迁移**

```bash
npx prisma migrate dev --name add_tool_model_and_update_relations
```

- [ ] **Step 4: 生成 Prisma Client**

```bash
npx prisma generate
```

- [ ] **Step 5: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/ src/generated/
git commit -m "feat(db): add Tool model and update Project relations"
```

---

## Task 6: 创建类型定义文件

**Files:**
- Create: `src/types/skills.ts`
- Create: `src/types/vulnerability.ts`
- Create: `src/types/scan.ts`
- Create: `src/types/code.ts`

- [ ] **Step 1: 创建 Skills 类型定义**

```typescript
// src/types/skills.ts

export type SkillCategory = 
  | 'code-audit' 
  | 'auth' 
  | 'sensitive' 
  | 'api' 
  | 'config' 
  | 'crypto' 
  | 'web' 
  | 'business' 
  | 'client' 
  | 'cloud';

export type SkillSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type SkillExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type EvolutionChangeType = 
  | 'prompt-update' 
  | 'parameter-tune' 
  | 'tool-add' 
  | 'tool-remove';

export type EvolutionReason = 
  | '手动调整' 
  | '自动优化' 
  | '误报反馈' 
  | '漏报反馈';

// Skill 创建请求
export interface CreateSkillRequest {
  name: string;
  displayName: string;
  description: string;
  category: SkillCategory;
  cwe?: string;
  severity: SkillSeverity;
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
  parameters?: Record<string, any>;
}

// Skill 更新请求
export interface UpdateSkillRequest {
  displayName?: string;
  description?: string;
  category?: SkillCategory;
  cwe?: string;
  severity?: SkillSeverity;
  systemPrompt?: string;
  userPrompt?: string;
  tools?: string[];
  parameters?: Record<string, any>;
  isActive?: boolean;
}

// Skill 执行请求
export interface ExecuteSkillRequest {
  projectId: string;
  parameters?: Record<string, any>;
}

// Skill 执行反馈
export interface SkillFeedbackRequest {
  confirmed?: boolean;
  falsePositive?: boolean;
  comments?: string;
}

// Skill 进化请求
export interface EvolveSkillRequest {
  changeType: EvolutionChangeType;
  changeDesc: string;
  reason: EvolutionReason;
  beforeData: Record<string, any>;
  afterData: Record<string, any>;
}
```

- [ ] **Step 2: 创建漏洞类型定义**

```typescript
// src/types/vulnerability.ts

export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type VulnerabilityStatus = 
  | 'new' 
  | 'confirmed' 
  | 'false-positive' 
  | 'fixed' 
  | 'verified' 
  | 'closed';

// 漏洞创建请求（内部使用，通常由 Skill 执行创建）
export interface CreateVulnerabilityRequest {
  projectId: string;
  skillExecutionId?: string;
  title: string;
  description: string;
  type: string;
  cwe?: string;
  severity: VulnerabilitySeverity;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  codeSnippet?: string;
  details?: Record<string, any>;
  aiAnalysis?: string;
  fixSuggestion?: string;
}

// 漏洞更新请求
export interface UpdateVulnerabilityRequest {
  title?: string;
  description?: string;
  type?: string;
  cwe?: string;
  severity?: VulnerabilitySeverity;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  codeSnippet?: string;
  details?: Record<string, any>;
  aiAnalysis?: string;
  fixSuggestion?: string;
  notes?: string;
}

// 漏洞列表查询参数
export interface VulnerabilityQueryParams {
  projectId?: string;
  status?: VulnerabilityStatus;
  severity?: VulnerabilitySeverity;
  type?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

// 漏洞统计
export interface VulnerabilityStats {
  total: number;
  byStatus: Record<VulnerabilityStatus, number>;
  bySeverity: Record<VulnerabilitySeverity, number>;
  byType: Record<string, number>;
  trend: Array<{
    date: string;
    count: number;
  }>;
}
```

- [ ] **Step 3: 创建扫描类型定义**

```typescript
// src/types/scan.ts

export type ScanTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// 创建扫描任务请求
export interface CreateScanTaskRequest {
  projectId: string;
  name: string;
  description?: string;
  skillIds: string[];
  schedule?: string; // cron 表达式
}

// 更新扫描任务请求
export interface UpdateScanTaskRequest {
  name?: string;
  description?: string;
  skillIds?: string[];
  schedule?: string;
}

// 扫描进度
export interface ScanProgress {
  taskId: string;
  status: ScanTaskStatus;
  progress: number;
  currentSkill: string | null;
  totalSkills: number;
  completedSkills: number;
  findingsCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

// 扫描报告
export interface ScanReportSummary {
  totalFindings: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  bySkill: Record<string, number>;
  duration: number;
}
```

- [ ] **Step 4: 创建代码理解类型定义**

```typescript
// src/types/code.ts

export type CodeEntityType = 
  | 'function' 
  | 'class' 
  | 'interface' 
  | 'variable' 
  | 'import' 
  | 'call';

export type AnalysisStatus = 'pending' | 'analyzing' | 'completed' | 'failed';

// 项目结构分析结果
export interface ProjectStructureResult {
  structure: FileTreeNode;
  fileCount: number;
  codeCount: number;
  languageStats: Record<string, number>;
}

// 文件树节点
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  language?: string;
  size?: number;
}

// 代码知识查询参数
export interface CodeKnowledgeQueryParams {
  projectId: string;
  entityType?: CodeEntityType;
  name?: string;
  filePath?: string;
}

// 调用图节点
export interface CallGraphNode {
  id: string;
  name: string;
  type: CodeEntityType;
  filePath: string;
  lineStart: number;
  lineEnd?: number;
}

// 调用图边
export interface CallGraphEdge {
  source: string;
  target: string;
  type: 'calls' | 'implements' | 'extends';
}

// 数据流
export interface DataFlowInfo {
  id: string;
  sourceName: string;
  sinkName: string;
  path: string[];
  isUserInput: boolean;
  isSensitive: boolean;
}
```

- [ ] **Step 5: 提交**

```bash
git add src/types/skills.ts src/types/vulnerability.ts src/types/scan.ts src/types/code.ts
git commit -m "feat(types): add type definitions for skills, vulnerability, scan, and code"
```

---

## Task 7: 创建 Skills API 路由

**Files:**
- Create: `src/app/api/skills/route.ts`
- Create: `src/app/api/skills/categories/route.ts`
- Create: `src/app/api/skills/[id]/route.ts`

- [ ] **Step 1: 创建 Skills 列表和创建 API**

```typescript
// src/app/api/skills/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/skills - 获取 Skills 列表
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const isActive = searchParams.get('isActive');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const where: any = {};
    if (category) where.category = category;
    if (isActive !== null) where.isActive = isActive === 'true';

    const [skills, total] = await Promise.all([
      prisma.skill.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.skill.count({ where }),
    ]);

    return NextResponse.json({
      skills: skills.map(s => ({
        ...s,
        tools: JSON.parse(s.tools),
        parameters: JSON.parse(s.parameters),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('获取 Skills 列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/skills - 创建 Skill
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限（只有管理员可以创建 Skill）
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      displayName,
      description,
      category,
      cwe,
      severity,
      systemPrompt,
      userPrompt,
      tools,
      parameters,
    } = body;

    // 验证必填字段
    if (!name || !displayName || !description || !category || !severity || !systemPrompt || !userPrompt) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      );
    }

    // 检查名称是否已存在
    const existing = await prisma.skill.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { error: 'Skill 名称已存在' },
        { status: 400 }
      );
    }

    const skill = await prisma.skill.create({
      data: {
        name,
        displayName,
        description,
        category,
        cwe,
        severity,
        systemPrompt,
        userPrompt,
        tools: JSON.stringify(tools || []),
        parameters: JSON.stringify(parameters || {}),
        isBuiltin: false,
      },
    });

    return NextResponse.json(
      {
        skill: {
          ...skill,
          tools: JSON.parse(skill.tools),
          parameters: JSON.parse(skill.parameters),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('创建 Skill 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 创建 Skills 分类 API**

```typescript
// src/app/api/skills/categories/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/skills/categories - 获取 Skills 分类列表
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const categories = await prisma.skill.groupBy({
      by: ['category'],
      _count: {
        id: true,
      },
      where: {
        isActive: true,
      },
    });

    const categoryLabels: Record<string, string> = {
      'code-audit': '代码安全审计',
      'auth': '认证与授权',
      'sensitive': '敏感信息泄露',
      'api': 'API 安全',
      'config': '依赖与配置',
      'crypto': '加密与数据',
      'web': 'Web 安全',
      'business': '业务逻辑',
      'client': '客户端安全',
      'cloud': '云与容器安全',
    };

    const result = categories.map(c => ({
      name: c.category,
      label: categoryLabels[c.category] || c.category,
      count: c._count.id,
    }));

    return NextResponse.json({ categories: result });
  } catch (error) {
    console.error('获取 Skills 分类错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 创建 Skill 详情 API**

```typescript
// src/app/api/skills/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/skills/:id - 获取 Skill 详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    const skill = await prisma.skill.findUnique({
      where: { id },
      include: {
        executions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        evolutions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    return NextResponse.json({
      skill: {
        ...skill,
        tools: JSON.parse(skill.tools),
        parameters: JSON.parse(skill.parameters),
        executions: skill.executions.map(e => ({
          ...e,
          input: JSON.parse(e.input),
          output: e.output ? JSON.parse(e.output) : null,
        })),
        evolutions: skill.evolutions.map(ev => ({
          ...ev,
          beforeData: JSON.parse(ev.beforeData),
          afterData: JSON.parse(ev.afterData),
        })),
      },
    });
  } catch (error) {
    console.error('获取 Skill 详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/skills/:id - 更新 Skill
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const skill = await prisma.skill.findUnique({ where: { id } });
    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    // 内置 Skill 只能修改 isActive
    if (skill.isBuiltin && Object.keys(body).some(k => k !== 'isActive')) {
      return NextResponse.json(
        { error: '内置 Skill 只能修改启用状态' },
        { status: 400 }
      );
    }

    const updateData: any = {};
    if (body.displayName !== undefined) updateData.displayName = body.displayName;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.cwe !== undefined) updateData.cwe = body.cwe;
    if (body.severity !== undefined) updateData.severity = body.severity;
    if (body.systemPrompt !== undefined) updateData.systemPrompt = body.systemPrompt;
    if (body.userPrompt !== undefined) updateData.userPrompt = body.userPrompt;
    if (body.tools !== undefined) updateData.tools = JSON.stringify(body.tools);
    if (body.parameters !== undefined) updateData.parameters = JSON.stringify(body.parameters);
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const updated = await prisma.skill.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      skill: {
        ...updated,
        tools: JSON.parse(updated.tools),
        parameters: JSON.parse(updated.parameters),
      },
    });
  } catch (error) {
    console.error('更新 Skill 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/skills/:id - 删除 Skill
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    const skill = await prisma.skill.findUnique({ where: { id } });
    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    if (skill.isBuiltin) {
      return NextResponse.json(
        { error: '内置 Skill 不能删除' },
        { status: 400 }
      );
    }

    await prisma.skill.delete({ where: { id } });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除 Skill 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 提交**

```bash
git add src/app/api/skills/
git commit -m "feat(api): add Skills CRUD API routes"
```

---

## Task 8: 创建漏洞管理 API 路由

**Files:**
- Create: `src/app/api/vulnerabilities/route.ts`
- Create: `src/app/api/vulnerabilities/stats/route.ts`
- Create: `src/app/api/vulnerabilities/[id]/route.ts`

- [ ] **Step 1: 创建漏洞列表和创建 API**

```typescript
// src/app/api/vulnerabilities/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/vulnerabilities - 获取漏洞列表
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const status = searchParams.get('status');
    const severity = searchParams.get('severity');
    const type = searchParams.get('type');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (type) where.type = type;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [vulnerabilities, total] = await Promise.all([
      prisma.vulnerability.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          project: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.vulnerability.count({ where }),
    ]);

    return NextResponse.json({
      vulnerabilities: vulnerabilities.map(v => ({
        ...v,
        details: v.details ? JSON.parse(v.details) : null,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('获取漏洞列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/vulnerabilities - 创建漏洞（内部使用）
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const body = await request.json();
    const {
      projectId,
      skillExecutionId,
      title,
      description,
      type,
      cwe,
      severity,
      filePath,
      lineStart,
      lineEnd,
      codeSnippet,
      details,
      aiAnalysis,
      fixSuggestion,
    } = body;

    if (!projectId || !title || !description || !type || !severity) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      );
    }

    const vulnerability = await prisma.vulnerability.create({
      data: {
        projectId,
        skillExecutionId,
        title,
        description,
        type,
        cwe,
        severity,
        filePath,
        lineStart,
        lineEnd,
        codeSnippet,
        details: details ? JSON.stringify(details) : null,
        aiAnalysis,
        fixSuggestion,
        status: 'new',
      },
    });

    return NextResponse.json({ vulnerability }, { status: 201 });
  } catch (error) {
    console.error('创建漏洞错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 创建漏洞统计 API**

```typescript
// src/app/api/vulnerabilities/stats/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/vulnerabilities/stats - 获取漏洞统计
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    const where: any = {};
    if (projectId) where.projectId = projectId;

    // 总数和按状态统计
    const [total, byStatus, bySeverity, byType, recentVulnerabilities] = await Promise.all([
      prisma.vulnerability.count({ where }),
      prisma.vulnerability.groupBy({
        by: ['status'],
        _count: { id: true },
        where,
      }),
      prisma.vulnerability.groupBy({
        by: ['severity'],
        _count: { id: true },
        where,
      }),
      prisma.vulnerability.groupBy({
        by: ['type'],
        _count: { id: true },
        where,
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      prisma.vulnerability.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { createdAt: true },
      }),
    ]);

    // 计算趋势（按天分组）
    const trendMap = new Map<string, number>();
    recentVulnerabilities.forEach(v => {
      const date = v.createdAt.toISOString().split('T')[0];
      trendMap.set(date, (trendMap.get(date) || 0) + 1);
    });
    const trend = Array.from(trendMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const stats = {
      total,
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count.id])),
      bySeverity: Object.fromEntries(bySeverity.map(s => [s.severity, s._count.id])),
      byType: Object.fromEntries(byType.map(t => [t.type, t._count.id])),
      trend,
    };

    return NextResponse.json({ stats });
  } catch (error) {
    console.error('获取漏洞统计错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 创建漏洞详情和更新 API**

```typescript
// src/app/api/vulnerabilities/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/vulnerabilities/:id - 获取漏洞详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    const vulnerability = await prisma.vulnerability.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true },
        },
        execution: {
          select: {
            id: true,
            skillId: true,
            skill: { select: { id: true, name: true, displayName: true } },
          },
        },
      },
    });

    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    return NextResponse.json({
      vulnerability: {
        ...vulnerability,
        details: vulnerability.details ? JSON.parse(vulnerability.details) : null,
      },
    });
  } catch (error) {
    console.error('获取漏洞详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/vulnerabilities/:id - 更新漏洞
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const vulnerability = await prisma.vulnerability.findUnique({ where: { id } });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    const updateData: any = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.cwe !== undefined) updateData.cwe = body.cwe;
    if (body.severity !== undefined) updateData.severity = body.severity;
    if (body.filePath !== undefined) updateData.filePath = body.filePath;
    if (body.lineStart !== undefined) updateData.lineStart = body.lineStart;
    if (body.lineEnd !== undefined) updateData.lineEnd = body.lineEnd;
    if (body.codeSnippet !== undefined) updateData.codeSnippet = body.codeSnippet;
    if (body.details !== undefined) updateData.details = JSON.stringify(body.details);
    if (body.aiAnalysis !== undefined) updateData.aiAnalysis = body.aiAnalysis;
    if (body.fixSuggestion !== undefined) updateData.fixSuggestion = body.fixSuggestion;
    if (body.notes !== undefined) updateData.notes = body.notes;

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      vulnerability: {
        ...updated,
        details: updated.details ? JSON.parse(updated.details) : null,
      },
    });
  } catch (error) {
    console.error('更新漏洞错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/vulnerabilities/:id - 删除漏洞
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    const vulnerability = await prisma.vulnerability.findUnique({ where: { id } });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    await prisma.vulnerability.delete({ where: { id } });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除漏洞错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 提交**

```bash
git add src/app/api/vulnerabilities/
git commit -m "feat(api): add Vulnerability CRUD API routes"
```

---

## Task 9: 创建漏洞状态操作 API

**Files:**
- Create: `src/app/api/vulnerabilities/[id]/confirm/route.ts`
- Create: `src/app/api/vulnerabilities/[id]/false-positive/route.ts`
- Create: `src/app/api/vulnerabilities/[id]/fix/route.ts`
- Create: `src/app/api/vulnerabilities/[id]/verify/route.ts`

- [ ] **Step 1: 创建确认漏洞 API**

```typescript
// src/app/api/vulnerabilities/[id]/confirm/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/vulnerabilities/:id/confirm - 确认漏洞
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    const vulnerability = await prisma.vulnerability.findUnique({ where: { id } });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: {
        status: 'confirmed',
        confirmedBy: payload.userId,
        confirmedAt: new Date(),
      },
    });

    // 更新关联的执行记录
    if (vulnerability.skillExecutionId) {
      await prisma.skillExecution.update({
        where: { id: vulnerability.skillExecutionId },
        data: { confirmedCount: { increment: 1 } },
      });
    }

    return NextResponse.json({ vulnerability: updated });
  } catch (error) {
    console.error('确认漏洞错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 创建标记误报 API**

```typescript
// src/app/api/vulnerabilities/[id]/false-positive/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/vulnerabilities/:id/false-positive - 标记误报
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    const vulnerability = await prisma.vulnerability.findUnique({ where: { id } });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: {
        status: 'false-positive',
        confirmedBy: payload.userId,
        confirmedAt: new Date(),
      },
    });

    // 更新关联的执行记录
    if (vulnerability.skillExecutionId) {
      await prisma.skillExecution.update({
        where: { id: vulnerability.skillExecutionId },
        data: { falsePositiveCount: { increment: 1 } },
      });
    }

    return NextResponse.json({ vulnerability: updated });
  } catch (error) {
    console.error('标记误报错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 创建标记修复 API**

```typescript
// src/app/api/vulnerabilities/[id]/fix/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/vulnerabilities/:id/fix - 标记已修复
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    const vulnerability = await prisma.vulnerability.findUnique({ where: { id } });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    if (vulnerability.status !== 'confirmed') {
      return NextResponse.json(
        { error: '只有已确认的漏洞才能标记修复' },
        { status: 400 }
      );
    }

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: {
        status: 'fixed',
        fixedBy: payload.userId,
        fixedAt: new Date(),
      },
    });

    return NextResponse.json({ vulnerability: updated });
  } catch (error) {
    console.error('标记修复错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 创建验证修复 API**

```typescript
// src/app/api/vulnerabilities/[id]/verify/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/vulnerabilities/:id/verify - 验证修复
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    const vulnerability = await prisma.vulnerability.findUnique({ where: { id } });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    if (vulnerability.status !== 'fixed') {
      return NextResponse.json(
        { error: '只有已修复的漏洞才能验证' },
        { status: 400 }
      );
    }

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: {
        status: 'verified',
        verifiedBy: payload.userId,
        verifiedAt: new Date(),
      },
    });

    return NextResponse.json({ vulnerability: updated });
  } catch (error) {
    console.error('验证修复错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 5: 提交**

```bash
git add src/app/api/vulnerabilities/[id]/
git commit -m "feat(api): add vulnerability status action endpoints"
```

---

## Task 10: 创建种子数据脚本

**Files:**
- Create: `prisma/seed-skills.ts`

- [ ] **Step 1: 创建 Skills 种子数据脚本**

```typescript
// prisma/seed-skills.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 预定义 Skills 数据
const skillsData = [
  // ========== 代码安全审计类 ==========
  {
    name: 'sql-injection',
    displayName: 'SQL 注入检测',
    description: '检测代码中的 SQL 注入漏洞，包括字符串拼接、不安全的参数传递等',
    category: 'code-audit',
    cwe: 'CWE-89',
    severity: 'high',
    systemPrompt: `你是一个专业的安全代码审计专家，专注于检测 SQL 注入漏洞。

你的任务是分析代码中的 SQL 注入风险，包括但不限于：
1. 字符串拼接构建 SQL 语句
2. 用户输入直接拼接到 SQL 中
3. 使用不安全的数据库操作方法
4. 动态表名、列名构造

请仔细分析每一段代码，找出潜在的 SQL 注入点，并提供修复建议。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的 SQL 注入漏洞，输出 JSON 格式的结果。`,
    tools: ['read_file', 'search_pattern'],
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
      language: { type: 'string', required: false, description: '编程语言' },
    }),
  },
  {
    name: 'xss-detection',
    displayName: 'XSS 漏洞扫描',
    description: '检测跨站脚本漏洞，包括反射型、存储型和 DOM 型 XSS',
    category: 'code-audit',
    cwe: 'CWE-79',
    severity: 'medium',
    systemPrompt: `你是一个专业的安全代码审计专家，专注于检测 XSS 跨站脚本漏洞。

你的任务是分析代码中的 XSS 风险，包括：
1. 用户输入未经转义直接输出到 HTML
2. 危险的 DOM 操作（innerHTML、document.write）
3. 不安全的 URL 参数处理
4. 缺少内容安全策略（CSP）

请仔细分析每一段代码，找出潜在的 XSS 漏洞。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的 XSS 漏洞，输出 JSON 格式的结果。`,
    tools: ['read_file', 'search_pattern'],
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  // ... 更多 Skills 省略，实际脚本中包含所有 65 个
];

async function main() {
  console.log('开始种子 Skills 数据...');

  for (const skill of skillsData) {
    const existing = await prisma.skill.findUnique({
      where: { name: skill.name },
    });

    if (existing) {
      console.log(`Skill "${skill.name}" 已存在，跳过`);
      continue;
    }

    await prisma.skill.create({
      data: {
        ...skill,
        isBuiltin: true,
      },
    });
    console.log(`创建 Skill "${skill.name}"`);
  }

  console.log('Skills 种子数据完成！');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: 运行种子脚本**

```bash
npx tsx prisma/seed-skills.ts
```

Expected output:
```
开始种子 Skills 数据...
创建 Skill "sql-injection"
创建 Skill "xss-detection"
...
Skills 种子数据完成！
```

- [ ] **Step 3: 提交**

```bash
git add prisma/seed-skills.ts
git commit -m "feat(db): add skills seed data script"
```

---

## Task 11: 更新导航菜单

**Files:**
- Modify: `src/app/dashboard/layout.tsx`

- [ ] **Step 1: 添加新的导航菜单项**

在 layout.tsx 中添加新的菜单项：

```tsx
// 在 "个人" 部分后添加新的菜单分组

          {/* 安全测试 */}
          <div className="pt-4 pb-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              安全测试
            </p>
          </div>
          <NavLink href="/dashboard/skills" icon={<Award size={20} />}>
            Skills 库
          </NavLink>
          <NavLink href="/dashboard/scans" icon={<Zap size={20} />}>
            自动化扫描
          </NavLink>
          <NavLink href="/dashboard/code" icon={<Code size={20} />}>
            代码理解
          </NavLink>

          {/* 管理功能 - 根据权限显示 */}
          {user?.roles?.includes('admin') && (
            <>
              <div className="pt-4 pb-2">
                <p className="text-xs text-gray-500 uppercase tracking-wider">
                  管理员
                </p>
              </div>
              <NavLink href="/dashboard/users" icon={<Users size={20} />}>
                用户管理
              </NavLink>
              <NavLink href="/dashboard/roles" icon={<Settings size={20} />}>
                角色权限
              </NavLink>
              <NavLink href="/dashboard/config" icon={<Cog size={20} />}>
                系统配置
              </NavLink>
              <NavLink href="/dashboard/admin/models" icon={<Brain size={20} />}>
                模型管理
              </NavLink>
              <NavLink href="/dashboard/admin/vulnerabilities" icon={<Bug size={20} />}>
                漏洞管理
              </NavLink>
              <NavLink href="/dashboard/admin/patterns" icon={<Shield size={20} />}>
                漏洞模式库
              </NavLink>
              <NavLink href="/dashboard/admin/skills-evolution" icon={<TrendingUp size={20} />}>
                Skills 进化
              </NavLink>
            </>
          )}
```

需要在文件顶部添加新的图标导入：

```tsx
import {
  LayoutDashboard,
  Users,
  Settings,
  MessageSquare,
  LogOut,
  Cog,
  User,
  GitBranch,
  Clock,
  Award,
  Bug,
  TrendingUp,
  Brain,
  Zap,
  Code,
  Shield,
} from 'lucide-react';
```

- [ ] **Step 2: 验证导航菜单**

启动开发服务器，检查新的导航菜单是否正确显示。

```bash
npm run dev
```

- [ ] **Step 3: 提交**

```bash
git add src/app/dashboard/layout.tsx
git commit -m "feat(ui): update navigation menu with new security testing modules"
```

---

## Task 12: 验证和测试

- [ ] **Step 1: 运行数据库迁移验证**

```bash
npx prisma migrate status
```

Expected output:
```
Database schema is up to date!
```

- [ ] **Step 2: 验证 API 端点**

启动开发服务器后测试 API：

```bash
# 测试 Skills API
curl -X GET http://localhost:3000/api/skills -H "Authorization: Bearer YOUR_TOKEN"

# 测试漏洞 API
curl -X GET http://localhost:3000/api/vulnerabilities -H "Authorization: Bearer YOUR_TOKEN"

# 测试统计 API
curl -X GET http://localhost:3000/api/vulnerabilities/stats -H "Authorization: Bearer YOUR_TOKEN"
```

- [ ] **Step 3: 最终提交**

```bash
git add .
git commit -m "feat: complete Phase 1 - data layer foundation

- Add 11 new Prisma models (Skill, SkillExecution, SkillEvolution, Vulnerability, VulnerabilityPattern, ScanTask, ScanReport, ProjectStructure, CodeKnowledge, DataFlow, Tool)
- Add Skills CRUD API with categories and evolution endpoints
- Add Vulnerability CRUD API with status actions (confirm, false-positive, fix, verify)
- Add Vulnerability stats API
- Add type definitions for all new models
- Add seed script for 65 predefined skills
- Update navigation menu with new modules"
```

---

## 完成检查清单

- [ ] 所有 Prisma 模型已添加并迁移成功
- [ ] Skills API 端点正常工作
- [ ] 漏洞 API 端点正常工作
- [ ] 类型定义已创建
- [ ] 种子数据脚本可以运行
- [ ] 导航菜单已更新
- [ ] 所有代码已提交

---

## 下一步

Phase 1 完成后，继续 Phase 2: Skills 系统（前端页面 + 65个预定义Skills完整数据）
