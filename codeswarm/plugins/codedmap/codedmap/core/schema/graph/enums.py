# codedmap/core/schema/enums.py

import logging
from typing import Type, TypeVar, Any, Union
from enum import Enum

logger = logging.getLogger(__name__)

# 定义泛型变量，约束为 Enum 的子类
E = TypeVar("E", bound=Enum)


def safe_str_to_enum(
        value: Union[str, E, Any],
        enum_cls: Type[E],
        default: E,
        log_warning: bool = True,
        context: str = ""
) -> E:
    """
    [Utility] 安全地将输入转换为指定的枚举类型。
    支持按 Value (字符串值) 或 Name (枚举名) 查找。

    Args:
        value: 输入值 (可能是字符串、已有的 Enum 对象，或者脏数据)
        enum_cls: 目标 Enum 类 (e.g., DispatchType)
        default: 转换失败时的回退值 (e.g., DispatchType.STATIC_DISPATCH)
        log_warning: 是否记录警告日志
        context: 上下文描述，用于日志中定位是哪个字段出问题 (e.g. "CallNode.dispatchType")

    Returns:
        转换后的 Enum 对象，或者 default 值。
    """
    # 1. Fast Path: 如果已经是目标类型，直接返回
    if isinstance(value, enum_cls):
        return value

    # 2. String Lookup Path
    if isinstance(value, str):
        # 尝试 A: 按 Value 匹配 (最常见，对应 JSON 中的 "STATIC_DISPATCH")
        try:
            return enum_cls(value)
        except ValueError:
            pass

        # 尝试 B: 按 Name 匹配 (对应 Python 代码中的 CONST_NAME)
        # 例如: Enum定义为 class T(Enum): A = "a_val"
        # 输入 "A" 时，enum_cls["A"] 能找到，但 enum_cls("A") 会挂
        try:
            return enum_cls[value]
        except KeyError:
            pass

    # 3. Fallback Path
    if log_warning:
        ctx_msg = f" [{context}]" if context else ""
        logger.warning(
            f"Invalid enum value '{value}' for {enum_cls.__name__}{ctx_msg}. "
            f"Falling back to {default.value}"
        )

    return default

# =============================================================================
# 1. 图的基本元素 (Ontology) - 全局通用
# =============================================================================

class NodeLabel(str, Enum):
    """Joern CPG 节点类型标签"""

    # --- 元数据 ---
    BASE_LABEL = "AstNode"
    META_DATA = "META_DATA"
    FILE = "FILE"
    DIRECTORY = "DIRECTORY"
    MODULE = "MODULE"  # 逻辑模块 (跨目录的架构单元)
    UNKNOWN = "UNKNOWN"
    TAG = "TAG"  # 标签节点
    EMBEDDING_CHUNK = "EMBEDDING_CHUNK"
    INSIGHT = "INSIGHT"
    VECTOR = "VECTOR" # 向量分离节点

    # --- 声明类 ---
    METHOD = "METHOD"
    METHOD_PARAMETER_IN = "METHOD_PARAMETER_IN"
    METHOD_PARAMETER_OUT = "METHOD_PARAMETER_OUT"
    METHOD_RETURN = "METHOD_RETURN"  # 方法的返回值出口节点
    LOCAL = "LOCAL"                  # 局部变量声明 (int x;)
    MEMBER = "MEMBER"                # 类/结构体成员声明 (class A { int x; })
    TYPE_DECL = "TYPE_DECL"          # 类型定义 (class A {})
    NAMESPACE_BLOCK = "NAMESPACE_BLOCK"  # 命名空间/包

    # --- 函数对象与闭包 ---
    METHOD_REF = "METHOD_REF"           # 函数引用 (函数指针/Lambda对象)
    CLOSURE_BINDING = "CLOSURE_BINDING"  # 闭包捕获的变量

    # --- 类型系统与绑定 ---
    TYPE = "TYPE"                       # 具体的类型实体 (如 "int", "std::vector")
    TYPE_REF = "TYPE_REF"               # 对类型的引用 (指针/引用)
    BINDING = "BINDING"                 # 将方法绑定到类型上 (Method Resolution)

    # --- 表达式/语句 ---
    BLOCK = "BLOCK"
    CALL = "CALL"
    LITERAL = "LITERAL"
    IDENTIFIER = "IDENTIFIER"
    FIELD_IDENTIFIER = "FIELD_IDENTIFIER"  # 明确区分字段名节点
    RETURN = "RETURN"

    # --- 控制结构 ---
    CONTROL_STRUCTURE = "CONTROL_STRUCTURE"  # if, while, for, try, switch
    JUMP_TARGET = "JUMP_TARGET"             # label, case, default

   # --- 语言特性 ---
    IMPORT = "IMPORT"                       # import, #include
    ANNOTATION = "ANNOTATION"               # Python Decorator / Java Annotation
    ANNOTATION_PARAMETER = "ANNOTATION_PARAMETER"
    ANNOTATION_PARAMETER_ASSIGN = "ANNOTATION_PARAMETER_ASSIGN"
    ANNOTATION_LITERAL = "ANNOTATION_LITERAL"
    ARRAY_INITIALIZER = "ARRAY_INITIALIZER"
    MODIFIER = "MODIFIER"               # public, static, native...
    COMMENT = "COMMENT"
    JUMP_LABEL = "JUMP_LABEL"           # label for BREAK/CONTINUE targets
    DEPENDENCY = "DEPENDENCY"             # 依赖库版本信息

    # --- Joern 分析结果 ---
    FINDING = "FINDING"                   # Joern vulnerability finding
    KEY_VALUE_PAIR = "KEY_VALUE_PAIR"     # Finding key-value metadata
    TAG_NODE_PAIR = "TAG_NODE_PAIR"       # Node-Tag association container
    LOCATION = "LOCATION"                 # Source location summary


