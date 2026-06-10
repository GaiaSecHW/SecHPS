# CodeDMap (CDM) — Skill 编写背景知识

> 编写新 skill 时的背景参考。避免每次都重新阅读项目文档。

---

## 一、项目定位

**CodeDMap（CDM）是源代码的数字孪生**：把源码、AST、控制流图、数据流图、调用关系全部融合成一张可查询的 CPG（Code Property Graph）图数据库。这是一套面向 LLM/Agent 的**代码审计基础设施**，不是传统 SAST 工具。

核心价值主张：
- CPG 提供**结构化导航能力**（图查询、污点追踪、模块划分）
- Agent 原生能力提供**语义理解能力**（源码阅读、业务逻辑推理、漏洞验证）
- 两者结合才能覆盖静态分析的盲区

**关键约束**：CPG 只包含代码元数据（AST、调用图、类型信息），不含实际源码。Agent 在审计时**必须**通过原生工具（Read/Grep）读取真实源码确认。

---

## 二、漏洞挖掘三阶段架构

```text
阶段一：基础构建（人类操作）
  cdm build → graph.db → 可选启动 cdm serve 提供远程 REST API

阶段二：代码地图勘测（Surveyor Agent）
  丰富图谱语义 → 修复断链 → 识别隐藏攻击面 → 划分模块 → 扩展规则

阶段三：漏洞狩猎（Hunter Agent）
  基于已测绘图谱 → 从攻击面入口出发 → 挖掘可利用漏洞链
```

---

## 三、三角色 Trinity 架构

### 角色一：代码地图勘察员（Map Surveyor）
**定位**：铺路先锋，只回答"这是什么"，不判断"有没有洞"

三个核心产出维度：
1. **结构产出**：模块划分（`module create` + `module assign`）+ 断链修复（`repair link`）
2. **语义产出**：L2 SEMANTIC 标签（隐藏入口/桥接/边界）+ L1 协作标签（GUARD/SANITIZER/ROLE，需 justification）
3. **规则产出**：`rules add_sink` / `add_source` / `add_entrypoint` / `add_safe` — 将项目特有安全原语提升为全局知识

关键方法论：
- **OS API 自底向上溯源**：从 `recvmsg`/`read` 等底层 API 向上追踪到业务解析层（见第九节）
- **守卫/净化器排雷**：标注 `ONTOLOGY:GUARD:*` / `ONTOLOGY:SANITIZER:*` 为猎人排除死胡同
- **Bounty Board 交接**：Phase 7 输出结构化 JSON 悬赏板，供猎人程序化读取

**Skill 文件**：`.claude/skills/map-surveyor.md`

---

### 角色二：漏洞狩猎专家（Vulnerability Hunter）
**定位**：攻击导向，从入口出发找完整漏洞利用链，留下审计铁证

核心设计决策：
- **CPG trace 的定位是"快速筛选工具"而非最终裁判**。`found_controllable=false` 不代表安全，可能是断链。最终验证必须读源码。
- **对抗性思维**：遇到 GUARD/SANITIZER 标签，第一反应不是放弃而是寻找绕过方案
- **Bounty Board 优先**：Phase 1 首先读取勘测员的结构化悬赏板，耗尽后才广度搜索
- **Orchestrator-Worker 模式**：主 agent 调度，sub-agent 深度调查（见第八节）

写入域限制：
- 只能写 `SEMANTIC:VULN:*`（漏洞标签）、`STATE:*`（审计状态）、`note add`（审计笔记）
- L1 标签完全不可写（含协作型）、勘测员 SEMANTIC 标签只读、规则引擎只读

**Skill 文件**：`.claude/skills/vuln-hunter.md`

---

### 角色三：安全策略与资产管家（Policy & Asset Manager）
**定位**：后台运维，事件驱动（不主动探索），维护规则库 + 管理图谱生命周期

五个触发场景：
- A. 猎人反馈误报/漏报 → 更新规则库
- B. 外部 CVE 情报 → 注入新规则 + enhance 重打标
- C. 代码版本升级 → 导出资产 → 重建图谱 → 重新锚定
- D. 多项目合并 → diff 确认冲突 → merge
- E. 定期健康检查

