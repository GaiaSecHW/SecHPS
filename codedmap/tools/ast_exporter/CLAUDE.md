# tools/ast_exporter — Clang AST JSON Exporter

基于 libclang 的 C/C++ AST 并行导出工具。读取 `compile_commands.json`，将每个编译单元 (Translation Unit) 的 AST 序列化为 Gzip 压缩的 JSON 文件。这些 JSON 产物是 `cpg_schema/frontend/parsers/ir/clang_json_parser.py` 的唯一输入源。

## Module Map

```
tools/ast_exporter/
  ast_exporter.py     # 唯一源文件 (823 行)
  spec.md             # SDD 规格文档 (历史版本，部分内容已过时)
  readme              # 概述文档 (历史版本)
```

## 与 ClangJSONParser 的契约关系

```
ast_exporter.py (Build Machine)          ClangJSONParser (Analysis Machine)
────────────────────────────────          ───────────────────────────────────
libclang Cursor → JSON                   JSON → CPG Node (via CPGBuilder)

  输出字段:                                消费方式:
  kind         ─────────────────────────→  _dispatch_table[kind] → handler
  spelling     ─────────────────────────→  handler 的 name 参数
  order        ───── (+1 偏移) ─────────→  kwargs["order"] (ID 生成 Salt)
  argument_index ── (+1 偏移) ─────────→  kwargs["argument_index"] (ID Salt)
  type.canonical ───────────────────────→  kwargs["type_full_name"]
  type.size/align ──────────────────────→  kwargs["type_size"/"type_align"]
  signature    ─────────────────────────→  handle_function_decl → builder.method()
  usr          ─────────────────────────→  kwargs["usr"] → Linker
  ref_usr      ─────────────────────────→  kwargs["ref_usr"] → Linker
  value        ─────────────────────────→  kwargs["code"] (Literals)
  opcode       ─────────────────────────→  kwargs["code"] + operator 映射表
  dispatch_type ────────────────────────→  handle_call → DispatchType
  alias_name   ─────────────────────────→  kwargs["alias_names"]
  inherits_from ────────────────────────→  handle_type_decl → builder.type_decl()
  offset_bytes ─────────────────────────→  kwargs["offset_bytes"]
  designator_field ─────────────────────→  _extract_designator_and_value()
  children     ─────────────────────────→  _visit_children() 递归
  location.*   ─────────────────────────→  line_number, column_number, offset_*, file_name
```

**核心约定**: ClangJSONParser 遵循 Zero-Inference 原则，完全信任 Exporter 输出。如果 Exporter 数据有误，Parser 不会纠错。因此 **修改 Exporter 输出格式时必须同步更新 Parser**。

## 系统架构

```
                     ┌─────────────────────┐
                     │  compile_commands.json│
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │   main() Orchestrator│
                     │  - 读取 commands     │
                     │  - 排除过滤          │
                     │  - 分片任务          │
                     └──────────┬──────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                   │
     ┌────────▼────────┐ ┌─────▼──────┐  ┌────────▼────────┐
     │ Worker Process 1│ │ Worker  2  │  │ Worker  N       │
     │ (独立 clang.Index│ │            │  │                 │
     │  + 文件缓存)    │ │            │  │                 │
     └────────┬────────┘ └─────┬──────┘  └────────┬────────┘
              │                │                   │
              ▼                ▼                   ▼
     process_single_unit(cmd)
       ├── 读取源码 bytes
       ├── 清理编译参数 (clean_compile_args)
       ├── libclang parse → TranslationUnit
       ├── CursorSerializer.serialize(tu.cursor)
       │     ├── _build_skeleton()        → 基础字段
       │     ├── _enrich_flags()          → 宏/定义/unexposed 标记
       │     ├── _enrich_type_info()      → 类型系统 + 内存布局
       │     ├── _enrich_signature()      → 函数签名
       │     ├── _enrich_alias_and_dispatch() → 宏别名 + 分派类型
       │     ├── _enrich_modifiers()      → static/virtual/access
       │     ├── _enrich_content()        → value/opcode
       │     ├── _enrich_references()     → ref_usr (跨 TU 引用)
       │     ├── _enrich_field_info()     → offset_bytes (内存布局)
       │     ├── _enrich_inheritance()    → 继承列表
       │     ├── _collect_children_smart()→ 子节点 (参数优先 + 去重)
       │     └── compact_node()           → 删除空值/False/空字符串
       └── gzip 写入 .json.gz
```

