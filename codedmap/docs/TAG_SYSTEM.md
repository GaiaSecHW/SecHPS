# Tag 系统架构文档

> 权威参考：标签本体定义以 `codedmap/rules/common/ontology.yaml` 为准。

## 一、三层架构总览

定义在 `codedmap/core/schema/tags/layer.py`：

| 层级 | 前缀 | 可写性 | 来源 | 用途 |
|------|------|--------|------|------|
| **L1 ONTOLOGY** | `ONTOLOGY:` | 系统只读（GUARD/SANITIZER/ROLE 协作可写） | 规则引擎、分析 Pass | 本体知识，100% 确定性 |
| **L2 SEMANTIC** | `SEMANTIC:` | Agent/AI/Pass 可写 | AITagger、Agent 手动 | 语义推断，概率性，带置信度 |
| **L3 STATE** | `STATE:` | Agent/Human 可写 | CLI、人工审计 | 审计工作流状态 |

---

## 二、架构规范：Tag 与 Module 的正交协作

Tag（标签）与 Module（逻辑视图）是正交协作的关系，Agent 必须严格遵守以下界限：

**正交定律：** Modules（`cdm module`）定义 MACRO 业务边界（Directory/File 粒度）。
Tags（`cdm tag`）定义 MICRO 架构角色与语义（Method/AST 粒度，永远不标注 ModuleNode）。

| 对比维度 | Module 逻辑视图 (`cdm module`) | Tag 标签系统 (`cdm tag`) |
|:---------|:-------------------------------|:------------------------|
| **设计目的** | 划分宏观**业务领域**与子系统边界 | 标记微观**节点语义**与操作行为 |
| **典型目标节点** | `Directory`, `File` | `Method`, `Call`, `Identifier` |
| **元数据定义** | 实体具备 `description`（它的职责是什么） | 关系具备 `justification`（为什么打这个标） |
| **协作示例** | `cdm module assign --module NETWORK_CORE --path src/net/` | `cdm tag add ONTOLOGY:ROLE:BOUNDARY -f parse_packet` |
| **错误用法** | 把具体的漏洞函数建成一个 Module | 给一整个目录的所有文件打上 `AUTH` 标签 |

**Agent 审计流转示例：**

1. 勘测员 Agent 发现 `src/crypto/` 目录，执行 `cdm module assign` 将其划入 `CRYPTO` 模块。
2. 审查员 Agent 聚焦于 `CRYPTO` 模块内部，发现 `des_decrypt()` 函数，执行 `cdm tag add` 为其打上 `SEMANTIC:CRYPTO:WEAK_ALGORITHM` 标签。
3. 追踪员 Agent 发现外部污点流入了该函数，执行 `cdm tag add` 打上 `STATE:CONFIRMED_VULN`。

---

## 三、L1 ONTOLOGY 标签

L1 是冻结的本体目录，由 `RuleRegistry` 从 `rules/common/ontology.yaml` 懒加载。
`TagRegistry.is_writable()` 对所有 `ONTOLOGY:` 前缀返回 `False`。

### 设计哲学

L1 标签按**客观操作类型**命名（如 `MEMORY_WRITE`、`OS_COMMAND`），而非按漏洞类型命名（旧方案的 `BUFFER_OVERFLOW`、`COMMAND_INJECTION`）。这使得同一个标签可以覆盖多种漏洞场景。

### 权限分类

L1 的 6 个命名空间分为两类：

| 类型 | 命名空间 | Agent `add()` | Agent `add()` + justification | `add_system_tag()` |
|------|----------|---------------|-------------------------------|---------------------|
| **系统只读** | ENTRY_POINT, SOURCE, SINK | TagPermissionError | TagPermissionError | 可以 |
| **协作可写** | GUARD, SANITIZER, ROLE | TagPermissionError | 可以 | 可以 |

协作可写由 `engine.py` 中的常量控制：
```python
_COLLABORATIVE_L1_PREFIXES = ("ONTOLOGY:GUARD:", "ONTOLOGY:SANITIZER:", "ONTOLOGY:ROLE:")
```

Agent 写协作型 L1 标签时，记录 `Provenance(source="AGENT", justification=...)` 到 `node.tags_provenance`。

### 完整 L1 标签目录（6 命名空间，39 标签）

#### ENTRY_POINT — 结构入口层（系统只读）

