# Phase 3: Trust Boundary Analysis

**Phase Number**: 3
**Node**: Node 2 (安全评估)
**Execution Protocol**: 4-Gate (READ → ANALYZE → SYNTHESIZE → WRITE)

---

## Objective

基于 Phase 1-2 的输出，识别系统的信任边界，将 DFD 元素分配到不同的信任区域，为威胁分析提供安全边界上下文。

---

## Input Contract

| Source | File | Required Fields |
|--------|------|-----------------|
| Phase 1 | P1_project_context.yaml | module_inventory, tech_stack |
| Phase 2 | P2_dfd_elements.yaml | dfd_elements, element_mapping |

---

## READ Gate

### Actions

1. **读取 Phase 1-2 输出**
   ```yaml
   input_files:
     - P1_project_context.yaml
     - P2_dfd_elements.yaml
   ```

2. **提取关键数据**
   - External Interactors
   - Processes
   - Data Stores
   - Data Flows
   - 技术栈信息 (识别信任边界类型)

---

## ANALYZE Gate

### Trust Boundary Types

| Type | Description | Example |
|------|-------------|---------|
| Network | 网络边界 (Internet/DMZ/Internal) | Public API → Internal Service |
| Process | 进程边界 (不同运行上下文) | Web Server → Database Process |
| User | 用户边界 (不同角色权限) | Admin → Regular User |
| Data | 数据边界 (敏感/非敏感) | PII Storage → Log Storage |
| Service | 服务边界 (微服务边界) | Auth Service → Payment Service |
| Cloud | 云边界 (公有/私有/混合) | AWS → On-premise |
| Container | 容器边界 (Docker/K8s) | Pod A → Pod B |
| VM | 虚拟机边界 | VM-1 → VM-2 |

### Boundary Identification Rules

1. **Network Boundaries**
   - External Interactor → Process (Internet → DMZ)
   - Process → Process (DMZ → Internal)
   - Data Flow crossing different networks

2. **Process Boundaries**
   - Different runtime contexts
   - Different privilege levels
   - Different security configurations

3. **User Boundaries**
   - Different authentication levels
   - Different authorization scopes
   - Admin vs Regular User

4. **Data Boundaries**
   - Data flows from HIGH → LOW sensitivity
   - Crosses encryption boundaries
   - Access control changes

---

## SYNTHESIZE Gate

### Boundary Zones

```yaml
zones:
  - id: Z-{Seq:03d}            # e.g., Z-001
    name: string                # e.g., "Public Internet"
    type: Network|Process|User|Data|Service|Cloud|Container|VM
    trust_level: PUBLIC|DMZ|INTERNAL|TRUSTED|HIGHLY_TRUSTED
    elements: array             # 包含的 DFD 元素 IDs
    description: string
```

### Output Structure

```yaml
P3_boundary_context:
  boundaries:
    - id: TB-{Seq:03d}         # e.g., TB-001
      type: Network|Process|User|Data|Service|Cloud|Container|VM
      name: string             # e.g., "Internet-DMZ Boundary"
      source_zone: Z-{Seq}     # e.g., Z-001 (Public Internet)
      destination_zone: Z-{Seq}  # e.g., Z-002 (DMZ)
      crossing_data_flows: array  # DF-{Seq} 列表
      security_controls: array
        - type: Firewall|TLS|Auth|WAF|IPS
        - strength: STRONG|MEDIUM|WEAK|NONE
      description: string
      
  zones:
    - id: Z-{Seq:03d}
      name: string
      type: Network|Process|User|Data|Service|Cloud|Container|VM
      trust_level: PUBLIC|DMZ|INTERNAL|TRUSTED|HIGHLY_TRUSTED
      elements:
        - element_id: EI-{Seq}|P-{Seq}|DS-{Seq}
          element_type: ExternalInteractor|Process|DataStore
      description: string
      
  element_zone_mapping:
    - element_id: EI-{Seq}|P-{Seq}|DS-{Seq}|DF-{Seq}
      zone_ref: Z-{Seq}
      boundary_crossing: boolean
      boundaries_crossed: array  # TB-{Seq} 列表
      
  boundary_summary:
    total_boundaries: number
    by_type:
      network: number
      process: number
      user: number
      data: number
      service: number
    by_strength:
      strong: number
      medium: number
      weak: number
      none: number
```

---

## WRITE Gate

### Output File

- **Path**: `outputs/P3_boundary_context.yaml`
- **Format**: YAML
- **描述语言**: 中文

### Validation Criteria

1. **Element Coverage**
   - 所有 DFD 元素映射到信任区域
   - 每个 Zone 包含至少一个元素

2. **Boundary Crossing**
   - 所有跨边界数据流识别完成
   - 每个边界有安全控制标记

---

## Validation Properties

### Safety Properties

| Property | Rule |
|----------|------|
| S3.1 | 所有 DFD 元素必须映射到 Zone |
| S3.2 | 跨边界数据流必须有安全控制 |
| S3.3 | HIGH sensitivity 数据必须有 STRONG 边界 |

### Liveness Properties

| Property | Rule |
|----------|------|
| L3.1 | boundaries 非空 |
| L3.2 | zones 非空，至少 2 个 Zone |
| L3.3 | element_zone_mapping 完整 |

---

## Entity ID Format

| Entity | ID Format | Example |
|--------|-----------|---------|
| Trust Boundary | TB-{Seq:03d} | TB-001 |
| Zone | Z-{Seq:03d} | Z-001 |

---

## Error Recovery

### On Validation Failure

1. **Unmapped Elements**: 补充元素映射
2. **Missing Boundaries**: 识别遗漏的边界
3. **Ralph Loop**: 最多 3 次重试

---

## Next Phase

完成后进入 **Phase 4: Security Design Review**

Input Contract: P1-P3 YAML outputs