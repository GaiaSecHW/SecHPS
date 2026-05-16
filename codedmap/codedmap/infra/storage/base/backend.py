# codedmap\infra\storage\base\backend.py

from codedmap.infra.storage.interfaces import ConnectionManager

class BaseBackend(ConnectionManager):
    """
    可以在这里放一些通用的连接池配置逻辑
    """
    pass