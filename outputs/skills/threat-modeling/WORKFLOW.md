# Threat Modeling Workflow Definition

**Version**: 1.0.0
**Type**: FSM
**Template**: threat-modeling

---

## FSM Structure

This workflow uses a **4-node FSM** structure with an Agent zone:

```
┌─────────────────────────────────────────────────────────────┐
│  Node 1: 系统理解 (P1+P2)                                     │
│  固定节点，不可删除                                            │
│  输入: 项目路径                                               │
│  输出: P1.yaml, P2.yaml                                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Node 2: 安全评估 (P3+P4)                                     │
│  固定节点，不可删除                                            │
│  输入: P1.yaml, P2.yaml                                       │
│  输出: P3.yaml, P4.yaml                                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Node 3: 威胁分析 (P5+P6)                                     │
│  固定节点，不可删除                                            │
│  输入: P1-P4.yaml                                             │
│  输出: P5.yaml, P6.yaml                                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  🔧 Agent Zone                                               │
│  用户可自由添加 Agent 节点 (并行执行)                           │
│                                                              │
│  输入: 用户指定 (不确定)                                       │
│  输出: vulnerabilities/*.json                                 │
│                                                              │
│  默认 Agent:                                                 │
│  - SAST Agent (Semgrep/CodeQL)                              │
│  - Secret Scanner (truffleHog)                              │
│  - Dependency Scanner (Snyk)                                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Node 4: 报告生成 (P7+P8)                                     │
│  固定节点，不可删除                                            │
│  输入: P1-P6.yaml + Agent results + Workspace reports        │
│  输出: P7.yaml + 8 reports                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Node Definitions

### Node 1: 系统理解

```yaml
node:
  id: fsm-node-1
  type: fsm_phase
  label: 系统理解
  fsmPhase: 1
  fsmFixed: true
  fsmOrder: 1
  phases: [P1, P2]
  
  skillPath: phases/P1-P2
  
  config:
    scanDepth: deep
    includeTests: false
    techStackDetection: true
    
  input:
    - 项目路径 (workspace)
    
  output:
    files:
      - P1_project_context.yaml
      - P2_dfd_elements.yaml
    validation:
      - discovery_checklist 所有入口类型扫描完成
      - l1_coverage.coverage_percentage == 100%
```

### Node 2: 安全评估

```yaml
node:
  id: fsm-node-2
  type: fsm_phase
  label: 安全评估
  fsmPhase: 2
  fsmFixed: true
  fsmOrder: 2
  phases: [P3, P4]
  
  skillPath: phases/P3-P4
  
  inputContract:
    - P1_project_context.yaml
    - P2_dfd_elements.yaml
    
  output:
    files:
      - P3_boundary_context.yaml
      - P4_security_gaps.yaml
    validation:
      - 所有 DFD 元素映射到信任边界
      - 16 安全域评估完成
```

### Node 3: 威胁分析

```yaml
node:
  id: fsm-node-3
  type: fsm_phase
  label: 威胁分析
  fsmPhase: 3
  fsmFixed: true
  fsmOrder: 3
  phases: [P5, P6]
  
  skillPath: phases/P5-P6
  
  inputContract:
    - P1_project_context.yaml
    - P2_dfd_elements.yaml
    - P3_boundary_context.yaml
    - P4_security_gaps.yaml
    
  output:
    files:
      - P5_threat_inventory.yaml
      - P6_validated_risks.yaml
    validation:
      - element_coverage >= 80%
      - count_conservation: P5.total == sum(risk_status)
```

### Agent Zone

```yaml
agentZone:
  position: 3  # 在 Node 3 之后
  type: agent-zone
  
  config:
    allowAdd: true
    allowDelete: true
    allowReorder: true
    parallel: true
    
  defaultAgents:
    - id: sast-agent
      name: SAST Agent
      tool: Semgrep
      output: vulnerabilities/sast-report.json
      
    - id: secret-scanner
      name: Secret Scanner
      tool: truffleHog
      output: vulnerabilities/secrets-report.json
      
    - id: dep-scanner
      name: Dependency Scanner
      tool: Snyk
      output: vulnerabilities/dependency-report.json
      
  input:
    type: user_input
    prompt: "请提供要扫描的目标、工具和配置"
    
  output:
    directory: vulnerabilities/
