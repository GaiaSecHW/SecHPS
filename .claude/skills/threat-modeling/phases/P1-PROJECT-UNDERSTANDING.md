# Phase 1: Project Understanding

**Phase Number**: 1
**Node**: Node 1 (系统理解)
**Execution Protocol**: 4-Gate (READ → ANALYZE → SYNTHESIZE → WRITE)

---

## Objective

建立项目的完整上下文理解，包括技术栈、模块结构、入口点清单，为后续威胁建模提供基础数据。

---

## Input

| Source | Description |
|--------|-------------|
| Workspace | 项目根目录路径 |
| User Input | 项目描述、特殊关注点 (可选) |

---

## READ Gate

### Actions

1. **扫描项目目录结构**
   - 识别顶层目录和子目录
   - 标记源码目录、配置目录、数据目录

2. **识别技术栈**
   - 检测 package.json / requirements.txt / Cargo.toml / pom.xml 等
   - 识别框架和库依赖
   - 标记安全相关依赖 (auth, crypto, session 等)

3. **扫描入口点类型**
   - API 路由文件
   - UI 页面/组件
   - CLI 入口
   - WebSocket handlers
   - Background jobs
   - Database triggers
   - File watchers
   - Event handlers
   - Message queue consumers
   - Cron jobs
   - Hook triggers
   - Plugin loaders
   - Service mesh endpoints
   - GraphQL resolvers

---

## ANALYZE Gate

### Module Analysis

对每个模块执行:

1. **功能识别**
   - 核心业务逻辑
   - 数据处理流程
   - 外部系统集成

2. **安全敏感度评级**
   ```
   HIGH: Auth, Crypto, Payment, Admin, User Data
   MEDIUM: API handlers, Data transformation, File operations
   LOW: Static content, Utilities, Logging
   ```

3. **入口点分类**
   ```
   API: REST/GraphQL endpoints
   UI: Web/Mobile pages, Components
   CLI: Command line interface
   WebSocket: Real-time connections
   Background: Jobs, Workers, Cron
   Database: Triggers, Stored procedures
   File: File upload/download handlers
   Event: Event listeners, Pub/Sub
   Queue: Message queue consumers
   Hook: Git hooks, CI hooks, Webhooks
   Plugin: Plugin entry points
   Service: Service mesh, RPC
   GraphQL: GraphQL resolvers
   ```

---

## SYNTHESIZE Gate

### Output Structure

```yaml
P1_project_context:
  metadata:
    project_name: string
    project_type: web|mobile|cli|service|hybrid
    tech_stack:
      - framework: string
      - language: string
      - runtime: string
    security_dependencies:
      - name: string
      - version: string
      - purpose: auth|crypto|session|validation
      
  module_inventory:
    modules:
      - id: M-{Seq:03d}          # e.g., M-001
        name: string              # e.g., "auth-service"
        path: string              # e.g., "src/services/auth"
        security_level: HIGH|MEDIUM|LOW
        functions:
          - name: string
          - security_relevant: boolean
        dependencies:
          - module_ref: M-{Seq}
          - type: internal|external
          
  entry_point_inventory:
    entry_points:
      - id: EP-{TYPE}-{Seq:03d}  # e.g., EP-API-001
        type: API|UI|CLI|WebSocket|Background|Database|File|Event|Queue|Hook|Plugin|Service|GraphQL
        path: string              # e.g., "src/api/routes/auth.ts"
        module_ref: M-{Seq}       # 所属模块
        auth_required: boolean
        input_types: array        # 输入数据类型
        output_types: array       # 输出数据类型
        security_sensitive: boolean
        
  discovery_checklist:
    checklist:
      api: { scanned: boolean, count: number }
      ui: { scanned: boolean, count: number }
      cli: { scanned: boolean, count: number }
      websocket: { scanned: boolean, count: number }
      background: { scanned: boolean, count: number }
      database: { scanned: boolean, count: number }
      file: { scanned: boolean, count: number }
      event: { scanned: boolean, count: number }
      queue: { scanned: boolean, count: number }
      hook: { scanned: boolean, count: number }
      plugin: { scanned: boolean, count: number }
      service: { scanned: boolean, count: number }
      graphql: { scanned: boolean, count: number }
      cron: { scanned: boolean, count: number }
      
  security_notes:
    - finding: string
    - location: string
    - severity: INFO|LOW|MEDIUM|HIGH
```

---

## WRITE Gate

### Output File

- **Path**: `.claude/skills/threat-modeling/outputs/P1_project_context.yaml`
- **Format**: YAML

### Validation Criteria

1. **Discovery Checklist Coverage**
   - 所有 14 种入口类型必须扫描完成
   - `checklist.{type}.scanned == true` for all types

2. **Module Inventory**
   - 每个模块有唯一 ID (M-{Seq:03d})
   - 安全敏感度评级完整

3. **Entry Point Inventory**
   - 每个入口点有唯一 ID (EP-{TYPE}-{Seq:03d})
   - 与模块关联完整

---

## Validation Properties

### Safety Properties

| Property | Rule |
|----------|------|
| S1.1 | 每个模块必须有 security_level |
| S1.2 | 每个入口点必须关联到模块 |
| S1.3 | discovery_checklist 所有类型必须 scanned |

### Liveness Properties

| Property | Rule |
|----------|------|
| L1.1 | module_inventory.modules 非空 |
| L1.2 | 至少一个入口点被识别 |
| L1.3 | tech_stack 包含至少一个框架 |

---

## Entity ID Format

| Entity | ID Format | Example |
|--------|-----------|---------|
| Module | M-{Seq:03d} | M-001, M-002 |
| Entry Point | EP-{TYPE}-{Seq:03d} | EP-API-001, EP-UI-001 |

---

## Error Recovery

### On Validation Failure

1. **Missing Scans**: 补充扫描缺失的入口类型
2. **Incomplete Module**: 深入分析模块代码结构
3. **Ralph Loop**: 最多 3 次重试，注入错误反馈

---

## Next Phase

完成后进入 **Phase 2: DFD Analysis**

Input Contract: P1_project_context.yaml