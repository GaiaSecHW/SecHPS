# Threat Modeling Skill

**Version**: 1.0.0
**Type**: FSM Workflow
**Category**: Security Analysis

---

## Overview

This skill provides a comprehensive 8-phase FSM (Finite State Machine) threat modeling workflow for security analysis. It follows a structured approach based on industry best practices including STRIDE methodology, OWASP guidelines, and formal verification properties.

---

## Workflow Type

This skill uses **FSM (Finite State Machine)** workflow type with 4 fixed nodes:

1. **Node 1**: 系统理解 (P1+P2) - Project Understanding + DFD Analysis
2. **Node 2**: 安全评估 (P3+P4) - Trust Boundary + Security Design Review
3. **Node 3**: 威胁分析 (P5+P6) - STRIDE Analysis + Risk Validation
4. **Node 4**: 报告生成 (P7+P8) - Mitigation Planning + Report Generation

**Agent Zone**: After Node 3, users can freely add Agent nodes (SAST, Secret Scanner, Dependency Scanner, etc.)

---

## Fixed Node Configuration

### Node 1: 系统理解 (P1+P2)

**Phases**: P1-PROJECT-UNDERSTANDING, P2-DFD-ANALYSIS

**Input**: 
- 项目路径 (workspace)

**Output**: 
- P1_project_context.yaml
- P2_dfd_elements.yaml

**Validation Gates**:
- discovery_checklist 所有 14 种入口类型扫描完成
- l1_coverage.coverage_percentage == 100%

---

### Node 2: 安全评估 (P3+P4)

**Phases**: P3-TRUST-BOUNDARY, P4-SECURITY-DESIGN-REVIEW

**Input**: 
- P1_project_context.yaml (from Node 1)
- P2_dfd_elements.yaml (from Node 1)

**Output**: 
- P3_boundary_context.yaml
- P4_security_gaps.yaml

**Validation Gates**:
- 所有 DFD 元素映射到信任边界区域
- 16 个安全域都有 assessed 标记

---

### Node 3: 威胁分析 (P5+P6)

**Phases**: P5-STRIDE-ANALYSIS, P6-RISK-VALIDATION

**Input**: 
- P1-P4 YAML outputs

**Output**: 
- P5_threat_inventory.yaml
- P6_validated_risks.yaml

**Validation Gates**:
- element_coverage_verification.coverage_percentage >= 80%
- 计数守恒: P5.total == verified + theoretical + pending + excluded

---

### Node 4: 报告生成 (P7+P8)

**Phases**: P7-MITIGATION-PLANNING, P8-REPORT-GENERATION

**Input**: 
- P1-P6 YAML outputs
- Agent zone results (vulnerabilities/)
- Workspace vulnerability reports

**Output**: 
- P7_mitigation_plan.yaml
- 8 report files (Markdown)

**Reports Generated**:
1. RISK-ASSESSMENT-REPORT.md (主报告)
2. RISK-INVENTORY.md
3. MITIGATION-MEASURES.md
4. PENETRATION-TEST-PLAN.md
5. ARCHITECTURE-ANALYSIS.md
6. DFD-DIAGRAM.md
7. COMPLIANCE-REPORT.md
8. ATTACK-PATH-VALIDATION.md

---

## Agent Zone

**Position**: After Node 3 (威胁分析)

**Allowed Operations**:
- Add Agent nodes freely
- Delete Agent nodes
- Reorder Agent nodes
- Parallel execution

**Default Agents**:
- SAST Agent (Semgrep/CodeQL)
- Secret Scanner (git-secrets/truffleHog)
- Dependency Scanner (Snyk)

**Input**: User-provided (不确定)
- 要扫描的目标路径/文件
- 要使用的扫描工具
- 扫描规则/配置

**Output**: Project `vulnerabilities/` directory
- sast-report.json
- secrets-report.json
- dependency-report.json

---

## Execution Protocol

### 4-Gate Protocol

Each FSM node follows the 4-Gate protocol:

1. **READ**: 读取前序阶段输出
2. **ANALYZE**: 执行阶段核心分析
3. **SYNTHESIZE**: 合并分析结果
4. **WRITE**: 写入 YAML 输出文件

### Ralph Loop

On validation failure:
- Retry up to 3 iterations
- Inject error feedback for correction
- Store experience for future reference

---

## Formal Verification Properties

### Safety Properties (坏事不发生)
- **S1**: No Orphan Threats - 每个威胁必须关联到 DFD 元素
- **S2**: Count Conservation - 威胁计数守恒
- **S3**: No Unverified Mitigations - 每个 MIT-xxx 必须有 VR-xxx
- **S4**: Complete Coverage - discovery_checklist 100% coverage

### Liveness Properties (好事终将发生)
- **L1**: Progress Guarantee - 每阶段必须产生非空输出
- **L2**: Completion Guarantee - 最终报告必须包含所有阶段输出

---

## Knowledge Base

### Files
- `knowledge/STRIDE.yml` - STRIDE threat categories
- `knowledge/security_patterns.yml` - Security design patterns
- `knowledge/cwe_mapping.yml` - CWE to STRIDE mapping

### Query Commands
```bash
kb --stride S              # Query Spoofing threats
kb --cwe CWE-287           # Query CWE-287 details
kb --asvs V3.5.3           # Query ASVS requirement
```

---

## Usage

### Creating FSM Workflow

```typescript
// 选择 FSM 模板
const workflow = await createWorkflow({
  name: "我的威胁建模",
  workflowType: "fsm",
  fsmTemplateName: "threat-modeling"
});
```

### Execution Flow

```
Node 1 → Node 2 → Node 3 → [Agent Zone] → Node 4
                         ↓
                  用户自由添加 Agent
```

---

## Entity ID Formats

| Entity | ID Format | Example |
|--------|-----------|---------|
| Module | M-{Seq:03d} | M-001 |
| Entry Point | EP-{TYPE}-{Seq:03d} | EP-API-001 |
| DFD Process | P-{Seq:03d} | P-001 |
| Data Store | DS-{Seq:03d} | DS-001 |
| Data Flow | DF-{Seq:03d} | DF-001 |
| Trust Boundary | TB-{Seq:03d} | TB-001 |
| Threat | T-{STRIDE}-{Element}-{Seq} | T-S-P-001-001 |
| Validated Risk | VR-{Seq:03d} | VR-001 |
| Mitigation | MIT-{Seq:03d} | MIT-001 |
| POC | POC-{Seq:03d} | POC-001 |

---

## File Structure

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

---

## References

- STRIDE Methodology: Microsoft Security Development Lifecycle
- OWASP ASVS: Application Security Verification Standard
- CWE: Common Weakness Enumeration
- NIST CSF: Cybersecurity Framework