| 标签 | 说明 |
|------|------|
| `ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER` | 归并 HTTP/RPC/WebSocket |
| `ONTOLOGY:ENTRY_POINT:IPC_HANDLER` | 进程间通信入口 |
| `ONTOLOGY:ENTRY_POINT:CLI_COMMAND` | 命令行入口 |
| `ONTOLOGY:ENTRY_POINT:PLUGIN_HOOK` | 动态加载/回调/FFI |
| `ONTOLOGY:ENTRY_POINT:SYSCALL_HANDLER` | 系统调用入口 |
| `ONTOLOGY:ENTRY_POINT:IOCTL_HANDLER` | 设备控制入口 |
| `ONTOLOGY:ENTRY_POINT:HARDWARE_IRQ` | 硬件中断/MMIO |

#### SOURCE — 数据来源层（系统只读）

| 标签 | 说明 |
|------|------|
| `ONTOLOGY:SOURCE:NETWORK_DATA` | 网络数据 |
| `ONTOLOGY:SOURCE:FILE_DATA` | 文件数据 |
| `ONTOLOGY:SOURCE:ENV_DATA` | 环境变量/CLI 参数 |
| `ONTOLOGY:SOURCE:IPC_DATA` | 共享内存/管道 |
| `ONTOLOGY:SOURCE:USER_SPACE_DATA` | 用户态数据（copy_from_user） |
| `ONTOLOGY:SOURCE:HARDWARE_STATE` | 寄存器/MMIO |
| `ONTOLOGY:SOURCE:DESERIALIZED_OBJECT` | 反序列化对象 |

#### SINK — 危险操作层（系统只读）

| 标签 | 覆盖场景 |
|------|----------|
| `ONTOLOGY:SINK:MEMORY_WRITE` | 缓冲区溢出、越界写、任意地址写 |
| `ONTOLOGY:SINK:INFO_LEAK` | 越界读、未初始化内存泄露 |
| `ONTOLOGY:SINK:MEMORY_ALLOC` | 整数溢出导致错误分配 |
| `ONTOLOGY:SINK:MEMORY_FREE` | Double Free、UAF |
| `ONTOLOGY:SINK:PRIVILEGE_MUTATION` | 提权、凭证篡改 |
| `ONTOLOGY:SINK:OS_COMMAND` | 命令执行 |
| `ONTOLOGY:SINK:CODE_EVAL` | 代码注入、危险反序列化执行 |
| `ONTOLOGY:SINK:FILE_ACCESS` | 目录遍历、任意文件读写 |
| `ONTOLOGY:SINK:DB_EXECUTE` | SQL/NoSQL 注入 |
| `ONTOLOGY:SINK:VIEW_RENDER` | XSS、模板注入 |

#### SANITIZER — 数据净化层（协作可写，需 justification）

| 标签 | 说明 |
|------|------|
| `ONTOLOGY:SANITIZER:ESCAPE` | 转义 |
| `ONTOLOGY:SANITIZER:ENCODE` | 编码 |
| `ONTOLOGY:SANITIZER:TYPE_CAST` | 强转（可能引入截断/符号扩展） |
| `ONTOLOGY:SANITIZER:TRUNCATE` | 长度截断 |
| `ONTOLOGY:SANITIZER:NORMALIZE` | 路径/编码标准化 |

#### GUARD — 控制流守卫层（协作可写，需 justification）

| 标签 | 说明 |
|------|------|
| `ONTOLOGY:GUARD:BOUNDS_CHECK` | 边界/长度校验 |
| `ONTOLOGY:GUARD:NULL_CHECK` | 指针有效性校验 |
| `ONTOLOGY:GUARD:TYPE_CHECK` | 魔数/结构体类型校验 |
| `ONTOLOGY:GUARD:AUTH_CHECK` | 鉴权/Capability 检查 |
| `ONTOLOGY:GUARD:STATE_CHECK` | 生命周期/锁状态/并发安全 |

#### ROLE — 架构角色层（协作可写，需 justification）
> **⚠️ 架构警告：ROLE 标签 vs 逻辑模块 (Module)**
> ROLE 标签描述的是**微观函数/方法（Method）**在执行时的具体角色，而不是宏观的业务归属！
> - 如果你想表达 `src/auth/` 目录属于认证子系统，请使用 `cdm module assign`。
> - 如果你想表达 `handle_login()` 是该子系统对外暴露的边界函数，请给该函数打上 `ONTOLOGY:ROLE:BOUNDARY` 标签。

