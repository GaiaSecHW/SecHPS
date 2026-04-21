# Draft: Threat Modeling FSM Fusion

## Requirements (confirmed)

### User's Original Request
1. "深入分析 E:\threat-modeling-main 项目，给一个深入完整的报告"
2. "比较工作流（有限状态机）区别"
3. "用 Ralph Loop 保证任务必须完成"
4. "借鉴架构哲学"
5. "将 8 阶段 FSM 融合到 AI4Web"
6. "将 8 个阶段打开来看：每个阶段做什么、输入什么、输出什么"

### Final Goal
将 Threat Modeling Skill 的 8 阶段 FSM 工作流架构融合到 AI4Web 平台：
- 理解架构哲学（契约驱动、形式化验证、4-Gate 协议、渐进加载、职责分离）
- 分析每个阶段的输入输出
- 设计 FSM + DAG + Ralph Loop 的融合方案
- 落地实施路线图

---

## Technical Decisions

### 1. Threat Modeling Skill 核心架构哲学（已确认）

| 原则 | 描述 | AI4Web 应用 |
|------|------|-------------|
| **契约驱动** | 每阶段有严格的输入输出数据契约（YAML schema） | WorkflowNode 输入输出标准化 |
| **形式化验证** | Safety/Liveness 属性保证系统完整性 | 验证门设计（计数守恒、覆盖率检查） |
| **4-Gate 协议** | 内部通信协议（READ → ANALYZE → SYNTHESIZE → WRITE） | Agent 节点执行模式 |
| **渐进加载** | 按需加载上下文，避免 token 爆炸 | Skill 内容分段加载 |
| **职责分离** | 每阶段单一职责，验证脚本独立 | NodeExecutor 分离 |

### 2. Ralph Loop vs FSM 互补性（已确认）

| 维度 | Ralph Loop | Threat FSM | 融合方案 |
|------|------------|------------|----------|
| 目标 | 任务完成保证 | 质量结构保证 | 阶段内迭代 + 结构化输出 |
| 状态 | 迭代计数、停止条件 | 线性阶段推进 | FSM 状态 + Ralph 迭代次数 |
| 验证 | verifyCompletion() | 验证脚本 + 数据契约 | 验证门 + 经验学习 |
| 失败处理 | 重试 + 经验注入 | 阶段重做 | 阶段内 Ralph 循环 |

### 3. AI4Web 工作流系统现状（已确认）

**Workflow 模型**：
- DAG 结构（WorkflowNode 有 prev/next 关系）
- 禁止循环依赖（workflow-validator.ts 检测）
- NodeExecution 状态追踪（pending/running/completed/failed）

**Skill 系统**：
- Skill 模型存储完整 Markdown 内容
- 三种加载模式：description/manual/vulnerability
- SkillExecution 追踪执行统计
- VulnerabilityPattern 关联分类

**Ralph Loop Agent**：
- 迭代执行直到 verifyCompletion() 返回 true
- AutonomousEvolutionExperience 存储失败经验
- 停止条件：maxIterations, timeout, completion markers

### 4. 融合架构决策（用户确认）

#### 决策 1: Phase 存储方式
**选择**: WorkflowNode 类型扩展

**实现方案**:
- 扩展 `WorkflowNodeType` 枚举，添加 `fsm_phase` 类型
- Phase 定义存储在 `node.config` JSON 字段中
- Phase 包含：phase_number (1-8), phase_name, input_contract, output_contract, validation_schema

**优势**:
- 无需新增 Prisma 模型，复用现有 WorkflowNode
- Phase 作为 DAG 节点，支持可视化编排
- node.config 可动态配置 Phase 参数

#### 决策 2: 输出数据契约存储
**选择**: 混合：DB + 文件

**实现方案**:
- 创建 `PhaseOutput` Prisma 模型存储结构化数据
- 完整 YAML 文件存储在 `.claude/phases/{phase_number}/output.yaml`
- 双重备份确保数据完整性和可查询性

**PhaseOutput 模型设计**:
```prisma
model PhaseOutput {
  id            String   @id @default(uuid())
  executionId   String
  phaseNumber   Int
  outputYaml    String   // 完整 YAML 内容
  filePath      String   // .claude/phases/{N}/output.yaml
  status        String   // pending/validated/failed
  validatedAt   DateTime?
  createdAt     DateTime @default(now())
}
```

#### 决策 3: Ralph Loop 集成层级
**选择**: 阶段内循环

**实现方案**:
- 每个 Phase 内部用 Ralph Loop 保证输出符合数据契约
- Phase 完成验证后才推进到下一阶段
- 不回退到前序阶段（FSM 线性推进）

