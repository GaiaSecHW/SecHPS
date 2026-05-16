# cpg_schema/frontend/parsers/ir — IR-Based Parser Layer

基于中间表示 (Intermediate Representation) 的解析器层。放弃直接解析源码 (tree-sitter 面对 C/C++ 宏地狱无法处理)，转为读取构建工具产出的 IR 产物 (JSON AST dump)，实现 Zero-Inference 解析。

## Module Map

```
ir/
  base.py                 # IRParser — IR 解析器基类 (Layer 1)
  clang_json_parser.py    # ClangJSONParser — Clang AST JSON 解析器 (Layer 2, Production Ready)
  (无 __init__.py)         # 隐式命名空间包

依赖的上层基类:
  ../base.py              # AbstractParser — 所有解析器的顶层抽象 (Layer 0)
```

## 继承链

```
AbstractParser (base.py)         Layer 0 — Template Method + 自动统计
  |
  +-- IRParser (ir/base.py)      Layer 1 — Artifact 加载 (JSON via SourceManager)
        |
        +-- ClangJSONParser      Layer 2 — Clang AST 分发 + 图构建
```

## 核心设计哲学

### Zero-Inference (零推断)

Parser **不做任何语义推断**，完全信任上游 Exporter (ast_exporter.py) 提供的元数据：
- `order` / `argument_index` — 直接使用，不自行计算
- `type.canonical` — 信任规范化类型名
- `signature` — 信任函数签名
- `dispatch_type` — 信任调用分派类型
- `location` (line/col/offset) — 信任位置信息

这意味着 **Parser 的正确性依赖于 Exporter 的正确性**。如果 Exporter 数据有误，Parser 不会纠错。

### Joern 规范偏移

Exporter 使用 0-based index，但 Joern/CPG 规范要求 1-based：
```python
kwargs["order"] = node_dict["order"] + 1           # 0-based → 1-based
kwargs["argument_index"] = node_dict["argument_index"] + 1  # 同上
```

## Layer 0: AbstractParser (../base.py)

Template Method 模式，定义 `parse_file()` 流程：

```
parse_file(file_path, strategy)
  ├── normalize_path()          → self.current_filename
  ├── record start state        → _max_id, edge count, file size
  ├── _parse_implementation()   → [Hook] 子类实现
  ├── run(filename, result)     → [Hook] 子类实现
  └── finally: log statistics   → 耗时 / +N Nodes / +E Edges / Methods / Types
```

### 关键属性

| 属性 | 类型 | 用途 |
|---|---|---|
| `builder` | CPGBuilder | 图构建器实例 |
| `project_root` | str | 项目根目录 |
| `current_filename` | str | 当前解析文件名 (normalize 后) |
| `strategy` | ParseStrategy | 解析策略 (FULL / LIGHTWEIGHT 等) |

### 自动统计

`parse_file()` 在 `finally` 块中自动计算:
- 新增节点数 (通过 `_max_id` 差值快速计算，避免全量集合运算)
- 新增边数
- MethodNode / TypeDeclNode 细分计数
- 耗时 (>1s 或 FAIL 时 info 级别，否则 debug)

## Layer 1: IRParser (ir/base.py)

### 职责

唯一职责：将 `_parse_implementation()` 实现为 **JSON Artifact 加载**。

```python
def _parse_implementation(self, file_path: str) -> Any:
    data = source_manager.load_artifact(file_path)  # LRU 缓存, 避免重复 IO + JSON decode
    return data  # Dict[str, Any] (JSON root object)
```

### SourceManager 集成

- `source_manager` 是全局单例 (SourceCodeManager)
- `load_artifact(path)` 提供对象级 LRU 缓存
- 支持 `.json` 和 `.json.gz` 格式
- 切换 `project_root` 时自动清空路径缓存

### 约定

- `file_path` 参数应指向 IR 产物 (JSON 文件)，不是源码文件
- 上层调度器 (Worker) 负责定位 JSON 文件路径
- `run(filename, root_node)` 由子类实现，接收 JSON 反序列化后的 Dict

## Layer 2: ClangJSONParser (ir/clang_json_parser.py)