## CLI 接口

```bash
python ast_exporter.py \
  --project-root <PATH>    # 项目源码根目录
  --build-dir <PATH>       # compile_commands.json 所在目录
  --output-dir <PATH>      # 输出目录 (会创建 ast_artifacts/ 子目录)
  --jobs <INT>             # 并行进程数 (默认: CPU 核数)
  --exclude <PATTERN>...   # glob 排除模式 (默认: */test/* */tests/* */examples/*)
```

### 输出目录结构

```
{output_dir}/
  compile_commands.json           # 从 build_dir 拷贝
  ast_artifacts/
    {relative_path}/
      {filename}_{hash12}.json.gz # 每个编译单元一个文件
```

- 文件名中的 `{hash12}` = MD5(file + directory + compile_command)[:12]，用于同一源文件多次编译的去重
- JSON 格式: Gzip 压缩, 无缩进 (compact)

## 核心类: CursorSerializer

### 序列化流程 (_serialize_recursive)

对每个 libclang Cursor 执行以下 enrichment pipeline:

```python
node = _build_skeleton(cursor)        # kind, spelling, mangled_name, usr, location
_enrich_flags(cursor, node)           # is_unexposed, macro_name, is_definition
_enrich_type_info(cursor, node)       # type.{fullname, canonical, kind, size, align, is_pointer, is_const}
_enrich_signature(cursor, node)       # signature (函数/方法/构造器)
_enrich_alias_and_dispatch(cursor, node) # alias_name, dispatch_type
_enrich_modifiers(cursor, node)       # storage_class, access_specifier, is_static, is_virtual, ...
_enrich_content(cursor, node)         # value (literals), opcode (operators)
_enrich_references(cursor, node)      # ref_usr
_enrich_field_info(cursor, node)      # offset_bits, offset_bytes (FIELD_DECL), virtual base info
_enrich_inheritance(cursor, node)     # inherits_from (STRUCT/CLASS)
children = _collect_children_smart(cursor) # 递归子节点
compact_node(node)                    # 删除 None/False/空值
```

### _build_skeleton — 基础骨架

所有节点共有的字段:

| 字段 | 来源 | 说明 |
|---|---|---|
| `kind` | `cursor.kind.name` | Clang CursorKind 枚举名 (如 FUNCTION_DECL, CALL_EXPR) |
| `spelling` | `cursor.spelling` | 节点名称; 控制结构空时尝试从源码提取宏名 |
| `mangled_name` | `cursor.mangled_name` | C++ 修饰名 (用于 Linker) |
| `usr` | `cursor.get_usr()` | Unified Symbol Resolution (跨 TU 全局唯一) |
| `location.file` | `_normalize_cursor_path()` | **相对路径** (相对 project_root 或 `_generated/` 前缀) |
| `location.line/col` | `extent.start` | 起始行号/列号 |
| `location.line_end/col_end` | `extent.end` | 结束行号/列号 |
| `location.offset_start/end` | `extent.start/end.offset` | 字节偏移 (用于 ID 生成) |

### 路径归一化 (_normalize_cursor_path)

```
绝对路径 → 相对路径:
  /home/user/project/src/main.c  → src/main.c          (相对 project_root)
  /home/user/build/gen/config.h  → _generated/gen/config.h  (相对 build_dir, 加 _generated 前缀)
  /usr/include/stdio.h           → 原样保留 (外部路径)
```

### _enrich_type_info — 类型系统提取

提取 `cursor.type` 的完整信息:

| 输出字段 | 来源 | 说明 |
|---|---|---|
| `type.fullname` | `t.spelling` | 完整类型名 (含 typedef) |
| `type.canonical` | `t.get_canonical().spelling` | 规范化类型名 (去除 typedef) |
| `type.kind` | `t.kind.name` | TypeKind 枚举名 |
| `type.is_const` | `t.is_const_qualified()` | const 限定 |
| `type.is_pointer` | TypeKind == POINTER | 指针类型 |
| `type.is_reference` | TypeKind in [LVALUE_REF, RVALUE_REF] | 引用类型 |
| `type.return_type` | `cursor.result_type.spelling` | 仅 FUNCTION_DECL |
| `type.size` | `t.get_size()` | **字节大小** (含 crash protection) |
| `type.align` | `t.get_align()` | **对齐要求** (含 crash protection) |