**阶段内 Ralph 循环流程**:
```
Phase N 执行:
  1. READ: 读取前序阶段 YAML 输出
  2. ANALYZE: LLM 执行阶段核心分析
  3. SYNTHESIZE: 合并结果到结构化输出
  4. WRITE: 写入 YAML 文件 + PhaseOutput 记录
  5. VALIDATE: Node.js 验证脚本检查数据契约
  6. IF validation_failed → Ralph Loop 重试（maxIterations=3）
  7. IF validation_passed → Proceed to Phase N+1
```

#### 决策 4: 验证脚本实现方式
**选择**: Node.js 重写

**实现方案**:
- 创建 `src/lib/phase-validators/` 目录
- 每个阶段对应 `validate-phase-{N}.ts` 验证脚本
- 使用 Zod 定义 YAML schema，验证数据契约

**验证脚本示例**:
```typescript
// src/lib/phase-validators/validate-phase-1.ts
import { z } from 'zod';

const P1Schema = z.object({
  project_context: z.object({
    project_type: z.string(),
    tech_stack: z.array(z.string())
  }),
  module_inventory: z.object({
    modules: z.array(z.object({
      id: z.string().regex(/^M-\d{3}$/),
      security_level: z.enum(['HIGH', 'MEDIUM', 'LOW'])
    }))
  }),
  discovery_checklist: z.object({
    checklist: z.record(z.object({
      scanned: z.literal(true)
    }))
  })
});

export function validatePhase1(yamlContent: string): ValidationResult {
  // Parse YAML + validate against schema
}
```

---

## Open Questions

**All questions have been answered! See Technical Decisions section.**

---

## Scope Boundaries

### INCLUDE
- 8 阶段 FSM 架构设计
- 数据契约规范（输入输出定义）
- 验证门设计（Safety/Liveness 属性检查）
- Ralph Loop 与 FSM 融合
- Skill 模型扩展设计
- NodeExecution FSM 状态追踪

### EXCLUDE (explicitly)
- 不实现完整 Threat Modeling Skill（仅架构融合）
- 不迁移 Python 验证脚本（需 Node.js 重写）
- 不修改现有 Workflow DAG 核心逻辑
- 不改变 Ralph Loop Agent 核心机制

---

## 最终节点融合方案（用户确认）

### 4 个 FSM 节点

| 节点 | 包含阶段 | 核心职责 | 关键输出 |
|------|----------|----------|----------|
| **Node 1: 系统理解** | P1+P2 | 理解系统结构和数据流 | P1.yaml, P2.yaml (DFD 模型) |
| **Node 2: 安全评估** | P3+P4 | 评估安全态势和缺口 | P3.yaml, P4.yaml (安全缺口清单) |
| **Node 3: 威胁分析** | P5+P6 | 识别和验证威胁 | P5.yaml, P6.yaml (威胁清单 + POC 设计) |
| **Node 4: 报告生成** | P7+P8 | 输出解决方案和报告 | P7.yaml + 8 个报告文件 |

### Agent 节点负责实际验证

| 验证类型 | Agent 节点 | 工具 |
|----------|------------|------|
| **SAST 扫描** | CodeQL Agent / Semgrep Agent | CodeQL, Semgrep |
| **依赖扫描** | Dependency Scanner Agent | Snyk, Dependabot |
| **密钥检测** | Secret Scanner Agent | git-secrets, truffleHog |
| **POC 执行** | Penetration Test Agent | Burp Suite, sqlmap |

### 关键区别

| 活动 | Threat Modeling Node | Agent Node |
|------|---------------------|------------|
| 代码扫描 | ❌ 不做 | ✅ SAST Agent 执行 |
| 威胁枚举 | ✅ Node 3 做 | ❌ 不做 |
| POC 设计 | ✅ Node 3 做（只设计不执行） | ❌ 不做 |
| POC 执行 | ❌ 不做 | ✅ Pen Test Agent 执行 |

---

## 架构改动清单

### 改动 1: WorkflowNodeType 扩展

```typescript
type WorkflowNodeType = 
  | 'agent' 
  | 'skill' 
  | 'tool' 
  | 'condition'
  | 'fsm_phase'        // 新增
```

### 改动 2: NodeExecution 模型扩展

```prisma
model NodeExecution {
  // 现有字段
  status: String
  
  // 新增字段
  fsmPhase: Int?       // 当前内部阶段 (1-4)
  fsmState: String?    // READ/ANALYZE/SYNTHESIZE/WRITE
  phaseOutput: String? // 阶段输出 YAML
}
```

### 改动 3: PhaseOutput 模型（新增）

```prisma
model PhaseOutput {
  id: String         @id @default(uuid())
  executionId: String
  nodeLabel: String
  phaseNumber: Int
  outputYaml: String
  filePath: String
  status: String      // pending/validated/failed
  createdAt: DateTime @default(now())
}
```

### 改动 4: FSMNodeExecutor（新增）