**Production Ready。** 这是目前唯一的 IR Parser 实现。

### 三层架构

```
┌─────────────────────────────────────────────┐
│ Dispatch System (分发系统)                    │
│   _dispatch_table: Dict[str, Callable]       │
│   118 个 Clang Kind → Handler 映射           │
│   未注册 Kind → handle_wrapper_pass_through  │
├─────────────────────────────────────────────┤
│ Traversal Engine (遍历引擎)                   │
│   visit() → _extract_metadata() → handler() │
│   _visit_children() → 递归遍历               │
├─────────────────────────────────────────────┤
│ Metadata Extraction (元数据提取)              │
│   _extract_metadata() — JSON → CPG kwargs    │
│   6 个提取维度 (见下方)                       │
└─────────────────────────────────────────────┘
```

### 分发表 (Dispatch Table)

**`__init__` 中初始化**，覆盖 118 种 Clang AST Kind：

| 分类 | Kind 示例 | Handler | 数量 |
|---|---|---|---|
| Root/Container | TRANSLATION_UNIT, NAMESPACE, LINKAGE_SPEC | handle_translation_unit, handle_namespace | 3 |
| Declarations | FUNCTION_DECL, CXX_METHOD, CONSTRUCTOR, DESTRUCTOR | handle_function_decl | 4 |
| Type Decls | STRUCT_DECL, CLASS_DECL, UNION_DECL, ENUM_DECL | handle_type_decl, handle_enum_decl | 6 |
| Parameters | PARM_DECL | handle_parameter | 1 |
| Variables | VAR_DECL, FIELD_DECL | handle_variable_decl, handle_field_decl | 2 |
| Statements | COMPOUND_STMT, RETURN_STMT, IF/FOR/WHILE/DO/SWITCH | handle_block, handle_return, handle_if... | ~15 |
| Calls | CALL_EXPR, CXX_MEMBER_CALL_EXPR, CXX_OPERATOR_CALL_EXPR | handle_call | 3 |
| Operators | BINARY/UNARY/COMPOUND_ASSIGNMENT/CONDITIONAL | handle_binary/unary_operator, handle_conditional | 4 |
| Cast/Wrapper | C_STYLE_CAST, CXX_*_CAST, IMPLICIT_CAST, PAREN, UNEXPOSED_* | handle_wrapper_pass_through | ~12 |
| Init List | INIT_LIST_EXPR, COMPOUND_LITERAL, DESIGNATED_INIT | handle_init_list, pass-through | 3 |
| References | DECL_REF_EXPR, MEMBER_REF_EXPR, ARRAY_SUBSCRIPT | handle_decl_ref, handle_member_expr, handle_array_access | 3 |
| Literals | INTEGER/FLOATING/STRING/CHARACTER/BOOL/NULL_PTR | handle_literal | 6 |
| Special | UNARY_EXPR_OR_TYPE_TRAIT (sizeof), ASM_STMT, GCC_ASM, LAMBDA | handle_sizeof, handle_asm, pass-through | ~5 |

### 遍历引擎

#### `run(filename, root_node)`

入口点。从 JSON root 提取文件路径 (`location.file` > `spelling` > filename)，在 `builder.file()` 上下文中调用 `visit(root_node)`。

#### `visit(node_dict, attach_to_parent=True)`

核心递归函数，每个 JSON 节点经过此函数：

```
visit(node_dict)
  1. 提取 kind
  2. _extract_metadata(node_dict) → kwargs (Order, Location, Type, Code, Semantic)
  3. kwargs["auto_ast"] = attach_to_parent
  4. 查 _dispatch_table[kind]
  5. 找不到 → handle_wrapper_pass_through (兜底透传)
  6. 执行 handler(node_dict, **kwargs)
  7. 异常 → logger.error + return None (不中断解析)
```

#### `_visit_children(node_dict)`

简单递归：遍历 `node_dict["children"]`，对每个 child 调用 `visit(child, attach_to_parent=True)`。结果扁平化 (handler 可能返回 list)。

### 元数据提取 (_extract_metadata)

**6 个提取维度**，将 Exporter JSON 映射为 CPG Node kwargs：