| 标签 | 说明 |
|------|------|
| `ONTOLOGY:ROLE:BOUNDARY` | 模块/子系统最外层的入口/出口函数 |
| `ONTOLOGY:ROLE:LOGIC_PROVIDER` | 核心逻辑/协议解析的执行函数 |
| `ONTOLOGY:ROLE:DATA_STORAGE` | 直接执行数据库/文件写操作的底层封装函数 |
| `ONTOLOGY:ROLE:INFRASTRUCTURE` | 路由分发/缓存读写/日志记录等支撑函数 |
| `ONTOLOGY:ROLE:DRIVER` | 硬件抽象/外设驱动交互函数 |
| `ONTOLOGY:ROLE:KERNEL_CORE` | 调度/内存/中断管理的底层函数 |
| `ONTOLOGY:ROLE:UTILITY` | 无状态的、被广泛调用的纯工具函数（如字符串处理） |

> 注：ROLE 标签不被 `SecurityTagMatcher.is_security_tag()` 识别——它们是微观架构性的，主要配合 Module 视图用于绘制系统的 API 边界和依赖拓扑。

---

## 四、L2 SEMANTIC 标签

L2 没有预定义的固定目录，格式为 `SEMANTIC:{NAMESPACE}:{NAME}`，完全开放。
所有 L2 标签记录 `Provenance(applied_by, timestamp, confidence, justification)`。

### AI Tagger 产出

`AITagger`（`app/tagging/ai_tagger.py`）通过 LLM 分析代码语义，产出格式：

```python
tag_name = f"SEMANTIC:{tag_decision.role}:{category_slug}"
```

过滤条件：`confidence >= 0.8`，`role != "NONE"`。

典型产出示例：
```
SEMANTIC:SINK:SQL_INJECTION       # AI 识别的 SQL 注入点
SEMANTIC:SOURCE:HTTP_INPUT        # AI 识别的 HTTP 输入源
SEMANTIC:SANITIZER:HTML_ESCAPE    # AI 识别的净化函数
SEMANTIC:ENTRY_POINT:HTTP         # AI 识别的 HTTP 入口
```

### Agent 手动标签

Agent 可通过 CLI 或 API 自由创建任意 L2 标签，用于标记其在审计过程中发现的特定语义属性或疑似弱点：

```bash
cdm tag add SEMANTIC:CRYPTO:WEAK_ALGORITHM --function init_des_cipher \
    --confidence 0.95 --justification "使用废弃的 DES 算法初始化上下文"
```

**✅ 推荐的 Agent L2 标签模式（微观语义/弱点推断）：**
```text
SEMANTIC:CREDENTIAL:HARDCODED_CANDIDATE   # 疑似硬编码的密码/密钥变量或函数
SEMANTIC:CRYPTO:WEAK_ALGORITHM            # 使用了不安全的加密算法
SEMANTIC:STATE:UNTRUSTED_INPUT            # 确认该函数的参数直接受到攻击者控制
SEMANTIC:SINK:{CATEGORY}                  # AI 推断出未被 L1 规则覆盖的非标危险操作
SEMANTIC:SOURCE:{CATEGORY}                # AI 推断出未被 L1 规则覆盖的非标数据源
```

**❌ 反模式（Anti-Pattern）：**
请**不要**使用 L2 标签来进行子系统或业务模块的划分（例如使用 `SEMANTIC:AUTH:CORE` 标记所有认证代码）。这种宏观组织工作应严格交由 **Module API** (`cdm module assign`) 来完成。

### SecurityTagMatcher 统一识别

`SecurityTagMatcher` 同时识别 L1 和 L2 的安全标签：

```python
SecurityTagMatcher.is_sink("ONTOLOGY:SINK:DB_EXECUTE")    # True
SecurityTagMatcher.is_sink("SEMANTIC:SINK:SQL_INJECTION")  # True
SecurityTagMatcher.is_security_tag("SEMANTIC:AUTH:HIGH")   # True (非标准命名空间也识别)

namespace, category, layer = SecurityTagMatcher.parse_any_security_tag("SEMANTIC:SINK:SQL_INJECTION")
# namespace="SINK", category="SQL_INJECTION", layer=TagLayer.SEMANTIC
```

