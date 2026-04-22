# Phase 4: Security Design Review

**Phase Number**: 4
**Node**: Node 2 (安全评估)
**Execution Protocol**: 4-Gate (READ → ANALYZE → SYNTHESIZE → WRITE)

---

## Objective

对系统的安全设计进行全面评估，识别 16 个安全域的设计缺陷和安全缺口 (Security Gaps)。

---

## Input Contract

| Source | File | Required Fields |
|--------|------|-----------------|
| Phase 1 | P1_project_context.yaml | tech_stack, security_dependencies |
| Phase 2 | P2_dfd_elements.yaml | dfd_elements |
| Phase 3 | P3_boundary_context.yaml | boundaries, zones |

---

## READ Gate

### Actions

1. **读取 Phase 1-3 输出**
   ```yaml
   input_files:
     - P1_project_context.yaml
     - P2_dfd_elements.yaml
     - P3_boundary_context.yaml
   ```

2. **加载安全知识库**
   ```yaml
   knowledge_files:
     - knowledge/security_patterns.yml
     - knowledge/STRIDE.yml
   ```

---

## ANALYZE Gate

### 16 Security Domains

| Domain | Code | Focus Area |
|--------|------|------------|
| Authentication | AUTHN | Identity verification mechanisms |
| Authorization | AUTHZ | Access control, permissions |
| Session Management | SESSM | Session handling, tokens |
| Input Validation | INPV | Input sanitization, validation |
| Output Encoding | OUTE | Output encoding, XSS prevention |
| Cryptography | CRYPTO | Encryption, hashing, key management |
| Error Handling | ERRH | Error messages, logging |
| Logging & Monitoring | LOGM | Security logging, alerting |
| Data Protection | DATAP | Data storage, PII handling |
| Communication Security | COMM | TLS, secure channels |
| File Operations | FILEOP | File upload, path traversal |
| Memory Management | MEMM | Buffer overflow, memory safety |
| Database Security | DBSEC | SQL injection, query safety |
| API Security | APISEC | Rate limiting, input validation |
| Configuration | CONFIG | Secure defaults, hardening |
| Third-party Integration | THIRD | External service security |

### Assessment Criteria

For each domain:

```yaml
assessment:
  score: 0-100            # 安全分数
  assessed: boolean       # 是否已评估
  gaps: array             # 发现的安全缺口
  recommendations: array  # 改进建议
```

---

## SYNTHESIZE Gate

### Security Gap Format

```yaml
gaps:
  - id: GAP-{Seq:03d}     # e.g., GAP-001
    domain: AUTHN|AUTHZ|... # 安全域代码
    title: string         # 缺口标题
    severity: CRITICAL|HIGH|MEDIUM|LOW|INFO
    location: string      # 代码位置或架构位置
    description: string   # 详细描述
    affected_elements: array  # DFD 元素 IDs
    root_cause: string    # 根本原因
    recommendation: string # 修复建议
    cwe_ref: string       # CWE 参考 (可选)
    owasp_ref: string     # OWASP 参考 (可选)
```

### Output Structure

```yaml
P4_security_gaps:
  design_matrix:
    AUTHN: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    AUTHZ: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    SESSM: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    INPV: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    OUTE: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    CRYPTO: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    ERRH: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    LOGM: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    DATAP: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    COMM: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    FILEOP: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    MEMM: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    DBSEC: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    APISEC: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    CONFIG: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    THIRD: { score: number, assessed: boolean, gaps: [GAP-{Seq}] }
    
  gaps:
    - id: GAP-{Seq:03d}
      domain: string
      title: string
      severity: CRITICAL|HIGH|MEDIUM|LOW|INFO
      location: string
      description: string
      affected_elements: array
      root_cause: string
      recommendation: string
      cwe_ref: string
      owasp_ref: string
      
  gap_summary:
    total_gaps: number
    by_domain:
      AUTHN: number
      AUTHZ: number
      # ... (16 domains)
    by_severity:
      critical: number
      high: number
      medium: number
      low: number
      info: number
      
  security_score:
    overall_score: number    # 平均分数
    weakest_domains: array   # 分数最低的域
    strongest_domains: array # 分数最高的域
    
  recommendations:
    priority_order: array    # 按 severity 排序的 GAP IDs
    quick_wins: array        # 容易修复的缺口
    major_refactors: array   # 需要重大重构的缺口
```

---

## WRITE Gate

### Output File

- **Path**: `outputs/P4_security_gaps.yaml`
- **Format**: YAML

### Validation Criteria

1. **Domain Coverage**
   - 所有 16 个安全域都有 `assessed: true` 标记

2. **Gap Severity**
   - 每个缺口有 severity 分级

3. **Element Linking**
   - 每个缺口关联到 DFD 元素

---

## Validation Properties

### Safety Properties

| Property | Rule |
|----------|------|
| S4.1 | 所有 16 域必须 assessed == true |
| S4.2 | 每个缺口必须关联 affected_elements |
| S4.3 | CRITICAL/HIGH 缺口必须有 recommendation |

### Liveness Properties

| Property | Rule |
|----------|------|
| L4.1 | gaps 非空或有明确的 no_gaps_found 标记 |
| L4.2 | security_score.overall_score 有值 |
| L4.3 | design_matrix 完整包含 16 域 |

---

## Entity ID Format

| Entity | ID Format | Example |
|--------|-----------|---------|
| Security Gap | GAP-{Seq:03d} | GAP-001 |

---

## Error Recovery

### On Validation Failure

1. **Missing Domain Assessment**: 补充安全域评估
2. **Incomplete Gap Details**: 补充缺口详细信息
3. **Ralph Loop**: 最多 3 次重试

---

## Next Phase

完成后进入 **Phase 5: STRIDE Analysis**

Input Contract: P1-P4 YAML outputs