| 维度 | JSON 字段 | CPG kwargs | 备注 |
|---|---|---|---|
| 1. Order/Index | `order`, `argument_index` | `order`, `argument_index` | +1 偏移 (Joern 1-based) |
| 2. Location | `location.{line,col,line_end,col_end,offset_start,offset_end,file}` | `line_number`, `column_number`, `line_number_end`, `column_number_end`, `offset_start`, `offset_end`, `file_name` | |
| 3. Type System | `type.{canonical,fullname,size,align}` | `type_full_name`, `type_size`, `type_align` | canonical 优先; size/align 为内存布局扩展 |
| 4. Code/Value | `value`, `opcode` | `code` | value 优先于 opcode |
| 5. Semantic | `alias_name`, `mangled_name`, `signature`, `usr`, `ref_usr` | `alias_names`, `mangled_name`, `signature`, `usr`, `ref_usr` | USR 用于 Linker 跨 TU 关联 |
| 6. Field Offset | `offset_bytes` | `offset_bytes` | 结构体成员偏移 (AstNode extra='allow' 存储) |

### Handler 详解

#### handle_function_decl — 函数/方法声明

处理：FUNCTION_DECL, CXX_METHOD, CONSTRUCTOR, DESTRUCTOR

```
1. 提取 name, return_type, signature
2. 清理 kwargs (移除 name/order/argument_index，MethodNode 不需要)
3. builder.method() 上下文管理
4. Modifiers: STATIC, VIRTUAL, PURE_VIRTUAL, EXPLICIT, INLINE, PUBLIC/PRIVATE/PROTECTED
5. Semantic Tags: semantic_parent_usr
6. 递归 _visit_children()
```

#### handle_variable_decl — 变量声明

根据作用域判断 global vs local:

```
1. 检查 scope_stack[-1].label in [FILE, NAMESPACE_BLOCK, TYPE_DECL] → is_global
2. builder.global_variable() 或 builder.local_variable()
3. Storage class modifiers: STATIC, EXTERN
4. 初始化表达式: 生成 assignment (lhs = rhs)
5. [特殊] INIT_LIST_EXPR → _unfold_init_list() 展开结构体初始化
```

#### handle_call — 函数调用

处理：CALL_EXPR, CXX_MEMBER_CALL_EXPR, CXX_OPERATOR_CALL_EXPR

```
1. children[0] = Callee (必须 visit！否则图中缺少被调用者节点)
2. children[1:] = Arguments
3. 推断 name: CallExpr.spelling > callee_node.name > callee_node.code > "<indirect>"
4. 生成 code: "callee(arg1, arg2, ...)"
5. Dispatch type: MEMBER 类 callee → DYNAMIC_DISPATCH, 否则 STATIC_DISPATCH
6. MEMBER callee → receiver; 非 MEMBER callee → 手动 add_ast_edge 挂载
```

#### handle_wrapper_pass_through — 智能透传

处理所有 Cast、PAREN_EXPR、UNEXPOSED_EXPR 等 wrapper 节点：

```
Case A (Single Child):
  完美透传 — 继承 Wrapper 的 argument_index / order，递归 visit child
  效果：消除 Wrapper 层，子节点直接取代 Wrapper 在 AST 中的位置

Case B (Multi Children):
  构造 <operator>.comma Call — 保留所有子节点作为 ARGUMENT
  场景：Statement Expression ({ int x=1; x; })、复杂宏展开
```

**这是最关键的兜底逻辑**：未注册的 Kind 也会走到这里。

#### 结构体初始化展开 (_unfold_init_list)

将 `struct A a = {.x = 1, .y = func}` 展开为独立赋值语句：

```
a.x = 1      →  fieldAccess(a, "x") = 1
a.y = func   →  fieldAccess(a, "y") = func
```

每个 DESIGNATED_INIT_EXPR:
1. `_extract_designator_and_value()` → (field_name, value_node)
2. 构建 LHS: `builder.field_access(base_identifier, field_name)`
3. 构建 RHS: `visit(value_node)`
4. `builder.assignment(lhs, rhs)`

### Operator 映射表