class EdgeType(str, Enum):
    """
    Joern CPG 标准边类型定义
    按照图层 (Overlay) 分组
    """

    # --- 1. 基础结构层 (AST & Hierarchy) ---
    AST = "AST"                 # 抽象语法树：父节点 -> 子节点
    CONTAINS = "CONTAINS"       # 包含关系：文件 -> 方法，类 -> 方法
    SOURCE_FILE = "SOURCE_FILE"  # 节点 -> 所属文件 (通常是 Method -> File)

    # --- 2. 调用图层 (Call Graph) ---
    CALL = "CALL"               # 调用点 -> 被调用的方法 (Call Site -> Method)
    RECEIVER = "RECEIVER"       # 调用表达式 -> 接收者对象 (x.method() 中 Call -> x)
    ARGUMENT = "ARGUMENT"       # 调用表达式 -> 参数表达式 (Call -> x)
    CONDITION = "CONDITION"     # 控制结构 -> 条件表达式 (If -> expr)

    # --- 3. 控制流层 (CFG - Control Flow Graph) ---
    CFG = "CFG"                 # 执行流：前驱语句 -> 后继语句

    # --- 4. 依赖层 (PDG - Program Dependence Graph) ---
    CDG = "CDG"                 # 控制依赖：条件节点 -> 被该条件控制的语句
    DDG = "DDG"                 # 数据依赖：定义处 -> 使用处 (Def -> Use)

    # --- 5. 符号与引用层 (Symols & Types) ---
    BINDS = "BINDS"      # 形式参数输入 -> 形式参数输出
    REF = "REF"                 # 引用：标识符使用 -> 局部变量定义 (Identifier -> Local/Param)
    EVAL_TYPE = "EVAL_TYPE"     # 类型推导：表达式 -> 类型节点
    INHERITS_FROM = "INHERITS_FROM"  # 继承关系：TypeDecl -> TypeDecl

    # --- 6. 参数传递层 ---
    PARAMETER_LINK = "PARAMETER_LINK"

    # --- 捕获 ---
    CAPTURE = "CAPTURE"       # MethodRef -> ClosureBinding
    CAPTURED_BY = "CAPTURED_BY"  # Local -> MethodRef (反向)

    # --- 内存分析 (C/C++) ---
    POINTS_TO = "POINTS_TO"  # Pointer -> MemoryLocation

    # --- 宏观依赖 ---
    INCLUDES = "INCLUDES"    # File -> File (物理文件依赖)

    # --- 辅助与增强 ---
    DOC_COMMENT = "DOC_COMMENT"
    HAS_CHUNK = "HAS_CHUNK"
    HAS_INSIGHT = "HAS_INSIGHT"
    HAS_VECTOR = "HAS_VECTOR" # 向量关联边

    # --- 7. Cross-Boundary Layer ---
    IPC = "IPC"              # Inter-process communication (pipe, socket, shared mem)
    SYSCALL = "SYSCALL"      # Userspace call -> kernel handler
    RPC = "RPC"              # Remote procedure call (gRPC, REST, thrift)
    SHARED_DATA = "SHARED_DATA"  # Shared data structure / memory region