**关键红线**：`build start` 必须人工确认；`assets merge` 前必须先 `assets diff`

**Skill 文件**：`.claude/skills/policy-manager.md`

---

## 四、标签体系（Tag System）三层架构

这是整个多智能体协作的"语言"，必须理解。详细文档见 `docs/TAG_SYSTEM.md`。

| 层级 | 前缀 | 可写者 | 性质 | 用途 |
|------|------|--------|------|------|
| **L1 ONTOLOGY** | `ONTOLOGY:` | 见下文分类 | 100% 确定性 | 本体知识，规则引擎自动生成或 Agent 协作标注 |
| **L2 SEMANTIC** | `SEMANTIC:` | Agent/AI 可写 | 概率性（带 confidence）| 语义推断标注，带 Provenance 溯源 |
| **L3 STATE** | `STATE:` | Agent/人类 可写 | 审计状态 | 进度追踪，需 justification |

### L1 权限分类（关键区分）

| 类型 | 命名空间 | Agent 可写？ |
|------|---------|------------|
| **系统只读** | ENTRY_POINT, SOURCE, SINK | 不可写，由规则引擎自动生成 |
| **协作可写** | GUARD, SANITIZER, ROLE | 可写，但**必须**提供 `--justification` |

### L1 完整标签目录（6 命名空间，39 标签）

**ENTRY_POINT**（系统只读）：`NETWORK_LISTENER`, `IPC_HANDLER`, `CLI_COMMAND`, `PLUGIN_HOOK`, `SYSCALL_HANDLER`, `IOCTL_HANDLER`, `HARDWARE_IRQ`

**SOURCE**（系统只读）：`NETWORK_DATA`, `FILE_DATA`, `ENV_DATA`, `IPC_DATA`, `USER_SPACE_DATA`, `HARDWARE_STATE`, `DESERIALIZED_OBJECT`

**SINK**（系统只读）：`MEMORY_WRITE`, `INFO_LEAK`, `MEMORY_ALLOC`, `MEMORY_FREE`, `PRIVILEGE_MUTATION`, `OS_COMMAND`, `CODE_EVAL`, `FILE_ACCESS`, `DB_EXECUTE`, `VIEW_RENDER`

**GUARD**（协作可写）：`BOUNDS_CHECK`, `NULL_CHECK`, `TYPE_CHECK`, `AUTH_CHECK`, `STATE_CHECK`

**SANITIZER**（协作可写）：`ESCAPE`, `ENCODE`, `TYPE_CAST`, `TRUNCATE`, `NORMALIZE`

**ROLE**（协作可写）：`BOUNDARY`, `LOGIC_PROVIDER`, `DATA_STORAGE`, `INFRASTRUCTURE`, `DRIVER`, `KERNEL_CORE`, `UTILITY`

> **命名哲学**：L1 按**客观操作类型**命名（如 `MEMORY_WRITE`），而非按漏洞类型命名（旧方案的 `BUFFER_OVERFLOW`）。

### 勘察员专属 L2 标签域
```text
SEMANTIC:ENTRY_POINT:CUSTOM_RPC / PLUGIN / PROTOCOL_DISPATCH / UNKNOWN
SEMANTIC:ROUTER:CMD_DISPATCHER / PROTOCOL_MUX
SEMANTIC:BRIDGE:IPC / CALLBACK / SYSCALL
SEMANTIC:BOUNDARY:TRUST / PRIVILEGE
```

### 猎人专属 L2+L3 标签域
```text
SEMANTIC:VULN:BUFFER_OVERFLOW / COMMAND_INJECTION / FORMAT_STRING /
  SQL_INJECTION / PATH_TRAVERSAL / USE_AFTER_FREE / INTEGER_OVERFLOW /
  PRIVILEGE_ESCALATION / INFO_LEAK / RACE_CONDITION / AUTH_BYPASS / CRYPTO_WEAKNESS

STATE:CONFIRMED_VULN / SUSPICIOUS / FALSE_POSITIVE / REVIEWED
```

### Tag 与 Module 正交定律

