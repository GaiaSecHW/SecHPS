# FSM 工作流融合实施计划

## 目标

将 Threat Modeling Skill 的 8 阶段 FSM 工作流架构融合到 AI4Web 平台。

## 背景

Threat Modeling Skill 是一个成熟的安全分析工作流，包含：
- 8 个严格定义的阶段 (P1-P8)
- 严格的输入输出数据契约 (YAML)
- 形式化验证属性 (Safety/Liveness)
- 4-Gate 执行协议 (READ → ANALYZE → SYNTHESIZE → WRITE)

## 决策记录

### 决策 1: 节点融合方案
- **选择**: 4 个 FSM 节点 + Agent 区
- **节点定义**:
  - Node 1: 系统理解 (P1+P2)
  - Node 2: 安全评估 (P3+P4)
  - Node 3: 威胁分析 (P5+P6)
  - Agent 区: 用户自由添加 Agent 节点 (并行执行)
  - Node 4: 报告生成 (P7+P8)

### 决策 2: FSM 工作流类型
- **选择**: FSM 工作流与 DAG 工作流分开
- FSM 工作流节点固定，顺序固定
- 用户只能配置参数，不能删除或重排

### 册策 3: 阶段定义来源
- **选择**: Skill 内容可编辑
- 阶段定义在 Skill Markdown 文件中
- 用户可编辑 Skill 内容定制阶段行为

### 决策 4: Agent 区输入输出
- **输入**: 用户输入（不确定性高）
- **输出**: 项目 `vulnerabilities/` 目录
- **提示词**: 需告知用户已完成的工作和产出文件

### 决策 5: 报告数据结构
- **选择**: 废弃旧方案，重新设计
- 新模型: Report, ReportSection, PhaseOutput, IntegratedReport

---

## 实施计划

### Phase 1: 数据模型设计

#### 1.1 新增 FSMTemplate 模型
```prisma
model FSMTemplate {
  id          String   @id
  name        String   @unique
  displayName String
  description String?
  nodeCount   Int
  nodes       String   // JSON: 节点定义
  agentZone   String?  // JSON: Agent 区配置
  skillPath   String?  // Skill 目录路径
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime
  
  Workflow    Workflow[]
}
```

**任务**:
1. 编写 Prisma schema 定义
2. 执行 `prisma migrate dev`
3. 创建 seed 数据 (threat-modeling 模板)

#### 1.2 扩展 Workflow 模型
```prisma
model Workflow {
  // 新增字段
  workflowType   String   @default("dag")  // "dag" | "fsm"
  fsmTemplateId  String?
  
  FSMTemplate    FSMTemplate? @relation(fields: [fsmTemplateId], references: [id])
}
```

**任务**:
1. 修改 workflow.ts 类型定义
2. 添加 workflowType 字段到 Prisma
3. 更新 API 和前端

#### 1.3 扩展 WorkflowNode 模型
```prisma
model WorkflowNode {
  // 新增字段
  type       String   // 增加 "fsm_phase" | "agent-zone"
  fsmPhase   Int?
  fsmFixed   Boolean? @default(false)
  fsmOrder   Int?
  skillPath  String?
}
```

**任务**:
1. 修改 WorkflowNodeType 枚举
2. 添加 FSM 相关字段
3. 更新 NODE_TYPES 定义

#### 1.4 新增 PhaseOutput 模型
```prisma
model PhaseOutput {
  id          String   @id
  sessionId   String
  phaseNumber Int
  phaseName   String
  outputYaml  String
  outputPath  String
  status      String   @default("pending")
  validatedAt DateTime?
  createdAt   DateTime @default(now())
}
```

**任务**:
1. 编写 Prisma schema
2. 创建迁移

#### 1.5 新增 Report 模型 (重构)
```prisma
model Report {
  id                String   @id
  sessionId         String
  projectId         String
  reportType        String   // "dag" | "fsm"
  workflowType      String?
  fsmTemplate       String?
  title             String
  mainReportPath    String?
  mainReportContent String?
  subReports        String?  // JSON
  totalFindings     Int      @default(0)
  criticalCount     Int      @default(0)
  highCount         Int      @default(0)
  mediumCount       Int      @default(0)
  lowCount          Int      @default(0)
  dataSources       String?  // JSON
  integratedReports String?  // JSON
  status            String   @default("generated")
  generatedAt       DateTime @default(now())
}
```