二元操作符 (`handle_binary_operator`) 和一元操作符 (`handle_unary_operator`) 使用 opcode → Operators 常量映射：

**Binary (14 个)**:
`=` → assignment, `+/-/*/\/%` → arithmetic, `==/!=/</>/<=/>=` → comparison, `&&/||` → logical, `&/|/^/<</>>`  → bitwise, `,` → comma

**Unary (10 个)**:
`&` → addressOf, `*` → indirection, `!` → logicalNot, `~` → not_, `+/-` → plus/minus, `++/--` → preIncrement/preDecrement, `++(post)/--(post)` → postIncrement/postDecrement

## JSON IR 输入格式 (Exporter 约定)

ClangJSONParser 期望的 JSON 结构：

```json
{
  "kind": "TRANSLATION_UNIT",
  "spelling": "main.c",
  "location": {
    "file": "src/main.c",
    "line": 1, "col": 1,
    "line_end": 100, "col_end": 1,
    "offset_start": 0, "offset_end": 3200
  },
  "children": [
    {
      "kind": "FUNCTION_DECL",
      "spelling": "main",
      "order": 0,
      "signature": "int main(int, char **)",
      "mangled_name": "_main",
      "usr": "c:@F@main",
      "type": {
        "canonical": "int (int, char **)",
        "fullname": "int (int, char **)",
        "return_type": "int"
      },
      "location": { "file": "src/main.c", "line": 5, "col": 1 },
      "is_static": false,
      "access_specifier": "PUBLIC",
      "children": [...]
    }
  ]
}
```

### 关键 Exporter 字段

| 字段 | 用途 | 使用位置 |
|---|---|---|
| `kind` | 分发表查询键 | visit() |
| `spelling` | 名称 (函数名/变量名/标签名) | 所有 handler |
| `order` | AST 子节点排序 + ID 生成 | _extract_metadata() |
| `argument_index` | 参数位置 + ID 生成 | _extract_metadata() |
| `type.canonical` | 规范化类型全名 | _extract_metadata() |
| `type.return_type` | 函数返回类型 | handle_function_decl() |
| `type.size` / `type.align` | 内存布局 (扩展) | _extract_metadata() |
| `signature` | 函数签名 (用于 ID 生成) | handle_function_decl() |
| `usr` | Unified Symbol Resolution | _extract_metadata() → Linker |
| `ref_usr` | 引用目标的 USR | _extract_metadata() → Linker |
| `value` | 字面量值 | _extract_metadata() |
| `opcode` | 操作符符号 | _extract_metadata(), handle_binary/unary_operator() |
| `storage_class` | STATIC / EXTERN | handle_function_decl(), handle_variable_decl() |
| `access_specifier` | PUBLIC / PRIVATE / PROTECTED | handle_function_decl(), handle_field_decl() |
| `is_arrow` | `.` vs `->` | handle_member_expr() |
| `inherits_from` | 继承列表 | handle_type_decl() |
| `designator_field` | 指定初始化器的字段名 | _extract_designator_and_value() |
| `dispatch_type` | 调用分派类型 | handle_call() |
| `children` | 子节点列表 | 所有递归遍历 |

## 数据流: JSON → CPG Graph

```
ast_exporter.py (外部工具)
    │
    │  生成 .json 文件
    ▼
SourceManager.load_artifact(path)
    │
    │  JSON → Dict (LRU 缓存)
    ▼
IRParser._parse_implementation()
    │
    ▼
ClangJSONParser.run(filename, root_dict)
    │
    │  builder.file() 上下文
    ▼
visit(node_dict)
    ├── _extract_metadata() → kwargs
    ├── _dispatch_table[kind] → handler
    └── handler(node_dict, **kwargs)
            │
            ├── builder.method() / builder.call() / builder.literal() / ...
            │       │
            │       ▼
            │   CPGBuilder._add_node()
            │       │
            │       ├── auto_generate_id (Deterministic SHA-256)
            │       ├── collision detection & repair
            │       └── scope stack → auto AST edge
            │
            └── _visit_children() → 递归
```

## 设计模式