**LibClang Crash Prevention (关键)**:
`get_size()` / `get_align()` 在以下 TypeKind 上会导致 libclang crash，必须跳过:
- INVALID, UNEXPOSED, FUNCTIONPROTO, FUNCTIONNOPROTO, INCOMPLETEARRAY, VOID
- 以及 builtin 类型 (cursor.location.file is None)

### _enrich_content — 值与操作符提取

| 节点类型 | 提取方式 | 输出字段 |
|---|---|---|
| Literals (INT/FLOAT/STRING/CHAR/BOOL) | `get_code_from_source()` — 从源码字节切片 | `value` |
| BINARY_OPERATOR, COMPOUND_ASSIGNMENT | `get_token_spelling()` — 找标点 Token | `opcode` (如 `+`, `=`, `+=`) |
| UNARY_OPERATOR | `get_token_spelling()` + 前后缀判定 | `opcode` (如 `++`, `++(post)`) |
| ENUM_CONSTANT_DECL | `cursor.enum_value` | `enum_value` |

**前后缀操作符判定逻辑** (仅 `++` 和 `--`):
```
if cursor.extent.start.offset == operand.extent.start.offset:
    → 后缀 (操作数在前) → opcode = "++(post)"
else:
    → 前缀 → opcode = "++"
```
这个判定被 ClangJSONParser 的 `handle_unary_operator` 直接消费，映射到 `Operators.postIncrement` vs `Operators.preIncrement`。

### _enrich_alias_and_dispatch — 宏别名 + 调用分派

**alias_name**: 对于声明类节点 (FUNCTION_DECL, VAR_DECL, STRUCT_DECL, PARM_DECL, FIELD_DECL)，如果源码中的原始标识符 (`get_raw_identifier`) 与 `cursor.spelling` 不同，记录为 `alias_name`。这解决了**宏重命名问题** — 例如 Linux Kernel 中 `#define alloc_pages(...) __alloc_pages(...)` 导致 spelling 与源码不一致。

**dispatch_type** (仅 CALL_EXPR): 通过 `_determine_dispatch_type()` 判定:

| cursor.referenced.kind | 条件 | dispatch_type |
|---|---|---|
| FUNCTION_DECL | — | STATIC_DISPATCH |
| CXX_METHOD | is_virtual / is_pure_virtual | DYNAMIC_DISPATCH |
| CXX_METHOD | 非虚 | STATIC_DISPATCH |
| VAR_DECL / PARM_DECL / FIELD_DECL | — | DYNAMIC_DISPATCH (函数指针调用) |
| CONSTRUCTOR / DESTRUCTOR | — | STATIC_DISPATCH |
| None (无 referenced) | — | DYNAMIC_DISPATCH |

### _enrich_modifiers — 修饰符提取

从 cursor 提取并平铺到 node dict:

| 输出字段 | 来源 | 适用节点类型 |
|---|---|---|
| `storage_class` | `cursor.storage_class.name` | 通用 (STATIC/EXTERN/NONE) |
| `is_static` | storage_class == STATIC | 通用 |
| `access_specifier` | `cursor.access_specifier.name` | 类成员 (PUBLIC/PRIVATE/PROTECTED) |
| `is_static_method` | `cursor.is_static_method()` | FUNCTION_DECL/CXX_METHOD/CONSTRUCTOR |
| `is_virtual_method` | `cursor.is_virtual_method()` | 同上 |
| `is_variadic` | `cursor.is_variadic()` | 同上 |
| `is_inline` | `clang_Cursor_isFunctionInlined()` | 同上 (直接调用 C API) |
| `is_pure_virtual` | `cursor.is_pure_virtual_method()` | CXX_METHOD |
| `is_explicit` | `not cursor.is_converting_constructor()` | CONSTRUCTOR |

### _enrich_field_info — 字段偏移 + 虚继承

| 节点类型 | 输出字段 | 说明 |
|---|---|---|
| FIELD_DECL | `offset_bits`, `offset_bytes` | 结构体成员位偏移 / 字节偏移 (Points-to 分析关键) |
| CXX_BASE_SPECIFIER | `is_virtual_base`, `access_specifier`, `type_full_name` | 虚继承信息 |

### _enrich_inheritance — 继承关系

