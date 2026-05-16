# codedmap\core\schema\operators.py

class Operators:
    """
    Joern 标准操作符集合 (增强版)
    """
    
    # --- 赋值与算术 ---
    assignment = "<operator>.assignment"
    assignmentPlus = "<operator>.assignmentPlus"
    assignmentMinus = "<operator>.assignmentMinus"
    assignmentMultiplication = "<operator>.assignmentMultiplication"
    assignmentDivision = "<operator>.assignmentDivision"

    arrayInitializer = "<operator>.arrayInitializer"
    
    addition = "<operator>.addition"
    subtraction = "<operator>.subtraction"
    multiplication = "<operator>.multiplication"
    division = "<operator>.division"
    modulo = "<operator>.modulo"

    # [New] 自增/自减 (区分前后缀对于 缓冲区边界检查/整数溢出 至关重要)
    postIncrement = "<operator>.postIncrement" # i++
    preIncrement = "<operator>.preIncrement"   # ++i
    postDecrement = "<operator>.postDecrement" # i--
    preDecrement = "<operator>.preDecrement"   # --i

    # --- 指针运算与底层访问 ---
    fieldAccess = "<operator>.fieldAccess"
    memberAccess = "<operator>.memberAccess"  # 通用的成员访问 (部分 Parser 可能使用此通用名代替 fieldAccess)
    indexAccess = "<operator>.indexAccess"
    indirectFieldAccess = "<operator>.indirectFieldAccess"
    indirectIndexAccess = "<operator>.indirectIndexAccess"
    pointerShift = "<operator>.pointerShift"  # 指针偏移 (e.g. ptr + i, 常用于数组访问的底层实现)
    getElementPtr = "<operator>.getElementPtr"  # LLVM IR 风格的元素指针获取 (GetElementPtr, GEP)

    
    # --- 逻辑与比较 ---
    equals = "<operator>.equals"
    notEquals = "<operator>.notEquals"
    greaterThan = "<operator>.greaterThan"
    greaterEqualsThan = "<operator>.greaterEqualsThan"
    lessThan = "<operator>.lessThan"
    lessEqualsThan = "<operator>.lessEqualsThan"
    logicalAnd = "<operator>.logicalAnd"
    logicalOr = "<operator>.logicalOr"
    logicalNot = "<operator>.logicalNot"

    # --- 位运算 ---
    shiftLeft = "<operator>.shiftLeft"
    arithmeticShiftRight = "<operator>.arithmeticShiftRight"
    logicalShiftRight = "<operator>.logicalShiftRight"
    and_ = "<operator>.and"
    or_ = "<operator>.or"
    xor = "<operator>.xor"
    not_ = "<operator>.not" # 按位取反 ~
    plus = "<operator>.plus"  # +x
    minus = "<operator>.minus"

    # --- 其他 ---
    conditional = "<operator>.conditional"
    comma = "<operator>.comma"
    cast = "<operator>.cast"
    asm = "<operator>.asm"
    addressOf = "<operator>.addressOf"
    sizeOf = "<operator>.sizeOf"
    indirection = "<operator>.indirection" # *ptr