| 维度 | Module (`cdm module`) | Tag (`cdm tag`) |
|------|----------------------|-----------------|
| 粒度 | **宏观**：目录/文件级别 | **微观**：方法/AST 节点级别 |
| 用途 | 划分业务领域与子系统 | 标记节点语义与操作行为 |
| 元数据 | `description`（它的职责） | `justification`（为什么打这个标） |
| 错误用法 | 把函数建成 Module | 给整个目录打标签 |

---

## 五、Note 系统

详细文档见 `docs/NOTE_SYSTEM.md`。

Note 是 `InsightNode` 类型的一等公民图节点，支持挂载到 0/1/N 个目标节点。

### NoteCategory 枚举（5 个值）
| 类别 | 用途 |
|------|------|
| `ARCHITECTURE` | 结构观察：模块边界、设计模式 |
| `DATA_FLOW` | 污点路径、数据流、溯源分析 |
| `CONTROL_FLOW` | 执行路径、分支条件 |
| `VULNERABILITY` | 确认或可疑安全问题 |
| `COORDINATION` | Agent 间交接笔记（Bounty Board、断链反馈等） |

### 渐进式披露
- `note list` → 返回摘要（无 content），用于扫描
- `note show --note-id <id>` → 返回完整内容，用于精读

---

## 六、Module 系统

详细文档见 `docs/MODULE_SYSTEM.md`。

### 核心操作
- `module create <name> --description "..."` — 创建模块（description 必填）
- `module assign --name <name> --paths "*.c" --justification "..." --confidence 0.9` — 分配文件
- `module show <name>` — 查看模块详情和文件列表
- `module deps [<name>]` — 模块间依赖拓扑
- `module of -f <function>` — 反向查找：函数属于哪个模块

### 模块作用域查询
`query entrypoints --module <name>`, `query search --module <name>`, `tag find --module <name>` 等支持 `--module` 参数聚焦到特定子系统。

---

## 七、命令域总览（9 域）

| 域 | 用途 | 勘察员 | 猎人 | 管家 |
|----|------|--------|------|------|
| `query` | 图查询：search/inspect/trace/entrypoints/sources/sinks/guards/sanitizers/roles/stats/tree | 读 | 读 | 读 |
| `tag` | 标签 CRUD：add/remove/list/find/bulk | 写（L2 SEMANTIC + L1 协作） | 写（VULN/STATE 域） | 读 |
| `note` | 笔记 CRUD：add/list/show/remove | 写 | 写 | 写 |
| `module` | 模块管理：create/delete/rename/list/show/assign/remove/of/deps | **独占** | 只读（list/show/of/deps） | 读 |
| `repair` | 调用链修复：link/suggest/list/undo | **独占** | 禁用 | 读 |
| `rules` | 规则管理：list/categories/show/resolve/add_sink/add_source/add_safe/add_entrypoint/tombstone/validate | 写（Phase 6 全局集采） | 只读（resolve） | 写 |
| `build` | 构建：start/status/enhance | 禁用 | 禁用 | **独占**（需人工确认） |
| `assets` | 资产迁移：export/import/diff/anchor/merge | 禁用 | 禁用 | **独占** |
| `discover` | 工具发现（列出服务端可用工具） | 读 | 读 | 读 |

---

## 八、多 Agent 架构原则

漏洞审计是扇形展开的工作，单线程调查多目标必然导致上下文爆炸。

### Orchestrator-Worker 模式
- 主 agent = 调度者，负责情报收集、目标排序、派发、收摘要
- sub-agent = 工作者，负责单个目标的完整深度调查，**直接写 CPG**，只返回一行摘要

### 触发阈值
需深度调查的目标 ≥ 3 个时启用 sub-agent 并行

### Sub-agent 输出约束
- 返回格式：`[目标] [verdict: VULN/CLEAN/UNCLEAR] [漏洞类型/排除原因] [已写入的 node_id]`
- 严禁在返回中附带大段源码分析或思考过程，一切证据已记录在 CPG Note 中

### 并行安全性
- 读操作（query/search/trace/tag find）：完全安全，可随意并行
- 写操作（tag add/note add/repair link）：sub-agent 内部串行，不同 sub-agent 写不同节点安全

