class StorageError(Exception):
    """存储层基类异常"""
    pass

class ConnectionError(StorageError):
    """连接失败"""
    pass

class IntegrityError(StorageError):
    """违反唯一约束或外键约束"""
    pass

class TransientError(StorageError):
    """临时性错误（如死锁、超时），提示上层可重试"""
    pass

class SchemaError(StorageError):
    """Schema 版本不匹配或初始化失败"""
    pass