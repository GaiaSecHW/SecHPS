# Phase 5: STRIDE Analysis

**Phase Number**: 5
**Node**: Node 3 (威胁分析)
**Execution Protocol**: 4-Gate (READ → ANALYZE → SYNTHESIZE → WRITE)

---

## Objective

基于 STRIDE 威胁分类框架，对系统所有 DFD 元素进行威胁分析，生成威胁清单。

---

## Input Contract

| Source | File | Required Fields |
|--------|------|-----------------|
| Phase 1 | P1_project_context.yaml | module_inventory |
| Phase 2 | P2_dfd_elements.yaml | dfd_elements |
| Phase 3 | P3_boundary_context.yaml | boundaries, zones |
| Phase 4 | P4_security_gaps.yaml | gaps |

---

## READ Gate

### Actions

1. **读取 Phase 1-4 输出**
   ```yaml
   input_files:
     - P1_project_context.yaml
     - P2_dfd_elements.yaml
     - P3_boundary_context.yaml
     - P4_security_gaps.yaml
   ```

2. **加载 STRIDE 知识库**
   ```yaml
   knowledge_files:
     - knowledge/STRIDE.yml
   ```

---

## ANALYZE Gate

### STRIDE Categories

| Category | Letter | Threat Type | Focus |
|----------|--------|-------------|-------|
| Spoofing | S | 身份伪造 | Impersonating user or process |
| Tampering | T | 数据篡改 | Modifying data or code |
| Repudiation | R | 行为抵赖 | Denying actions performed |
| Information Disclosure | I | 信息泄露 | Exposing data to unauthorized |
| Denial of Service | D | 拒绝服务 | Disrupting service availability |
| Elevation of Privilege | E | 权限提升 | Gaining unauthorized privileges |

### Analysis Targets

For each DFD element type:

#### External Interactors (EI-{Seq})

| STRIDE | Applicable | Focus |
|--------|------------|-------|
| S | ✅ | 身份伪造 (Impersonation) |
| T | ❌ | 不适用 |
| R | ✅ | 行为抵赖 (Repudiation) |
| I | ❌ | 不适用 |
| D | ❌ | 不适用 |
| E | ✅ | 权限提升 (Privilege escalation) |

#### Processes (P-{Seq})

| STRIDE | Applicable | Focus |
|--------|------------|-------|
| S | ✅ | 进程伪造 |
| T | ✅ | 进程篡改 |
| R | ✅ | 日志抵赖 |
| I | ✅ | 数据泄露 |
| D | ✅ | 进程崩溃 |
| E | ✅ | 权限提升 |

#### Data Stores (DS-{Seq})

| STRIDE | Applicable | Focus |
|--------|------------|-------|
| S | ❌ | 不适用 |
| T | ✅ | 数据篡改 |
| R | ✅ | 操作抵赖 |
| I | ✅ | 数据泄露 |
| D | ✅ | 数据损坏 |
| E | ❌ | 不适用 |

#### Data Flows (DF-{Seq})

| STRIDE | Applicable | Focus |
|--------|------------|-------|
| S | ✅ | 流量伪造 |
| T | ✅ | 流量篡改 |
| R | ✅ | 流量抵赖 |
| I | ✅ | 流量嗅探 |
| D | ✅ | 流量阻断 |
| E | ❌ | 不适用 |

---

## SYNTHESIZE Gate

### Threat Format

```yaml
threats:
  - id: T-{STRIDE}-{Element}-{Seq}  # e.g., T-S-EI-001-001
    stride_category: S|T|R|I|D|E
    element_id: EI-{Seq}|P-{Seq}|DS-{Seq}|DF-{Seq}
    element_type: ExternalInteractor|Process|DataStore|DataFlow
    title: string
    description: string
    attack_vector: string
    affected_assets: array
    prerequisites: array
    potential_impact: string
    severity: CRITICAL|HIGH|MEDIUM|LOW
    likelihood: HIGH|MEDIUM|LOW
    related_gap: GAP-{Seq}      # 关联 Phase 4 缺口
    cwe_ref: string
    owasp_ref: string
```

### Output Structure

```yaml
P5_threat_inventory:
  threats: array              # T-{STRIDE}-{Element}-{Seq}
  
  element_coverage:
    total_elements: number    # 来自 P2 的总元素数
    analyzed_elements: number # 已分析元素数
    coverage_percentage: number  # 必须 >= 80%
    
    element_analysis_status:
      - element_id: EI-{Seq}|P-{Seq}|DS-{Seq}|DF-{Seq}
        analyzed: boolean
        threat_count: number
        stride_coverage: array  # [S, T, R, I, D, E]
        
  threat_summary:
    total_threats: number
    by_stride:
      S: number
      T: number
      R: number
      I: number
      D: number
      E: number
    by_severity:
      critical: number
      high: number
      medium: number
      low: number
    by_element_type:
      ExternalInteractor: number
      Process: number
      DataStore: number
      DataFlow: number
      
  element_coverage_verification:
    coverage_percentage: number  # >= 80%
    missing_elements: array      # 未分析元素 IDs
    incomplete_stride_coverage: array  # STRIDE 分析不完整元素
    
  count_conservation:
    total_threats: number
    sum_by_stride: number        # S+T+R+I+D+E
    conservation_verified: boolean
```

---

## WRITE Gate

### Output File

- **Path**: `outputs/P5_threat_inventory.yaml`
- **Format**: YAML

### Validation Criteria

1. **Element Coverage**
   - `element_coverage.coverage_percentage >= 80%`
   - 所有关键元素 (HIGH sensitivity) 必须分析

2. **Count Conservation**
   - `total_threats == sum(by_stride)`
   - 威胁计数守恒

3. **STRIDE Coverage**
   - 每个元素按类型分析适用的 STRIDE 类别

---

## Validation Properties

### Safety Properties

| Property | Rule |
|----------|------|
| S5.1 | element_coverage >= 80% |
| S5.2 | 每个威胁必须关联 element_id |
| S5.3 | count_conservation 验证通过 |

### Liveness Properties

| Property | Rule |
|----------|------|
| L5.1 | threats 非空 |
| L5.2 | threat_summary 所有统计有值 |
| L5.3 | element_coverage_verification 存在 |

---

## Entity ID Format

| Entity | ID Format | Example |
|--------|-----------|---------|
| Threat | T-{STRIDE}-{Element}-{Seq} | T-S-EI-001-001, T-I-P-002-001 |

---

## Error Recovery

### On Validation Failure

1. **Low Coverage**: 补充未分析元素
2. **Count Mismatch**: 重新计算威胁统计
3. **Missing STRIDE**: 补充缺失的 STRIDE 类别
4. **Ralph Loop**: 最多 3 次重试

---

## Next Phase

完成后进入 **Phase 6: Risk Validation**

Input Contract: P1-P5 YAML outputs