```typescript
class FSMNodeExecutor {
  async execute(node: WorkflowNode, context: ExecutionContext) {
    const phases = this.getPhases(node);
    
    for (const phase of phases) {
      // 1. READ
      const input = await this.readUpstream(phase);
      // 2. ANALYZE
      const result = await this.analyze(phase, input);
      // 3. SYNTHESIZE
      const output = await this.synthesize(result);
      // 4. WRITE
      await this.writeOutput(phase, output);
      // 5. VALIDATE + Ralph Loop
      const valid = await this.validate(phase, output);
      if (!valid) await this.retryWithFeedback(phase);
    }
  }
}
```

### 改动 5: 验证脚本（Node.js 重写）

```
src/lib/phase-validators/
├── validate-phase-1.ts  // P1+P2 验证
├── validate-phase-2.ts  // P3+P4 验证
├── validate-phase-3.ts  // P5+P6 验证
├── validate-phase-4.ts  // P7+P8 验证
└── schemas/
    ├── p1-schema.ts
    ├── p2-schema.ts
    └── ...
```

### 改动 6: 数据契约存储

```
.claude/phases/
├── 1-system-understanding/
│   ├── P1_project_context.yaml
│   └── P2_dfd_elements.yaml
├── 2-security-assessment/
│   ├── P3_boundary_context.yaml
│   └── P4_security_gaps.yaml
├── 3-threat-analysis/
│   ├── P5_threat_inventory.yaml
│   └── P6_validated_risks.yaml
└── 4-report-generation/
    └── P7_mitigation_plan.yaml
```

---

## 完整工作流架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow (混合 DAG)                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Node 1: 系统理解 (fsm_phase)                           │  │
│  │   ├── P1.0 Static Discovery (Script)                  │  │
│  │   ├── P1.2 Code Analysis (LLM)                        │  │
│  │   ├── P2.1 Interface Enumeration (LLM)                │  │
│  │   ├── P2.2 Data Flow Tracing (LLM)                    │  │
│  │   └── P2.5 DFD Synthesis (LLM+Script)                 │  │
│  │   输出: P1.yaml, P2.yaml                               │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ↓                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Node 2: 安全评估 (fsm_phase)                           │  │
│  │   ├── P3 Trust Boundary (LLM)                         │  │
│  │   └── P4 Security Design Review (LLM)                 │  │
│  │   输出: P3.yaml, P4.yaml                               │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ↓                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Node 3: 威胁分析 (fsm_phase)                           │  │
│  │   ├── P5 STRIDE Analysis (LLM)                        │  │
│  │   └── P6 Risk Validation (LLM)                        │  │
│  │   输出: P5.yaml, P6.yaml                               │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│              ┌───────────────┼───────────────┐              │
│              ↓               ↓               ↓              │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────┐ │
│  │ SAST Agent       │ │ Secret Scanner   │ │ Dep Scanner  │ │
│  │ (agent/tool)     │ │ (agent/tool)     │ │ (agent/tool) │ │
│  │                  │ │                  │ │              │ │
│  │ 输入: P2.yaml    │ │ 输入: 项目路径   │ │ 输入: P1.yaml│ │
│  │ 输出: sast.json  │ │ 输出: secrets    │ │ 输出: deps   │ │
│  └──────────────────┘ └──────────────────┘ └──────────────┘ │
│              │               │               │              │
│              └───────────────┼───────────────┘              │
│                              ↓                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Node 4: 报告生成 (fsm_phase)                           │  │
│  │   ├── P7 Mitigation Planning (LLM)                    │  │
│  │   └── P8 Report Generation (LLM)                      │  │
│  │   输入: P1-P6.yaml + Agent 结果                        │  │
│  │   输出: 8 个报告文件                                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 实施策略：完整架构设计优先

### Phase 1: 核心模型设计
- WorkflowNodeType 枚举扩展
- NodeExecution 模型扩展
- PhaseOutput 模型新增
- 数据契约 Schema 定义

### Phase 2: FSM 执行器实现
- FSMNodeExecutor 类
- 4-Gate 协议实现 (READ→ANALYZE→SYNTHESIZE→WRITE)
- Ralph Loop 集成
- 验证脚本 (Node.js + Zod)

### Phase 3: 数据流改造
- YAML 读写工具函数
- 节点间数据传递
- Agent 结果聚合

### Phase 4: Threat Modeling Skill 内容
- 4 个节点的 Skill Markdown 定义
- 内部子阶段指令
- 验证门定义

### Phase 5: Agent 集成
- SAST Agent 数据流适配
- Secret Scanner 数据流适配
- Dependency Scanner 数据流适配

### Phase 6: 报告生成
- 8 个报告模板
- POC/缓解代码完整包含
- 合规映射

---

## Next Steps

1. ✅ 完成 P1-P8 详细分析
2. ✅ 设计融合方案（4 节点）
3. ✅ 确定 Agent 节点职责
4. ✅ 确定实施策略（完整架构设计优先）
5. **生成工作计划**: 详细实施路线图