### Agent 生存法则（所有角色通用）
1. **保护上下文**：严禁一次性读取大文件，用行号范围/精准 grep 获取片段
2. **限制 trace 深度**：执行 `query trace` 时必须 `--depth 10~15`，防止 JSON 爆炸
3. **未知妥协机制**：反复确认 3 次仍不确定 → 不强行判定，用标签/note 记录悬案移交

---

## 九、重要概念：OS API 与业务层控制点的区别

写任何涉及网络/IO 审计的 skill 时必须清楚：

**错误认知**：`recvmsg` 接收报文 → 整个报文用户可控 → 标记 `recvmsg` 为入口点

**正确认知**：
```text
recvmsg(fd, buf, len)        ← OS API，接收完整原始报文，【不打 ENTRY_POINT 标签】
    └── recv_loop()          ← 基础设施层，循环读取
        └── parse_frame()    ← 协议解析层，将 bytes 解析为结构体
            └── dispatch_cmd() ← 【真正的 ENTRY_POINT:PROTOCOL_DISPATCH】
                              ← 在这里，用户可控字段才被提取出来
```

**用户可控 ≠ 整个报文**：
- 报文 header（魔数、版本号、长度）：由协议栈/客户端 SDK 生成，攻击者通常不能任意构造
- payload 中的命令 ID：**用户可控**
- payload 中的数据体：**用户可控**
- source_addr / fd：由内核填充，不可控

**勘察员的职责**：找到 `dispatch_cmd` 这一层，并用 `note add --category DATA_FLOW` 明确记录哪些字段是用户可控的。

---

## 十、CPG 技术约束（Skill 编写时的边界意识）

| 局限 | 表现 | Skill 应对方式 |
|------|------|--------------|
| 函数指针/回调 | `trace` 调用链在间接调用处截断 | 勘察员用 `repair link` 搭桥；猎人转原生工具追踪 |
| 跨进程 IPC | `dataflow` 在进程边界中断 | 勘察员标注 `SEMANTIC:BRIDGE:IPC`；猎人结合标注读源码 |
| 环境变量 | `getenv` 后断链 | 猎人假设可控，读源码确认 |
| 业务逻辑漏洞 | 无 sink 命中 | CPG 无法覆盖，完全依赖 Agent 语义理解 |
| 大型项目性能 | 节点数 > 10K 时全图分析慢 | 勘察员先 `module create` + `module assign` 划分子系统再分析 |

---

## 十一、关键设计原则（Skill 编写时必须遵守）

1. **命令语法不写在 Skill 里**：所有命令语法细节在 `cdm` skill（`.claude/skills/cdm/SKILL.md`）里，skill 只引用它。
2. **角色标签域严格隔离**：每个 skill 必须明确"写入域"和"只读域"，防止角色越权。
3. **L1 系统只读标签不可手动写**：ENTRY_POINT/SOURCE/SINK 是系统级约束。
4. **L1 协作标签需 justification**：GUARD/SANITIZER/ROLE 仅限勘察员写入，必须附理由。
5. **强制置信度声明**：所有写入操作必须携带 `--confidence` 参数。
6. **CPG trace 是筛选工具，不是最终裁判**：`found_controllable=false` ≠ 安全。
7. **管家是事件驱动的**：不要给管家设计"探索型"工作流。
8. **始终 `--output json`**：Agent 操作 CPG 必须使用 JSON 模式。
9. **写操作需要 `CPG_AGENT_ID`**：tag add/remove/bulk、note add、repair link、rules add_* 等写操作需要 agent 身份标识。
10. **Tag 与 Module 正交**：Module 是文件级组织，Tag 是 AST 节点级语义，绝不混用。

---

## 十二、现有 Skill 文件清单

```text
.claude/skills/
├── cdm/                     # CDM 远程客户端（工具参考，供其他 skill 引用）
│   ├── SKILL.md             #   命令语法、域说明、响应格式
│   └── scripts/             #   cdm_client.py + tools.json
├── map-surveyor.md          # 角色一：代码地图勘察员
├── vuln-hunter.md           # 角色二：漏洞狩猎专家
├── policy-manager.md        # 角色三：安全策略与资产管家
└── project_background.md    # 本文件
```