---

## 五、L3 STATE 标签

预定义审计工作流状态（`core/schema/tags/ontology.py`）：

| 标签 | 含义 |
|------|------|
| `STATE:REVIEWED` | 已人工审查 |
| `STATE:SUSPICIOUS` | 标记为可疑 |
| `STATE:FALSE_POSITIVE` | 确认非漏洞 |
| `STATE:CONFIRMED_VULN` | 确认漏洞 |

自定义扩展：`STATE:CUSTOM:{NAME}`（自由格式）。

CLI 中 `STATE:` 和 `ONTOLOGY:ROLE:` 前缀属于"主观标签"，需要 `--justification` 参数。

---

## 六、规则 YAML 与 L1 标签映射

规则文件位于 `codedmap/rules/`，YAML 中的 `category` 字段直接映射到 ontology.yaml 中的 L1 标签名。
L1 标签由 EntryPointPass、SourcePass、SinkPass 等分析 Pass 根据规则自动应用。

### C/C++ 规则 (`rules/c/core.yaml`)

| 规则类型 | 函数/模式 | → L1 标签 |
|----------|----------|-----------|
| entry_points | `main` | `ONTOLOGY:ENTRY_POINT:CLI_COMMAND` |
| entry_points | `SYSCALL_DEFINE`, `sys_*` | `ONTOLOGY:ENTRY_POINT:SYSCALL_HANDLER` |
| entry_points | `unlocked_ioctl`, `compat_ioctl`, `mmap` | `ONTOLOGY:ENTRY_POINT:IOCTL_HANDLER` |
| sources | `getenv`, `secure_getenv` | `ONTOLOGY:SOURCE:ENV_DATA` |
| sources | `fread`, `read`, `pread` | `ONTOLOGY:SOURCE:FILE_DATA` |
| sources | `recv`, `recvfrom`, `recvmsg` | `ONTOLOGY:SOURCE:NETWORK_DATA` |
| sources | `copy_from_user`, `get_user`, `memdup_user` | `ONTOLOGY:SOURCE:USER_SPACE_DATA` |
| sinks | `memcpy`, `strcpy`, `sprintf`, `memmove`, `strcat` | `ONTOLOGY:SINK:MEMORY_WRITE` |
| sinks | `copy_to_user`, `put_user`, `seq_printf` | `ONTOLOGY:SINK:INFO_LEAK` |
| sinks | `malloc`, `calloc`, `kmalloc`, `kzalloc`, `vmalloc` | `ONTOLOGY:SINK:MEMORY_ALLOC` |
| sinks | `free`, `kfree`, `vfree`, `kfree_rcu` | `ONTOLOGY:SINK:MEMORY_FREE` |
| sinks | `system`, `execve`, `popen` | `ONTOLOGY:SINK:OS_COMMAND` |
| sinks | `fopen`, `open`, `unlink` | `ONTOLOGY:SINK:FILE_ACCESS` |
| sinks | `commit_creds`, `setuid`, `cap_set_proc` | `ONTOLOGY:SINK:PRIVILEGE_MUTATION` |
| guards | `check_bounds` | `ONTOLOGY:GUARD:BOUNDS_CHECK` |
| guards | `!= NULL` 模式 | `ONTOLOGY:GUARD:NULL_CHECK` |
| sanitizers | `snprintf` | `ONTOLOGY:SANITIZER:TRUNCATE` |

### Python 规则 (`rules/python/core.yaml`)

| 规则类型 | 函数/模式 | → L1 标签 |
|----------|----------|-----------|
| entry_points | `main`, `__name__ == "__main__"` | `ONTOLOGY:ENTRY_POINT:CLI_COMMAND` |
| entry_points | `argparse.ArgumentParser` | `ONTOLOGY:ENTRY_POINT:CLI_COMMAND` |
| entry_points | `SimpleXMLRPCServer` | `ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER` |
| sources | `os.getenv`, `sys.argv`, `input` | `ONTOLOGY:SOURCE:ENV_DATA` |
| sources | `open`, `json.load`, `json.loads` | `ONTOLOGY:SOURCE:FILE_DATA` |
| sources | `urllib.request.urlopen`, `socket.recv` | `ONTOLOGY:SOURCE:NETWORK_DATA` |
| sinks | `subprocess.run`, `os.system`, `os.execve` | `ONTOLOGY:SINK:OS_COMMAND` |
| sinks | `eval`, `exec`, `compile`, `pickle.load` | `ONTOLOGY:SINK:CODE_EVAL` |
| sinks | `cursor.execute`, `sqlite3.connect.execute` | `ONTOLOGY:SINK:DB_EXECUTE` |
| sinks | `open`, `os.remove` | `ONTOLOGY:SINK:FILE_ACCESS` |
| guards | `isinstance` | `ONTOLOGY:GUARD:TYPE_CHECK` |
| sanitizers | `html.escape`, `shlex.quote` | `ONTOLOGY:SANITIZER:ESCAPE` |

