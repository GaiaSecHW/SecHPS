class DSLError(Exception):
    """DSL 层通用异常基类"""
    pass

class QuerySyntaxError(DSLError):
    """查询语法错误 (如使用了不支持的操作)"""
    pass

class QueryExecutionError(DSLError):
    """底层存储执行错误封装"""
    pass