| 模式 | 使用位置 | 说明 |
|---|---|---|
| Template Method | AbstractParser.parse_file() | 固定流程: load → build → stats |
| Strategy | handler 函数 (dispatch table) | 同一接口 (handler) 根据 kind 分派不同实现 |
| Visitor | visit() + _visit_children() | 递归遍历 JSON AST 树 |
| Wrapper Passthrough | handle_wrapper_pass_through() | 消除语义无关的 AST wrapper 层 |
| Builder | 全程使用 self.builder.xxx() | 将 JSON → CPG Node 委托给 CPGBuilder |
| Singleton | source_manager | 全局唯一的资源管理器 |

## Known Issues & Tech Debt

1. **无 `__init__.py`** — ir/ 目录依赖隐式命名空间包，建议添加以明确导出
2. **只有 ClangJSONParser** — 如果要支持其他 IR 格式 (如 LLVM IR, GCC GIMPLE)，需要新增子类
3. **_unfold_init_list 嵌套不支持** — 目前只展开一层 DESIGNATED_INIT_EXPR，嵌套结构体初始化 (`{.inner = {.x = 1}}`) 不会递归展开
4. **Elvis 操作符 argument_index 硬编码** — `handle_conditional()` 中 Elvis (`?:`) 的 false branch 被硬编码为 index=3，假设 index 2 是缺失的 true branch
5. **handle_sizeof 类型判断脆弱** — 用 `"TYPE" in child_kind or "DECL" in child_kind` 区分类型/表达式，可能误判 (如 TYPE_ALIAS_DECL 的子节点)
6. **handle_call name fallback 链过长** — `spelling > callee.name > callee.code > "<indirect>"`，中间可能拿到意外值
7. **handle_parameter 默认值挂载** — 直接调用 `builder.graph.add_ast_edge()` 绕过了 Builder 的封装
8. **handle_variable_decl is_global 判断** — 依赖 `scope_stack[-1].label` 而非语义分析，可能在嵌套 scope 中误判
9. **代码生成 (code 字段) 质量低** — 多处使用 `"base.field"` / `"base[idx]"` 等占位符，不是真实源码。对后续依赖 code 字段的分析 (如 AI summary) 有影响
10. **异常静默吞没** — `visit()` 的 except 只 log 不 raise，坏数据会导致子树静默丢失

## 改造指南

### 新增语言 IR Parser

```python
# ir/gcc_gimple_parser.py
class GCCGimpleParser(IRParser):
    def __init__(self, builder, project_root=None):
        super().__init__(builder, project_root)
        self._dispatch_table = { ... }  # GCC GIMPLE kinds

    def run(self, filename, root_node):
        with self.builder.file(filename):
            self.visit(root_node)

    def visit(self, node_dict, attach_to_parent=True):
        # 复用 _extract_metadata 模式 或 自定义
        ...
```

### 扩展 ClangJSONParser

新增 Kind handler:
```python
# 在 __init__ 的 _dispatch_table 中添加:
"CXX_TRY_STMT": self.handle_try,

# 然后实现 handler:
def handle_try(self, node, **kwargs):
    ...
```

### 关键改造点

- 要改 Exporter 字段映射 → 修改 `_extract_metadata()`
- 要改节点创建逻辑 → 修改对应 `handle_xxx()`
- 要改遍历策略 → 修改 `visit()` / `_visit_children()`
- 要添加新的分析维度 → 在 `_extract_metadata()` 增加提取维度
- 要优化性能 → `source_manager` 的 LRU cache 和 `_dispatch_table` 已经是核心热路径

## Agent Rules

1. **修改 IR Parser 后必须同步检查 Exporter** — Parser 和 Exporter 是强耦合的 (Zero-Inference 原则)
2. **不要在 Parser 中推断语义** — 如果 Exporter 没提供某个字段，应该修 Exporter，而不是在 Parser 中猜测
3. **handler 返回值可以是 None、AnyNode 或 List[AnyNode]** — `_visit_children` 会扁平化 list
4. **kwargs 传递 builder 时注意清理** — 几乎每个 handler 都需要 `kwargs.pop("name", None)` 等操作防止参数冲突
5. **attach_to_parent=False 的节点需要手动连边** — 否则会成为图中的游离节点