---

## 七、权限模型与 API

### TagEngine — 统一写入入口

```python
engine = TagEngine(store)

# L2/L3 标签 — Agent/AI 可写 (强制记录 provenance)
engine.add(node, "SEMANTIC:SINK:SQL_INJECTION", applied_by="ai", confidence=0.85, justification="发现未经参数化拼接的 SQL 字符串")
engine.add(node, "STATE:REVIEWED", applied_by="human", justification="已由高级安全工程师复核完毕")

# 协作型 L1 标签 — Agent 写入必须提供 justification
engine.add(node, "ONTOLOGY:GUARD:BOUNDS_CHECK", applied_by="agent",
           justification="if (len > MAX_BUF) return -EINVAL at line 42", confidence=1.0)

# 系统只读 L1 标签 — 仅底层分析 Pass 可用 (自动应用)
engine.add_system_tag(node, "ONTOLOGY:ENTRY_POINT:CLI_COMMAND")
```

### 统一 Provenance 模型

所有标签写入（L2/L3 及协作型 L1）均通过 `Provenance` 模型记录溯源信息：

```python
class Provenance(BaseModel):
    """Universal provenance record for tag application and edge justification."""
    model_config = ConfigDict(frozen=True)
    applied_by: AppliedBy    # system/rule/ai/agent/human
    timestamp: datetime
    confidence: Optional[float]   # 0.0-1.0
    justification: Optional[str]  # max_length=255
    source: Optional[str]         # "SYSTEM" | "AGENT" | "HUMAN"
    author_id: Optional[str]      # e.g. "claude-3-flash"
```

定义于 `core/schema/tags/provenance.py`。`get_provenance_records(provenance_dict, tag)` 规范化函数处理新旧两种存储格式（单条 dict 或 list[dict]）。

### CLI 命令契约

```bash
# 添加 L2 标签 (语义推断)
cdm tag add SEMANTIC:CREDENTIAL:HARDCODED --function handle_login --confidence 0.9 --justification "发现明文 'admin123' 赋值"

# 添加 L3 标签 (审计状态)
cdm tag add STATE:SUSPICIOUS --function process_input --justification "循环内缺乏对索引上限的校验，极易触发越界写"

# 添加协作型 L1 标签 (必须提供 justification)
cdm tag add ONTOLOGY:ROLE:BOUNDARY --function api_handler --justification "该函数是 HTTP 路由表的直接回调入口"

# 查找（支持通配符与置信度展示）
cdm tag find "ONTOLOGY:SINK:*"
cdm tag find "SEMANTIC:*" --verbose

# 批量打标 (注：如果是为了划分业务模块，请使用 cdm module assign！此处仅用于批量应用语义标签)
cdm tag bulk "alloc" SEMANTIC:MEMORY:CUSTOM_ALLOCATOR --type method --justification "属于内部自研内存池接口"
```

---

