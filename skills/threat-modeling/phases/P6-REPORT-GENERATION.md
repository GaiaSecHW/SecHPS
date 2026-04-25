# Phase 8: Report Generation

**Phase Number**: 8
**Node**: Node 4 (报告生成)
**Execution Protocol**: 4-Gate (READ → ANALYZE → SYNTHESIZE → WRITE)

---

## Objective

聚合所有阶段输出和 Agent 扫描结果，生成完整的威胁建模报告，包括 8 个独立的报告文件。

---

## Input Contract

| Source | File | Description |
|--------|------|-------------|
| Phase 1 | P1_project_context.yaml | 项目上下文 |
| Phase 2 | P2_dfd_elements.yaml | DFD 元素 |
| Phase 3 | P3_boundary_context.yaml | 信任边界 |
| Phase 4 | P4_security_gaps.yaml | 安全缺口 |
| Phase 5 | P5_threat_inventory.yaml | 威胁清单 |
| Phase 6 | P6_validated_risks.yaml | 验证风险 |
| Phase 7 | P7_mitigation_plan.yaml | 缓解计划 |
| Agent Zone | vulnerabilities/*.json | Agent 扫描报告 |
| Workspace | reports/*.md/*.json | Workspace 中的报告 |

---

## READ Gate

### Actions

1. **读取所有阶段输出**
   ```yaml
   input_files:
     - P1_project_context.yaml
     - P2_dfd_elements.yaml
     - P3_boundary_context.yaml
     - P4_security_gaps.yaml
     - P5_threat_inventory.yaml
     - P6_validated_risks.yaml
     - P7_mitigation_plan.yaml
   ```

2. **读取 Agent Zone 结果**
   ```yaml
   agent_files:
     - vulnerabilities/sast-report.json
     - vulnerabilities/secrets-report.json
     - vulnerabilities/dependency-report.json
     - vulnerabilities/*.json  # 其他扫描报告
   ```

3. **扫描 Workspace 报告**
   ```yaml
   workspace_reports:
     - reports/*.md
     - reports/*.json
     - scan-reports/*.json
     - owasp-zap-report.json
     - sonarqube-report.json
   ```

---

## ANALYZE Gate

### Report Types

| Report | Filename | Content Focus |
|--------|----------|---------------|
| Risk Assessment Report | RISK-ASSESSMENT-REPORT.md | 主报告，完整风险概述 |
| Risk Inventory | RISK-INVENTORY.md | 详细风险清单 |
| Mitigation Measures | MITIGATION-MEASURES.md | 缓解措施详情 |
| Penetration Test Plan | PENETRATION-TEST-PLAN.md | POC 和渗透测试计划 |
| Architecture Analysis | ARCHITECTURE-ANALYSIS.md | 系统架构安全分析 |
| DFD Diagram | DFD-DIAGRAM.md | 数据流图和边界图 |
| Compliance Report | COMPLIANCE-REPORT.md | 合规性检查报告 |
| Attack Path Validation | ATTACK-PATH-VALIDATION.md | 攻击路径验证结果 |

### Data Aggregation

For each report:

1. **Extract Relevant Data**
   - 从阶段 YAML 提取相关字段
   - 从 Agent 报告提取漏洞数据

2. **Normalize Data Format**
   - 统一严重性分级
   - 统一 ID 格式

3. **Cross-Reference**
   - 关联威胁 → 验证风险 → 缓解措施
   - 关联 Agent 漏洞 → 威胁分析

---

## SYNTHESIZE Gate

### 报告描述语言: 中文

### Report Content Structure

#### 1. RISK-ASSESSMENT-REPORT.md (主报告)

```markdown
# Risk Assessment Report

## Executive Summary
- Project: {project_name}
- Analysis Date: {date}
- Overall Risk Level: {CRITICAL|HIGH|MEDIUM|LOW}

## Key Findings
- Total Threats: {count}
- Critical Risks: {count}
- High Risks: {count}
- Agent Findings: {count}

## Priority Actions
- P0 Items: {list}
- P1 Items: {list}

## Recommendations Summary
- Quick Wins: {list}
- Major Efforts: {list}

## Conclusion
{summary}
```

#### 2. RISK-INVENTORY.md

```markdown
# Risk Inventory

## Verified Risks
| ID | Threat | CVSS | Priority | Status |
{table}

## Theoretical Risks
{list}

## Pending Validation
{list}

## Excluded Risks
{list with reasons}
```

#### 3. MITIGATION-MEASURES.md

```markdown
# Mitigation Measures

## Mitigation Summary
| ID | Risk Ref | Type | Effectiveness | Effort |
{table}

## Implementation Details
{for each MIT}
```

#### 4. PENETRATION-TEST-PLAN.md

```markdown
# Penetration Test Plan

## POC Details
{for each POC}

## Test Sequence
{ordered test steps}

## Tools Required
{list}
```

#### 5. ARCHITECTURE-ANALYSIS.md

```markdown
# Architecture Analysis

## System Overview
{P1 summary}

## DFD Summary
{P2 summary}

## Trust Boundaries
{P3 summary}

## Security Gaps
{P4 summary}
```

#### 6. DFD-DIAGRAM.md

```markdown
# Data Flow Diagram

## Mermaid Diagram
{mermaid_source from P2}

## Element Inventory
{table}

## Boundary Diagram
{mermaid_source from P3}
```

#### 7. COMPLIANCE-REPORT.md

```markdown
# Compliance Report

## Standards Compliance
- OWASP Top 10: {status}
- CWE Coverage: {status}
- ASVS Level: {status}

## Compliance Matrix
{table}

## Gap Analysis
{list}
```

#### 8. ATTACK-PATH-VALIDATION.md

```markdown
# Attack Path Validation

## Validated Attack Paths
{for each verified risk}

## POC Results
{POC execution results}

## Unverified Paths
{theoretical/pending risks}
```

---

## WRITE Gate

### Output Files

```yaml
output_files:
  reports:
    - path: reports/RISK-ASSESSMENT-REPORT.md
      type: markdown
    - path: reports/RISK-INVENTORY.md
      type: markdown
    - path: reports/MITIGATION-MEASURES.md
      type: markdown
    - path: reports/PENETRATION-TEST-PLAN.md
      type: markdown
    - path: reports/ARCHITECTURE-ANALYSIS.md
      type: markdown
    - path: reports/DFD-DIAGRAM.md
      type: markdown
    - path: reports/COMPLIANCE-REPORT.md
      type: markdown
    - path: reports/ATTACK-PATH-VALIDATION.md
      type: markdown
      
  report_metadata:
    generated_at: datetime
    total_findings: number
    by_severity: {critical, high, medium, low}
    data_sources: array  # 来源文件列表
```

### Validation Criteria

1. **Report Completeness**
   - 8 个报告文件全部生成
   - 每个报告有完整结构

2. **Cross-Reference**
   - 每个 VR 有对应的 MIT
   - Agent 漏洞关联到威胁

3. **Data Sources**
   - 所有阶段输出被引用
   - Agent 结果被整合

---

## Validation Properties

### Safety Properties

| Property | Rule |
|----------|------|
| S8.1 | 8 个报告文件全部存在 |
| S8.2 | 每个 VR-xxx 在报告中出现 |
| S8.3 | Agent 漏洞整合到主报告 |

### Liveness Properties

| Property | Rule |
|----------|------|
| L8.1 | 主报告非空 |
| L8.2 | 至少 3 个报告有内容 |
| L8.3 | report_metadata 有值 |

---

## Report Storage Path

- **Base Path**: `reports/`
- **Files**: all Markdown files

---

## Error Recovery

### On Validation Failure

1. **Missing Reports**: 生成缺失的报告
2. **Incomplete Content**: 补充报告内容
3. **Missing Cross-Ref**: 建立关联
4. **Ralph Loop**: 最多 3 次重试

---

## 生成漏洞汇总文件
将项目vulnerabilities目录下的多个漏洞文件合并成一个文件，文件内一个漏洞一条记录，合并后的文件必须在项目根目录，漏洞描述的英文要翻译成中文，且文件名为必须为vulnerabilities.json，vulnerabilities.json文件格式如下：{
"summary": {
"total": 漏洞总数,
},
"vulnerabilities": [
{
"vulnerable": true/false,
"type": "漏洞类型（如 SQL注入、XSS、CSRF、RCE、目录遍历）",
"title": "漏洞标题",
"description": "漏洞详细描述（污点传播路径[从入口到 Sink 的数据流]）,Web 入口- 入口类: com.example.controller.AdminController - HTTP 路径: POST /admin/exec - 参数来源: @RequestBody",
"location": "必须是所有涉及此漏洞的源代码",
"POC":"[完整攻击请求 + 推导过程]",
"skill": "发现此漏洞的工具或skill名称",
"cwe_id": "CWE编号（如 CWE-89）"}
]
}

请确保 JSON 格式正确，所有字段都填写完整，禁止反馈非安全漏洞。如果未发现安全漏洞，vulnerabilities 数组必须为空。

## Completion

Phase 8 完成后，威胁建模工作流结束。

所有输出:
- `utputs/P1-P7.yaml`
- `reports/*.md`
- `vulnerabilities/*.json` (Agent Zone)