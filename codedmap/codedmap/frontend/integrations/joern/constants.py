# codedmap/frontend/integrations/joern/constants.py

"""
Joern Neo4j CSV -> codedmap 的映射常量表。

包含：
1. 属性名映射 (Joern UPPER_SNAKE_CASE -> codedmap camelCase)
2. Label 别名映射 (Joern 特有名称 -> codedmap NodeLabel)
3. 边类型别名映射
4. Neo4j CSV 类型注解处理
"""

from typing import Dict, Set

# =============================================================================
# 1. 属性名映射表 (Joern CSV Header -> codedmap Pydantic field alias)
# =============================================================================
# Joern Neo4j CSV 使用 UPPER_SNAKE_CASE，codedmap Pydantic 使用 camelCase 别名
# 映射方向: Joern CSV column name -> codedmap 构造参数名

PROPERTY_NAME_MAP: Dict[str, str] = {
    # 基础标识
    "NAME": "name",
    "FULL_NAME": "fullName",
    "CODE": "code",
    "SIGNATURE": "signature",

    # 位置信息
    "LINE_NUMBER": "lineNumber",
    "COLUMN_NUMBER": "columnNumber",
    "LINE_NUMBER_END": "lineNumberEnd",
    "COLUMN_NUMBER_END": "columnNumberEnd",
    "OFFSET": "offsetStart",
    "OFFSET_END": "offsetEnd",
    "ORDER": "order",
    "FILENAME": "fileName",

    # 类型系统
    "TYPE_FULL_NAME": "typeFullName",
    "TYPE_DECL_FULL_NAME": "typeDeclFullName",
    "INHERITS_FROM_TYPE_FULL_NAME": "inheritsFromTypeFullName",
    "ALIAS_TYPE_FULL_NAME": "aliasTypeFullName",
    "DYNAMIC_TYPE_HINT_FULL_NAME": "dynamicTypeHintFullName",

    # 调用语义
    "METHOD_FULL_NAME": "methodFullName",
    "DISPATCH_TYPE": "dispatchType",
    "ARGUMENT_INDEX": "argumentIndex",

    # 声明属性
    "IS_EXTERNAL": "isExternal",
    "IMPORTED_ENTITY": "importedEntity",
    "IMPORTED_AS": "importedAs",
    "CANONICAL_NAME": "canonicalName",
    "PARSER_TYPE_NAME": "parserTypeName",
    "MODIFIER_TYPE": "modifierType",
    "CONTROL_STRUCTURE_TYPE": "controlStructureType",

    # 闭包
    "CLOSURE_ORIGINAL_NAME": "closureOriginalName",
    "EVALUATION_STRATEGY": "evaluationStrategy",
    "CLOSURE_BINDING_ID": "closureBindingId",

    # 依赖
    "DEPENDENCY_GROUP_ID": "dependencyGroupId",
    "VERSION": "version",

    # 元数据
    "LANGUAGE": "language",
    "ROOT": "root_path",

    # AST 上下文
    "AST_PARENT_TYPE": "astParentType",
    "AST_PARENT_FULL_NAME": "astParentFullName",

    # 其他
    "IS_VARIADIC": "isVariadic",
    "HASH": "hash",
    "VALUE": "value",
    "CONTENT": "content",

    # Joern Finding / Location / Tag 属性
    "KEY": "key",
    "SYMBOL": "symbol",
    "PACKAGE_NAME": "packageName",
    "CLASS_NAME": "className",
    "CLASS_SHORT_NAME": "classShortName",
    "METHOD_SHORT_NAME": "methodShortName",
    "NODE_LABEL": "nodeLabel",
    "ARGUMENT_NAME": "argumentName",
    "INDEX": "index",
}

# =============================================================================
# 2. 节点 Label 别名映射 (Joern 特有 -> codedmap 标准)
# =============================================================================
# 大多数 label 直接匹配，只有少数 Joern 特有的需要映射

NODE_LABEL_ALIAS: Dict[str, str] = {
    "NAMESPACE": "NAMESPACE_BLOCK",
    "TYPE_ARGUMENT": "TYPE_REF",
    "CONFIG_FILE": "FILE",
    "TYPE_PARAMETER": "TYPE_REF",
}

# =============================================================================
# 3. 边类型别名映射
# =============================================================================

EDGE_TYPE_ALIAS: Dict[str, str] = {
    "REACHING_DEF": "DDG",
    "DOMINATE": "CDG",
    "POST_DOMINATE": "CDG",
}

# =============================================================================
# 3b. 语言别名映射 (Joern 特有 -> codedmap Language 枚举值)
# =============================================================================

LANGUAGE_ALIAS: Dict[str, str] = {
    "NEWC": "C",        # Joern uses NEWC for C language
    "JAVA": "JAVA",
}

# =============================================================================
# 4. 全局节点 label 集合 (用于 ID 策略判断)
# =============================================================================
# 这些节点在 hybrid ID 策略中使用 regenerate（重新计算确定性 ID）

GLOBAL_NODE_LABELS: Set[str] = {
    "METHOD",
    "TYPE_DECL",
    "TYPE",
    "FILE",
    "META_DATA",
    "NAMESPACE_BLOCK",
}

# =============================================================================
# 5. 边属性提取规则
# =============================================================================
# 定义哪些边类型需要从 CSV 行中提取特殊属性

EDGE_PROPERTY_KEYS: Dict[str, str] = {
    # edge_type -> CSV column that holds the semantic property
    "DDG": "VARIABLE",
    "REACHING_DEF": "VARIABLE",
}

# =============================================================================
# 6. Neo4j CSV 类型注解
# =============================================================================
# Neo4j CSV header 中的类型后缀 -> Python 转换函数名

NEO4J_TYPE_SUFFIXES: Dict[str, str] = {
    "ID": "id",
    "LABEL": "label",
    "TYPE": "type",
    "START_ID": "start_id",
    "END_ID": "end_id",
    "INT": "int",
    "LONG": "long",
    "FLOAT": "float",
    "DOUBLE": "double",
    "BOOLEAN": "boolean",
    "STRING": "string",
    "STRING[]": "string_array",
    "INT[]": "int_array",
    "LONG[]": "long_array",
}

# =============================================================================
# 7. 需要跳过的属性 (不映射到 codedmap)
# =============================================================================
# 这些 Joern 属性在 codedmap 中没有对应字段，直接忽略

SKIP_PROPERTIES: Set[str] = {
    "OVERLAYS",
    "CONTAINED_REF",
    "INHERITS_FROM_TYPE_FULL_NAME",  # 会在 mapper 中特殊处理为列表
}
