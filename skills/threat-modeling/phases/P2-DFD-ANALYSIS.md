# Phase 2: DFD Analysis

**Phase Number**: 2
**Node**: Node 1 (系统理解)
**Execution Protocol**: 4-Gate (READ → ANALYZE → SYNTHESIZE → WRITE)

---

## Objective

基于 Phase 1 的模块和入口点清单，构建数据流图 (Data Flow Diagram)，识别系统中的数据流向和处理过程。

---

## Input Contract

| Source | File | Required Fields |
|--------|------|-----------------|
| Phase 1 | P1_project_context.yaml | module_inventory, entry_point_inventory |

---

## READ Gate

### Actions

1. **读取 Phase 1 输出**
   ```yaml
   input_files:
     - P1_project_context.yaml
   ```

2. **提取关键数据**
   - 模块列表 (module_inventory)
   - 入口点列表 (entry_point_inventory)
   - 技术栈信息 (tech_stack)

---

## ANALYZE Gate

### DFD Element Identification

#### External Interactors

识别外部实体:
- 用户 (End Users)
- 第三方服务 (Third-party APIs)
- 外部系统 (External Systems)
- 管理员 (Admin Users)
- 自动化系统 (Automated Systems)

```yaml
external_interactors:
  - id: EI-{Seq:03d}           # e.g., EI-001
    name: string                # e.g., "End User"
    type: User|Service|System|Admin|Automated
    interacts_with: array       # 关联的 Entry Points
    description: string
```

#### Processes

识别数据处理过程:
- API Handler
- Business Logic
- Data Transformation
- Authentication
- Validation
- Encryption/Decryption
- File Processing

```yaml
processes:
  - id: P-{Seq:03d}            # e.g., P-001
    name: string                # e.g., "Auth Handler"
    module_ref: M-{Seq}         # 所属模块
    type: Handler|Logic|Transform|Auth|Validation|Crypto|File
    inputs: array               # 输入数据类型
    outputs: array              # 输出数据类型
    security_level: HIGH|MEDIUM|LOW
    description: string
```

#### Data Stores

识别数据存储:
- Database Tables
- File Storage
- Cache (Redis/Memory)
- Session Storage
- Configuration Files
- Log Files

```yaml
data_stores:
  - id: DS-{Seq:03d}           # e.g., DS-001
    name: string                # e.g., "User Database"
    type: Database|File|Cache|Session|Config|Log
    module_ref: M-{Seq}         # 所属模块
    data_type: string           # 存储的数据类型
    sensitivity: HIGH|MEDIUM|LOW
    access_control: boolean
    encryption: boolean
    description: string
```

#### Data Flows

识别数据流向:
- User → API
- API → Database
- Service → Service
- Database → Cache
- External → Internal

```yaml
data_flows:
  - id: DF-{Seq:03d}           # e.g., DF-001
    name: string                # e.g., "User Login Request"
    source: EI-{Seq}|P-{Seq}    # 数据来源
    destination: P-{Seq}|DS-{Seq}|EI-{Seq}  # 数据目标
    data_type: string           # 数据类型
    protocol: HTTP|HTTPS|WebSocket|TCP|UDP|Internal
    authentication: boolean     # 是否需要认证
    encryption: boolean         # 是否加密
    sensitivity: HIGH|MEDIUM|LOW
    description: string
```

---

## SYNTHESIZE Gate

### Coverage Analysis

计算 L1 Coverage (Level 1 Coverage):

```yaml
l1_coverage:
  total_modules: number         # 来自 P1
  covered_modules: number       # 已绘制 DFD 的模块数
  coverage_percentage: number   # 必须达到 100%
  
  total_entry_points: number    # 来自 P1
  covered_entry_points: number  # 已关联到 DFD 元素的入口点
  entry_coverage_percentage: number
```

### Output Structure

```yaml
P2_dfd_elements:
  dfd_elements:
    external_interactors: array  # EI-{Seq}
    processes: array             # P-{Seq}
    data_stores: array           # DS-{Seq}
    data_flows: array            # DF-{Seq}
    
  element_mapping:
    - entry_point: EP-{TYPE}-{Seq}
      mapped_to: P-{Seq}|EI-{Seq}  # 入口点映射到 DFD 元素
      confidence: HIGH|MEDIUM|LOW
      
  l1_coverage:
    coverage_percentage: 100     # 必须 100%
    module_coverage:
      - module: M-{Seq}
        covered: boolean
        elements: [P-{Seq}, DS-{Seq}]
    entry_point_coverage:
      - entry_point: EP-{TYPE}-{Seq}
        covered: boolean
        mapped_to: P-{Seq}
        
  dfd_diagram:
    mermaid_source: string       # Mermaid 图表源码
    description: string
```

---

## WRITE Gate

### Output File

- **Path**: `outputs/P2_dfd_elements.yaml`
- **Format**: YAML

### Validation Criteria

1. **L1 Coverage**
   - `l1_coverage.coverage_percentage == 100%`
   - 所有模块必须有对应的 DFD 元素

2. **Element Count**
   - 至少有一个 External Interactor
   - 至少有一个 Process
   - 至少有一个 Data Store
   - 至少有一个 Data Flow

3. **Entry Point Mapping**
   - 所有 Entry Points 映射到 DFD 元素

---

## Validation Properties

### Safety Properties

| Property | Rule |
|----------|------|
| S2.1 | 每个模块必须映射到至少一个 DFD 元素 |
| S2.2 | 每个数据流必须有 source 和 destination |
| S2.3 | Data Store 必须标记 sensitivity |

### Liveness Properties

| Property | Rule |
|----------|------|
| L2.1 | dfd_elements 至少包含 4 种元素各一个 |
| L2.2 | l1_coverage.coverage_percentage == 100% |
| L2.3 | element_mapping 非空 |

---

## Entity ID Format

| Entity | ID Format | Example |
|--------|-----------|---------|
| External Interactor | EI-{Seq:03d} | EI-001 |
| Process | P-{Seq:03d} | P-001 |
| Data Store | DS-{Seq:03d} | DS-001 |
| Data Flow | DF-{Seq:03d} | DF-001 |

---

## Error Recovery

### On Validation Failure

1. **Coverage < 100%**: 深入分析未覆盖模块
2. **Missing Elements**: 补充缺失的 DFD 元素类型
3. **Ralph Loop**: 最多 3 次重试

---

## Next Phase

完成后进入 **Phase 3: Trust Boundary**

Input Contract: P1_project_context.yaml, P2_dfd_elements.yaml