**任务**:
1. 编写新的 Report 模型
2. 编写 ReportSection 模型
3. 编写 IntegratedReport 模型
4. 编写迁移脚本
5. 迁移旧数据 (AnalysisReport, EvaluationResult, ScanReport)

---

### Phase 2: FSM 执行器实现

#### 2.1 FSMNodeExecutor 类
```typescript
class FSMNodeExecutor {
  async execute(node: WorkflowNode, context: ExecutionContext) {
    // 1. READ: 读取前序数据
    // 2. ANALYZE: 执行阶段分析
    // 3. SYNTHESIZE: 合并结果
    // 4. WRITE: 写入 YAML
    // 5. VALIDATE: 验证数据契约
    // 6. Ralph Loop: 重试机制
  }
}
```

**任务**:
1. 创建 `src/lib/fsm/fsm-node-executor.ts`
2. 实现 4-Gate 协议
3. 实现 Phase 输入输出管理

#### 2.2 验证脚本 (Node.js)
```
src/lib/phase-validators/
├── validate-phase-1.ts
├── validate-phase-2.ts
├── validate-phase-3.ts
├── validate-phase-4.ts
└── schemas/
    ├── p1-p2-schema.ts
    ├── p3-p4-schema.ts
    ├── p5-p6-schema.ts
    └── p7-p8-schema.ts
```

**任务**:
1. 创建目录结构
2. 使用 Zod 定义 schema
3. 实现各阶段验证函数

#### 2.3 Ralph Loop 集成
**任务**:
1. 扩展 ralph-loop-agent.ts 支持阶段内循环
2. 实现验证失败后的重试机制
3. 实现经验注入

---

### Phase 3: 数据流改造

#### 3.1 Skill 复制机制
```typescript
// src/lib/fsm/fsm-skill-loader.ts
async function loadFSMSkill(fsmTemplate: FSMTemplate, projectId: string) {
  // 复制 data/skills/{template}/ → .claude/skills/{template}/
  // 创建阶段输出目录
}
```

**任务**:
1. 创建 fsm-skill-loader.ts
2. 实现目录复制逻辑
3. 实现阶段输出目录创建

#### 3.2 YAML 读写工具
```typescript
// src/lib/fsm/phase-io.ts
async function readPhaseOutput(phaseNumber: number): Promise<PhaseData>
async function writePhaseOutput(phaseNumber: number, data: PhaseData): Promise<void>
```

**任务**:
1. 创建 phase-io.ts
2. 实现 YAML 解析和写入
3. 实现路径管理

#### 3.3 提示词生成器
```typescript
// src/lib/fsm/fsm-prompt-builder.ts
function buildAgentZonePrompt(phaseOutputs: Record<string, string>): string
```

**任务**:
1. 创建 fsm-prompt-builder.ts
2. 实现阶段输出摘要生成
3. 实现 Agent 区提示词生成

---

### Phase 4: Threat Modeling Skill 内容

#### 4.1 Skill 目录结构
```
data/skills/threat-modeling/
├── SKILL.md
├── WORKFLOW.md
├── phases/
│   ├── P1-PROJECT-UNDERSTANDING.md
│   ├── P2-DFD-ANALYSIS.md
│   ├── P3-TRUST-BOUNDARY.md
│   ├── P4-SECURITY-DESIGN-REVIEW.md
│   ├── P5-STRIDE-ANALYSIS.md
│   ├── P6-RISK-VALIDATION.md
│   ├── P7-MITIGATION-PLANNING.md
│   └── P8-REPORT-GENERATION.md
├── knowledge/
│   ├── STRIDE.yml
│   └── security_patterns.yml
└── config.yaml
```

**任务**:
1. 创建目录结构
2. 编写 SKILL.md 入口文件
3. 编写 WORKFLOW.md 工作流定义
4. 编写各阶段 Markdown 文件 (参考 Threat Modeling Skill)
5. 编写知识库文件
6. 编写 config.yaml

---

### Phase 5: 管理员区 FSM 工作流设置