仅对 STRUCT_DECL / CLASS_DECL 生效。浅层遍历子节点，收集所有 CXX_BASE_SPECIFIER 的 `type.spelling` 为 `inherits_from` 列表。

### _collect_children_smart — 子节点收集策略

**两阶段策略 + 去重**:

```
Phase 1 (仅函数/方法/构造器):
  cursor.get_arguments() → 显式参数 (PARM_DECL)
    - 强制 kind = "PARM_DECL"
    - 注入 argument_index = i (0-based)
    - 注入 order = current_order (递增)

Phase 2 (所有节点):
  cursor.get_children() → 标准 AST 子节点
    - TRANSLATION_UNIT 级别: 过滤非项目代码 (is_project_code)
    - 注入 order = current_order (继续递增)

去重:
  safe_id = (kind.value, start_offset, end_offset, spelling)
  已处理的 safe_id 不重复序列化
```

**为什么需要两阶段**: libclang 的 `get_children()` 返回的参数节点有时与 `get_arguments()` 不完全一致 (特别是默认参数、变长参数)。参数优先策略确保参数的 `argument_index` 精确。

### order 字段 — 关键语义

`order` 是从 0 开始的递增计数器，**在每个父节点的 children 收集中独立计算**。它决定了:
1. **AST 子节点排序** — Parser 通过 order 重建语法结构
2. **CFG 构建** — 同一 Block 内语句按 order 排序确定执行顺序
3. **ID 生成** — 作为 SHA-256 hash 的输入之一，区分同一位置的不同节点

**注意**: Parser 消费时会 +1 (Joern 规范 1-based)，所以 Exporter 的 0 对应 Parser 的 1。

## compact_node — 输出压缩

递归删除无用字段以减小 JSON 体积:
- `None` 值 → 删除
- `False` 值 → 删除
- 空 dict `{}` → 删除
- 空 list `[]` → 删除
- 空字符串 `""` → 仅对 `spelling`, `usr`, `opcode`, `mangled_name`, `storage_class` 删除

这意味着 **Parser 不能假设所有字段都存在**，必须用 `.get()` + 默认值读取。

## 源码提取工具函数

| 函数 | 用途 | 输入 → 输出 |
|---|---|---|
| `get_raw_identifier()` | 从源码字节提取原始标识符 | cursor + bytes → `"func_name"` (读取 offset 开始的 alnum/_ 字符) |
| `get_code_from_source()` | 提取完整代码片段 | cursor.extent → `"x + 1"` (主文件用内存 bytes，其他文件用 `_read_file_cached`) |
| `get_token_spelling()` | 提取操作符 token | cursor → `"+"`, `"=="` (找第一个非括号标点 Token) |

**文件内容缓存**: `_read_file_cached()` 维护进程级 dict，最多 100 条 (超过时 clear all)。主文件的 bytes 通过 `AnalysisContext.source_bytes` 传入，不走缓存。

## 并行执行模型

```
main()
  │
  ├── 读取 compile_commands.json
  ├── 过滤 exclude patterns
  ├── 创建 ProcessPoolExecutor(max_workers=jobs)
  │     │
  │     ├── worker_initializer(config)  [每个进程执行一次]
  │     │     ├── faulthandler.enable()  → segfault 时打印 Python 堆栈
  │     │     ├── LIBCLANG_DISABLE_CRASH_RECOVERY=1  → 防止 libclang hang
  │     │     ├── clang.cindex.Index.create()  → 进程独立的 Index
  │     │     └── _file_content_cache = {}  → 进程独立的文件缓存
  │     │
  │     └── submit(process_single_unit, cmd)  [每个编译单元一个 task]
  │
  └── 收集结果, 统计 SUCCESS/SKIPPED/ERROR/CRASH
```

### process_single_unit 流程

```python
1. 读取源文件 bytes (用于 get_code_from_source 等)
2. os.chdir(cmd['directory'])  # 切换到编译命令指定的工作目录
3. 清理编译参数: 移除 -o/-c/-W + 源文件名
4. parse_options = 0x04 | 0x200  # SkipFunctionBodies=OFF, DetailedPreprocessing
5. _worker_clang_index.parse(source_file, args=clean_args, options=parse_options)
6. serialize_cursor(tu.cursor, ...) → JSON dict
7. gzip 写入 {output_dir}/ast_artifacts/{rel_path}/{name}_{hash}.json.gz
```