```

### Node 4: 报告生成

```yaml
node:
  id: fsm-node-4
  type: fsm_phase
  label: 报告生成
  fsmPhase: 4
  fsmFixed: true
  fsmOrder: 4
  phases: [P7, P8]
  
  skillPath: phases/P7-P8
  
  inputContract:
    - P1_project_context.yaml
    - P2_dfd_elements.yaml
    - P3_boundary_context.yaml
    - P4_security_gaps.yaml
    - P5_threat_inventory.yaml
    - P6_validated_risks.yaml
    - Agent results (vulnerabilities/*.json)
    - Workspace reports (可选)
    
  output:
    files:
      - P7_mitigation_plan.yaml
    reports:
      - RISK-ASSESSMENT-REPORT.md
      - RISK-INVENTORY.md
      - MITIGATION-MEASURES.md
      - PENETRATION-TEST-PLAN.md
      - ARCHITECTURE-ANALYSIS.md
      - DFD-DIAGRAM.md
      - COMPLIANCE-REPORT.md
      - ATTACK-PATH-VALIDATION.md
      
    validation:
      - 每个 VR-xxx 有对应 MIT-xxx
      - 8 个报告全部生成
      - POC/缓解代码完整包含
```

---

## Execution Rules

### Sequential Execution

- Node 1 → Node 2 → Node 3 → [Agent Zone] → Node 4
- Each node must wait for predecessor completion
- Node 4 must wait for all Agent results

### Parallel Execution

- Agent zone nodes execute in parallel
- Node 4 waits for all Agent nodes to complete

### Validation Gates

Each node has validation gates:
- P1: discovery_checklist coverage, l1_coverage
- P2: boundary mapping, domain assessment
- P3: element coverage, count conservation
- P4: mitigation coverage, report completeness

### Ralph Loop

On validation failure:
- Max iterations: 3
- Feedback injection on retry
- Experience storage for learning

---

## Data Contracts

### P1 Output Schema

```yaml
P1_project_context:
  project_context:
    project_type: string
    tech_stack: array
    
  module_inventory:
    modules: array
      - id: M-{Seq:03d}
      - name: string
      - security_level: HIGH|MEDIUM|LOW
      
  entry_point_inventory:
    entry_points: array
      - id: EP-{TYPE}-{Seq:03d}
      - type: API|UI|CLI|WebSocket
      - auth_required: boolean
      
  discovery_checklist:
    checklist: object
      - {entry_type}: {scanned: true}

P2_dfd_elements:
  dfd_elements:
    external_interactors: array
    processes: array
    data_stores: array
    data_flows: array
    
  l1_coverage:
    coverage_percentage: 100
```

### P3 Output Schema

```yaml
P3_boundary_context:
  boundaries: array
    - id: TB-{Seq:03d}
    - type: Network|Process|User|Data|Service
    - elements: array

P4_security_gaps:
  gaps: array
    - id: GAP-{Seq:03d}
    - domain: AUTHN|AUTHZ|...
    - severity: CRITICAL|HIGH|MEDIUM|LOW
    
  design_matrix: object
    - {domain}: {score, assessed, gaps}
```

### P5 Output Schema

```yaml
P5_threat_inventory:
  threats: array
    - id: T-{STRIDE}-{Element}-{Seq}
    - stride_category: S|T|R|I|D|E
    - severity: CRITICAL|HIGH|MEDIUM|LOW
    
  summary:
    by_stride: {S, T, R, I, D, E}
    by_priority: {critical, high, medium, low}
```

### P6 Output Schema

```yaml
P6_validated_risks:
  risk_summary:
    verified: number
    theoretical: number
    pending: number
    excluded: number
    
  risk_details: array
    - id: VR-{Seq:03d}
    - status: verified|theoretical|pending|excluded
    - cvss_score: number
    - priority: P0|P1|P2|P3
    
  poc_details: array
    - id: POC-{Seq:03d}
    - risk_ref: VR-{Seq}
    - code: string
```

---

## Prompt Template

### Agent Zone Prompt

```
至此，威胁建模分析已完成以下阶段：

✅ Node 1 系统理解 - 已完成
   产出文件: P1.yaml, P2.yaml
   
✅ Node 2 安全评估 - 已完成
   产出文件: P3.yaml, P4.yaml
   
✅ Node 3 威胁分析 - 已完成
   产出文件: P5.yaml, P6.yaml

现在进入 Agent 扫描阶段，请提供:
- 要扫描的目标路径/文件
- 要使用的扫描工具
- 扫描规则/配置 (可选)

扫描报告将输出到 vulnerabilities/ 目录
```