#### 5.1 FSM 模板管理 UI
**任务**:
1. 创建 FSM 模板列表页面
2. 创建 FSM 模板编辑页面
3. 实现模板 CRUD 操作

#### 5.2 FSM 模板 API
```
GET    /api/admin/fsm-templates
POST   /api/admin/fsm-templates
PUT    /api/admin/fsm-templates/:id
DELETE /api/admin/fsm-templates/:id
```

**任务**:
1. 创建 API 路由
2. 实现权限检查
3. 实现模板验证

#### 5.3 阶段内容编辑
**任务**:
1. 创建 Markdown 编辑器组件
2. 实现阶段文件读写
3. 实现版本管理

---

### Phase 6: 报告生成与集成

#### 6.1 Workspace 报告扫描器
```typescript
// src/lib/workspace-report-scanner.ts
async function scanWorkspaceReports(workspacePath: string): Promise<WorkspaceVulnerabilityReport[]>
```

**任务**:
1. 创建扫描器模块
2. 实现多种报告格式解析 (OWASP ZAP, SonarQube, Burp, Markdown)
3. 实现漏洞提取逻辑

#### 6.2 报告生成器
```typescript
// src/lib/report-generator.ts
async function generateFSMReport(
  sessionId: string,
  phaseOutputs: PhaseOutput[],
  agentResults: IntegratedReport[],
  workspaceReports: WorkspaceVulnerabilityReport[]
): Promise<Report>
```

**任务**:
1. 创建报告生成器
2. 实现数据聚合
3. 实现 8 个报告文件生成
4. 实现报告写入文件系统

#### 6.3 报告查看 UI
**任务**:
1. 重构报告查看页面
2. 实现多标签页展示
3. 实现章节导航
4. 实现外部报告集成展示
5. 实现下载功能 (PDF/Markdown)

#### 6.4 报告 API
```
GET /api/evaluations/:sessionId/report
GET /api/evaluations/:sessionId/report/sections/:sectionId
GET /api/evaluations/:sessionId/report/download
```

**任务**:
1. 创建/重构报告 API
2. 实现报告内容读取
3. 实现下载接口

---

## 测试策略 (TDD)

每个 Phase 的测试：
1. 先编写测试用例
2. 再实现功能
3. 验证测试通过

### 测试文件结构
```
tests/
├── fsm/
│   ├── fsm-template.test.ts
│   ├── fsm-node-executor.test.ts
│   ├── phase-validator.test.ts
│   ├── phase-io.test.ts
│   └── report-generator.test.ts
└── integration/
    └── fsm-workflow.test.ts
```

---

## 验收标准

1. FSM 工作流创建：用户可选择 FSM 模板创建工作流
2. FSM 工作流执行：4 个节点按顺序执行，Agent 区并行执行
3. 阶段输出验证：每个阶段的 YAML 输出符合数据契约
4. Agent 区输入输出：提示词告知用户已完成工作，输出到 vulnerabilities/
5. 报告生成：聚合所有数据，生成完整报告
6. 报告查看：会话详情可查看完整报告
7. 管理员设置：可管理 FSM 模板
8. 向后兼容：DAG 工作流正常运行

---

## 执行顺序

1. **Phase 1**: 数据模型设计 (阻塞后续)
2. **Phase 2**: FSM 执行器实现 (依赖 Phase 1)
3. **Phase 3**: 数据流改造 (可与 Phase 2 并行)
4. **Phase 4**: Skill 内容编写 (可与 Phase 1-3 并行)
5. **Phase 5**: 管理员区 UI (依赖 Phase 1)
6. **Phase 6**: 报告生成与集成 (依赖 Phase 1-4)

---

## 估算工作量

| Phase | 预估时间 | 依赖 |
|-------|----------|------|
| Phase 1 | 2-3 天 | 无 |
| Phase 2 | 3-4 天 | Phase 1 |
| Phase 3 | 2-3 天 | Phase 1 |
| Phase 4 | 2-3 天 | 无 |
| Phase 5 | 2-3 天 | Phase 1 |
| Phase 6 | 3-4 天 | Phase 1-4 |
| **总计** | **12-18 天** | - |

---

## 启动执行

使用 `/ulw-loop` 启动执行。