### 编译参数清理 (clean_compile_args)

移除的参数:
- `-o <file>` / `-c <file>` — 输出/编译目标 (含独立参数和连写形式)
- `-W*` — 所有警告选项 (加速解析)
- 源文件名自身 — 防止重复

**保留**: `-I`, `-D`, `-std=`, `-target`, `-isystem` 等影响语义解析的参数。

## libclang 兼容性

### Polyfill

```python
# MACRO_EXPANSION 在旧版本 libclang 中可能叫 MACRO_INSTANTIATION
try:
    KIND_MACRO_EXPANSION = clang.cindex.CursorKind.MACRO_EXPANSION
except AttributeError:
    KIND_MACRO_EXPANSION = clang.cindex.CursorKind.MACRO_INSTANTIATION  # fallback
```

### parse_options

```python
parse_options = 0x04 | 0x200
# 0x04 = CXTranslationUnit_DetailedPreprocessingRecord (保留宏展开信息)
# 0x200 = CXTranslationUnit_KeepGoing (遇到错误继续解析)
```

### Cursor Hash Safety

libclang 的 `cursor.hash` 有时会 crash。使用 `_get_safe_cursor_id()` 替代:
```python
safe_id = (cursor.kind.value, cursor.extent.start.offset, cursor.extent.end.offset, cursor.spelling)
```

## 全量输出字段参考

### 所有可能出现的字段 (按 enrichment 阶段)