class EdgeDirection(str, Enum):
    OUT = "OUT"
    IN = "IN"
    BOTH = "BOTH"
    
# =============================================================================
# 2. 语言特性细节 (Language Specifics) - Parser/Builder 使用
# =============================================================================

class DispatchType(str, Enum):
    """方法分发类型"""
    STATIC_DISPATCH = "STATIC_DISPATCH"     # 静态分发：编译期确定
    DYNAMIC_DISPATCH = "DYNAMIC_DISPATCH"   # 动态分发：运行期确定
    INLINED = "INLINED"             # 内联展开"


class ModifierType(str, Enum):
    """
    修饰符类型 (Modifier Types)
    对应 ModifierNode 的 modifierType 属性
    """
    # 访问控制
    STATIC = "STATIC"
    PUBLIC = "PUBLIC"
    PRIVATE = "PRIVATE"
    PROTECTED = "PROTECTED"
    CONST = "CONST"
    INLINE = "INLINE"
    EXTERN = "EXTERN"

    # 继承与实现
    VIRTUAL = "VIRTUAL"
    ABSTRACT = "ABSTRACT"
    FINAL = "FINAL"         # 建议补充

    # 语言特定
    NATIVE = "NATIVE"
    GLOBAL = "GLOBAL"       # 全局变量
    MACRO = "MACRO"
    CONSTRUCTOR = "CONSTRUCTOR"  # 构造函数
    READONLY = "READONLY"


class ControlStructureType(str, Enum):
    """
    Joern 标准控制流结构类型
    规范要求全大写
    """
    IF = "IF"
    ELSE = "ELSE"
    WHILE = "WHILE"
    FOR = "FOR"
    DO = "DO"           # do-while
    SWITCH = "SWITCH"
    BREAK = "BREAK"
    CONTINUE = "CONTINUE"
    RETURN = "RETURN"   # 虽然有 ReturnNode，但在某些 AST 表达中也可能作为结构
    GOTO = "GOTO"
    TRY = "TRY"
    THROW = "THROW"
    MATCH = "MATCH"     # Python match-case / Rust match
    YIELD = "YIELD"


class EvaluationStrategy(str, Enum):
    """求值策略 (Closures & Parameters)"""
    BY_REFERENCE = "BY_REFERENCE"
    BY_SHARING = "BY_SHARING"
    BY_VALUE = "BY_VALUE"


class SlicingDirection(str, Enum):
    FORWARD = "FORWARD"   # 污点传播方向 (Source -> Sink)
    BACKWARD = "BACKWARD"  # 溯源方向 (Sink -> Source)
    BIDIRECTIONAL = "BIDIRECTIONAL"  # 双向邻居


class SliceMode(str, Enum):
    DATA_FLOW = "DATA_FLOW"       # 仅基于 DDG
    CONTROL_FLOW = "CONTROL_FLOW"  # 仅基于 CDG/CFG
    PROGRAM_SLICE = "PROGRAM_SLICE"  # 经典切片 (DDG + CDG)
    REACHABILITY = "REACHABILITY"  # Source 到 Sink 的所有路径 (Chop)


class Language(str, Enum):
    """语言类型"""
    C = "C"
    CPP = "CPP"
    JAVA = "JAVA"
    PYTHON = "PYTHON"
    JAVASCRIPT = "JAVASCRIPT"
    MIXED = "MIXED"


# =============================================================================
# 3. 分析策略 (Analysis Config) - Dispatch/Pipeline 使用
# =============================================================================

class ParseStrategy(str, Enum):
    FULL = "FULL"
    SKELETON = "SKELETON"
    IGNORE = "IGNORE"

class FileRiskLevel(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    LOW = "LOW"
    UNKNOWN = "UNKNOWN"


class VectorIndexName(str, Enum):
    """
    向量索引名称注册表。
    """
    # 全局向量索引
    GLOBAL = "global_vector_index"
    