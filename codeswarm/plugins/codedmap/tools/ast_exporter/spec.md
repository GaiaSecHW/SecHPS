这份文档采用了标准的 **SDD (Specification-Driven Development)** 格式。它将你提供的 Python 代码转化为一份详细的设计规格说明书，明确了**数据契约 (Schema)**、**模块职责**、**处理流程**以及**异常边界**。

这份文档将作为后续功能迭代（如增加新的 AST 节点类型支持、优化并行策略或对接图数据库）的基准。

---

# C/C++ AST Exporter Tool - Technical Specification Document (v1.0)

## 1. 概述 (Overview)

### 1.1 目标 (Goal)

本工具旨在提供一个高性能、并行的 C/C++ 抽象语法树 (AST) 导出方案。它基于 `compile_commands.json` 构建数据库，利用 `libclang` 解析源码，并将包含丰富语义信息（类型、内存布局、继承关系等）的 AST 序列化为结构化的 JSON 格式，供后续代码分析（如静态分析、图数据库构建）使用。

### 1.2 核心特性 (Key Features)

* **构建感知**：直接解析 `compile_commands.json`，确保解析环境与编译环境一致。
* **高保真数据**：提取类型大小、对齐 (Alignment)、字段偏移 (Offset)、虚函数表特性等底层细节。
* **并行架构**：利用多进程 (ProcessPool) 规避 Python GIL 限制，加速大规模项目分析。
* **鲁棒性设计**：隔离 LibClang 的崩溃风险（Crash Recovery），支持断点续传。

---

## 2. 系统架构 (System Architecture)

### 2.1 架构图 (Architecture Diagram)

### 2.2 模块划分

系统主要由以下四个核心模块组成：

1. **Orchestrator (Main/Scheduler)**: 负责配置加载、编译库解析、任务分片与进程调度。
2. **Worker Runtime**: 隔离的进程执行环境，维护独立的 LibClang Index 实例和文件缓存。
3. **Clang Adapter**: 封装 LibClang API，处理版本兼容性 (Polyfill) 和底层数据提取。
4. **Serializer Engine**: 核心转换引擎，负责将 Clang Cursor 对象递归映射为 JSON 字典，并进行语义增强。

---

## 3. 数据契约与输出规范 (Data Schema Specification)

本节定义输出 JSON 的标准格式。这是后续迭代中最重要的“协议”。

### 3.1 文件命名规范

* 输出路径：`{output_dir}/ast_artifacts/{relative_path_to_source_dir}/`
* 文件名：`{source_filename}_{content_hash_12chars}.json.gz`
* 格式：Gzip 压缩的 JSON 文件。

### 3.2 节点对象结构 (Node Schema)

每个 AST 节点 **MUST** 包含基础信息，并根据节点类型 **OPTIONAL** 包含增强信息。

#### 3.2.1 基础字段 (Base Fields)

| 字段名 | 类型 | 描述 |
| --- | --- | --- |
| `kind` | String | 节点类型 (e.g., `FUNCTION_DECL`, `VAR_DECL`) |
| `spelling` | String | 节点名称/符号名 |
| `usr` | String | Unified Symbol Resolution (唯一标识符) |
| `location` | Object | `{file, line, col, offset_start, offset_end}` |
| `children` | List | 子节点列表 (递归结构) |
| `order` | Int | 全局遍历顺序 ID (用于重建层级顺序) |

#### 3.2.2 类型增强字段 (Type Information)

当节点具有类型时（如变量声明、函数返回类型）：
| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `type.fullname` | String | 完整类型名 |
| `type.canonical` | String | 规范化类型名 (去除 typedef) |
| `type.size` | Int | 类型大小 (Bytes) |
| `type.align` | Int | 内存对齐要求 (Bytes) |
| `type.is_pointer` | Bool | 是否为指针 |
| `type.is_const` | Bool | 是否为 Const |

#### 3.2.3 语义增强字段 (Semantic Enrichment)

| 字段名 | 适用场景 | 描述 |
| --- | --- | --- |
| `storage_class` | 通用 | `STATIC`, `EXTERN`, etc. |
| `access_specifier` | 类成员 | `PUBLIC`, `PRIVATE`, `PROTECTED` |
| `is_virtual_method` | C++方法 | 是否为虚函数 |
| `is_pure_virtual` | C++方法 | 是否为纯虚函数 |
| `offset_bits` | 字段声明 | 结构体成员的位偏移量 (Points-to 分析关键) |
| `opcode` | 表达式 | 操作符 (如 `+`, `++(post)`) |
| `inherits_from` | 类/结构体 | 基类列表 `[BaseClassA, BaseClassB]` |
| `dispatch_type` | 函数调用 | `STATIC_DISPATCH` 或 `DYNAMIC_DISPATCH` |

---

## 4. 详细设计 (Detailed Design)

### 4.1 预处理与配置 (Setup Phase)