## 八、数据流架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    L1 打标路径（系统自动）                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  规则 YAML (rules/c/core.yaml, rules/python/core.yaml)          │
│      │                                                          │
│      ├── EntryPointPass  → ONTOLOGY:ENTRY_POINT:*               │
│      ├── SourcePass      → ONTOLOGY:SOURCE:*                    │
│      └── SinkPass        → ONTOLOGY:SINK:*                      │
│      │                                                          │
│      └── TagEngine.add_system_tag()  (绕过权限检查)              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                    L2 打标路径（AI/Agent）                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  AITagger.tag_method()                                          │
│      │  LLM 分析 → role + category + confidence                 │
│      │  过滤: confidence >= 0.8, role != "NONE"                  │
│      ▼                                                          │
│  SEMANTIC:{ROLE}:{CATEGORY}                                     │
│      │                                                          │
│      └── TagEngine.add(applied_by="ai", confidence=N)           │
│          └── Provenance: {applied_by, confidence, timestamp}    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                    L3 打标路径（人工/Agent）                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CLI: cdm tag add STATE:REVIEWED --function foo                  │
│      │                                                          │
│      └── TagEngine.add(applied_by="human")                      │
│          └── Provenance: {applied_by, timestamp}                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SecurityTagMatcher（统一查询）                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  is_sink("ONTOLOGY:SINK:*")     → True                          │
│  is_sink("SEMANTIC:SINK:*")     → True                          │
│  is_security_tag(...)           → True (L1 + L2, 排除 ROLE)     │
│  parse_any_security_tag(...)    → (namespace, category, layer)  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 九、关键设计原则

1. **TagEngine 是唯一写入入口** — 所有标签修改必须通过 `TagEngine`，强制权限检查和 provenance 记录
2. **L1 系统只读 + 协作可写** — ENTRY_POINT/SOURCE/SINK 纯系统只读；GUARD/SANITIZER/ROLE 允许 Agent 带 justification 写入
3. **L2 带置信度** — SEMANTIC 层标签记录 `applied_by`、`confidence`、`timestamp`、`justification`
4. **标签总是大写** — TagNavigator 和 TagEngine 自动规范化
5. **SecurityTagMatcher 统一匹配** — 同时识别 L1 和 L2，下游无需区分来源
6. **规则驱动** — L1 标签由 YAML 规则定义，通过 RuleRegistry 加载，Pass 自动应用

---

## 十、CATEGORIES.md 过时说明

`codedmap/app/tagging/CATEGORIES.md` 中的标签名反映的是重构前的"按漏洞类型命名"方案，与当前 `ontology.yaml` 不一致：

| CATEGORIES.md 旧名 | 当前 ontology.yaml |
|--------------------|-------------------|
| `SOURCE:USER_INPUT` | 不存在（已归并） |
| `SOURCE:NETWORK_IO` | `SOURCE:NETWORK_DATA` |
| `SOURCE:FILE_READ` | `SOURCE:FILE_DATA` |
| `SOURCE:ENV_VAR` | `SOURCE:ENV_DATA` |
| `SOURCE:HTTP_INPUT` | 不存在（归并到 NETWORK_DATA） |
| `SINK:COMMAND_INJECTION` | `SINK:OS_COMMAND` |
| `SINK:BUFFER_OVERFLOW` | `SINK:MEMORY_WRITE` |
| `SINK:SQL_INJECTION` | `SINK:DB_EXECUTE` |
| `ROLE:CONTROLLER` | `ROLE:BOUNDARY` |
| `ROLE:SERVICE` | `ROLE:LOGIC_PROVIDER` |
| 缺少 GUARD 命名空间 | 当前有 5 个 GUARD 标签 |

**以 `rules/common/ontology.yaml` 为唯一权威来源。**

---

## 十一、相关文件

| 文件 | 用途 |
|------|------|
| `rules/common/ontology.yaml` | **权威** L1 本体定义（6 命名空间，39 标签） |
| `rules/c/core.yaml` | C/C++ 语言规则（函数 → L1 标签映射） |
| `rules/python/core.yaml` | Python 语言规则（函数 → L1 标签映射） |
| `rules/common/safe_functions.yaml` | 安全函数白名单 |
| `core/schema/tags/layer.py` | TagLayer 枚举定义 |
| `core/schema/tags/ontology.py` | L1 本体加载器 + L3 STATE 词汇表 |
| `core/schema/tags/registry.py` | TagRegistry 注册表（权限判断） |
| `core/schema/tags/matcher.py` | SecurityTagMatcher（L1+L2 统一匹配） |
| `core/schema/tags/provenance.py` | Provenance (unified Pydantic model) + AppliedBy enum + get_provenance_records() normalizer |
| `core/schema/tags/definition.py` | TagDefinition 模型 |
| `analysis/tagging/engine.py` | TagEngine 统一写入入口 |
| `analysis/tagging/navigator.py` | TagNavigator 验证/CRUD |
| `app/tagging/ai_tagger.py` | AITagger（LLM 打标） |
| `cli/commands/tag.py` | CLI tag 子命令 |

---

*最后更新：2026-03-20*