| 阶段 | 字段 | 类型 | 条件 |
|---|---|---|---|
| Skeleton | `kind` | str | 始终存在 |
| Skeleton | `spelling` | str | compact_node 会删除空值 |
| Skeleton | `mangled_name` | str | compact 会删除空值 |
| Skeleton | `usr` | str | compact 会删除空值 |
| Skeleton | `location` | dict | 始终存在 |
| Skeleton | `location.file` | str | None → 被删除 |
| Skeleton | `location.line/col/line_end/col_end` | int | 始终存在 |
| Skeleton | `location.offset_start/offset_end` | int | 始终存在 |
| Flags | `is_unexposed` | bool | 仅 UNEXPOSED_EXPR/STMT |
| Flags | `macro_name` | str | 仅 MACRO_EXPANSION |
| Flags | `is_definition` | bool | 仅定义 (非声明) |
| Type | `type` | dict | 类型有效时 |
| Type | `type.fullname` | str | |
| Type | `type.canonical` | str | |
| Type | `type.kind` | str | TypeKind 枚举名 |
| Type | `type.is_const` | bool | compact 删除 false |
| Type | `type.is_pointer` | bool | compact 删除 false |
| Type | `type.is_reference` | bool | compact 删除 false |
| Type | `type.return_type` | str | 仅 FUNCTION_DECL |
| Type | `type.size` | int | 安全类型才提取 |
| Type | `type.align` | int | 安全类型才提取 |
| Signature | `signature` | str | FUNCTION_DECL/CXX_METHOD/CONSTRUCTOR |
| Alias | `alias_name` | str | 原始名 ≠ spelling 时 |
| Dispatch | `dispatch_type` | str | 仅 CALL_EXPR |
| Modifiers | `storage_class` | str | 非 INVALID 时 |
| Modifiers | `is_static` | bool | |
| Modifiers | `access_specifier` | str | 非 INVALID 时 |
| Modifiers | `is_static_method` | bool | |
| Modifiers | `is_virtual_method` | bool | |
| Modifiers | `is_variadic` | bool | |
| Modifiers | `is_inline` | bool | |
| Modifiers | `is_pure_virtual` | bool | |
| Modifiers | `is_explicit` | bool | |
| Content | `value` | str | Literal 节点 |
| Content | `opcode` | str | Operator 节点 |
| Content | `enum_value` | int | ENUM_CONSTANT_DECL |
| Reference | `ref_usr` | str | cursor.referenced 存在且非自身 |
| Field | `offset_bits` | int | FIELD_DECL |
| Field | `offset_bytes` | int | FIELD_DECL (= offset_bits // 8) |
| Field | `is_virtual_base` | bool | CXX_BASE_SPECIFIER |
| Inheritance | `inherits_from` | list[str] | STRUCT_DECL/CLASS_DECL 有基类时 |
| Children | `children` | list[dict] | 非空时 |
| Children | `children[].order` | int | 始终注入 (0-based 递增) |
| Children | `children[].argument_index` | int | 仅 PARM_DECL (0-based) |

## Known Issues & Tech Debt

1. **`_enrich_designated_init` 未被调用** — `_serialize_recursive` 的 enrichment pipeline 中没有调用 `_enrich_designated_init()`。这意味着 `designator_field` 字段**永远不会出现在输出中**。ClangJSONParser 的 `_extract_designator_and_value()` 有 fallback (从 spelling 提取 `.field`)，但依赖此 fallback 不可靠。**这是一个 Bug**。
2. **os.chdir() 线程安全** — `process_single_unit` 中调用 `os.chdir(cmd['directory'])`，虽然使用多进程隔离了，但如果未来改为多线程将会竞争。
3. **recursion limit 硬编码** — `sys.setrecursionlimit(2000)`，深度嵌套的宏展开或模板实例化可能超过此限制。
4. **_file_content_cache 粗暴清理** — 超过 100 条时 `clear()` 全部清空，没有 LRU 策略。
5. **bare except 过多** — 多处使用 `except:` 或 `except Exception:`，吞没了具体错误信息，不利于调试。
6. **get_token_spelling 可能返回错误操作符** — 对于多 Token 表达式 (如 `a->b`)，查找第一个非括号标点可能返回 `-` 而非 `->`。
7. **parse_options 使用魔术数字** — `0x04 | 0x200` 没有引用 clang 常量名。
8. **return_type 仅对 FUNCTION_DECL 提取** — CXX_METHOD, CONSTRUCTOR, DESTRUCTOR 的 `type.return_type` 不会被设置，但 ClangJSONParser 的 `handle_function_decl` 依赖此字段。
9. **compact_node 可能删除有意义的 False** — `is_const: false` 等布尔字段会被删除，导致 Parser 无法区分 "不是 const" 和 "未知是否 const"。
10. **无增量构建** — 每次运行都重新导出所有文件，即使 JSON 已存在。spec.md 提到了这个 TODO。
11. **控制结构的 spelling 提取** — 当 `cursor.spelling` 为空时尝试 `get_raw_identifier()`，但这只能提取宏名 (如 `list_for_each_entry`)，对普通 `for`/`if` 无效 (它们的 keyword 不是 identifier)。

## 改造指南

### 修复 designator_field Bug (#1)

在 `_serialize_recursive` 的 enrichment 链中添加:
```python
self._enrich_designated_init(cursor, node)  # 在 _enrich_content 之后
```

### 新增 Exporter 字段

1. 在 `_serialize_recursive` 中添加新的 `_enrich_xxx()` 调用
2. 在对应的 enrich 方法中提取数据
3. 确认 `compact_node` 不会误删新字段
4. **同步更新 ClangJSONParser 的 `_extract_metadata()`** 以消费新字段
5. 更新本 CLAUDE.md 的字段参考表

### 新增语言支持

当前架构是 Clang-specific 的。如果要支持其他语言 (如 Go, Rust):
- 需要新建独立的 exporter (不共享 CursorSerializer)
- 但应保持相同的 **JSON 输出格式** (kind, spelling, order, children, location, type)
- 这样可以复用 IRParser 基类，只需实现新的 dispatch table

### 性能优化方向

- 增量构建: 检查 `{hash}.json.gz` 是否存在并跳过
- 文件缓存: 用 `functools.lru_cache` 替代手动 dict
- 压缩: 考虑 zstd 替代 gzip (更快)

## Agent Rules

1. **Exporter 和 Parser 是强耦合的** — 任何 Exporter 输出格式变更都必须同步更新 `clang_json_parser.py` 和 `parsers/ir/CLAUDE.md`
2. **不要假设所有字段都存在** — `compact_node` 会删除空值，Parser 必须用 `.get()` 读取
3. **order 是 0-based** — Exporter 输出 0-based，Parser 消费时 +1 转为 Joern 1-based
4. **argument_index 是 0-based** — 同上
5. **type.size/align 不一定存在** — 仅安全类型才提取，Parser 不能依赖它
6. **测试修改时需要真实的 compile_commands.json** — 没有 mock 框架，需要实际项目构建产物
7. **libclang crash 是真实风险** — 任何新增的 libclang API 调用都必须 try-except 保护