* **Compile Commands Cleaning**: 必须过滤掉不仅无用反而可能导致解析错误的 Flags。
* *Rule*: 移除 `-o`, `-c` 及其参数。
* *Rule*: 移除 `-W` (Warnings) 以加快解析速度（除非涉及特定宏定义）。
* *Rule*: 移除指向源文件自身的参数。



### 4.2 序列化逻辑 (Serialization Logic)

序列化器必须遵循 `CursorSerializer` 类的设计模式，采用 **Recursive Descent + Enrichment Hooks** 的方式。

#### 4.2.1 遍历策略

为了避免冗余和死循环，遍历策略如下：

1. **参数优先**：对于函数/方法，优先显式提取 `get_arguments()` 作为 `PARM_DECL` 处理。
2. **子节点遍历**：随后调用 `get_children()` 获取剩余子节点（如函数体）。
3. **去重机制**：使用 `(kind, start_offset, end_offset, spelling)` 元组作为唯一键，防止同一 Cursor 被多次访问（LibClang 的常见陷阱）。

#### 4.2.2 容错与兼容 (Polyfills)

* **宏展开支持**：若 LibClang 版本过低不支持 `MACRO_EXPANSION`，需降级处理或记录 Warning，不可 Crash。
* **Crash Prevention**：访问 `get_size()` 或 `get_align()` 前，必须检查类型是否为 `INVALID`, `UNEXPOSED`, `VOID`, `FUNCTIONPROTO`。

### 4.3 并行工作流 (Parallel Workflow)

利用 `ProcessPoolExecutor`。

1. **Initializer**: 进程启动时调用 `worker_initializer`。
* 初始化 `clang.cindex.Index` (每个进程单例)。
* 配置 `faulthandler` 以捕获底层 C++ Segfault。
* 设置 `LIBCLANG_DISABLE_CRASH_RECOVERY=1` (让 Python 层捕获或让进程快速失败重启，防止 Hang 住)。


2. **Cache**: 进程内维护 `_file_content_cache` (LRU 策略，Max 100)，减少 IO 开销。

---

## 5. 接口定义 (Interface Specifications)

### 5.1 CLI 参数

```bash
python ast_exporter.py \
  --project-root <PATH> \  # 项目根目录
  --build-dir <PATH> \     # 包含 compile_commands.json 的目录
  --output-dir <PATH> \    # 产物输出目录
  --jobs <INT> \           # 并发数 (Default: CPU Count)
  --exclude <PATTERN>...   # Glob 排除模式 (e.g., */test/*)

```

### 5.2 内部类职责

#### `class ASTExporterConfig`

* **职责**: 不可变配置容器。
* **属性**: `project_root`, `output_dir`, `build_dir`, `exclude_patterns`.

#### `class CursorSerializer`

* **职责**: 状态无关的转换器。
* **方法**: `serialize(cursor) -> Dict`.
* **约束**: 不得修改输入的 Cursor 对象；必须处理所有 LibClang 抛出的 Python Exception。

---

## 6. 限制与风险 (Constraints & Risks)

### 6.1 已知限制

1. **系统头文件**: 默认跳过非项目根目录下的文件（`is_project_code` 检查），因此标准库的 AST 不会被导出。
2. **模板实例化**: LibClang 在 AST 遍历时对复杂的 C++ 模板实例化支持可能不完全，可能导致部分模板代码节点缺失。

### 6.2 异常处理策略

* **文件级隔离**: 单个源文件的解析失败 (CRASH/ERROR) **不得** 中断整个任务。
* **状态记录**: 失败的文件必须记录在日志中，并在最终 Stats 中体现。
* **内存保护**: 读取源码片段时，必须校验 `offset` 边界，防止 Slice 越界异常。

---

## 7. 迭代计划 (Future Iteration Roadmap)

基于当前代码库，后续开发建议按以下顺序进行：

1. **Phase 1: 增量构建支持**
* 目前使用 Hash 命名，但未比对 Output 目录已存在文件的 Hash。
* *TODO*: 在处理前检查 `{file_hash}.json.gz` 是否已存在，若存在则跳过解析。


2. **Phase 2: 跨文件引用增强**
* 目前 `ref_usr` 仅记录了 ID。
* *TODO*: 建立简单的内存索引，记录 `USR -> 定义文件` 的映射，以便后续分析跨文件跳转。


3. **Phase 3: 这里的图数据库对接**
* *TODO*: 编写 `JSON -> CSV/GraphML` 的转换器，适配 Neo4j 或 NetworkX。
* 重点映射：`inherits_from` (Edge: INHERITS), `children` (Edge: CONTAINS), `ref_usr` (Edge: CALLS/USES).



---

### [附录] 关键检查清单 (Code Review Checklist)

在修改 `CursorSerializer` 时，请务必检查：

* [ ] 是否处理了 `TypeKind.INVALID` 导致的崩溃？
* [ ] 是否在递归中传递了 `AnalysisContext`？
* [ ] 是否更新了 `compact_node` 以支持新字段的空值过滤？
* [ ] 新增的字段是否在 `Data Schema` 中定义？