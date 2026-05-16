# codedmap\infra\storage\driver_neo4j\client.py

from neo4j import GraphDatabase, Driver, Session
from typing import Generator, Any, Dict, List, Optional
from contextlib import contextmanager
import logging
import re

logger = logging.getLogger(__name__)

class Neo4jClient:
    """
    负责管理 Neo4j 连接和 Session 的底层客户端。
    """
    def __init__(self, uri: str, auth: tuple, max_connection_lifetime: int = 3600, database: str = "neo4j"):
        self._uri = uri
        self._database = database.replace('_', '-')
        # 配置连接池参数，提高生产环境稳定性
        self._driver: Driver = GraphDatabase.driver(
            uri, 
            auth=auth,
            max_connection_lifetime=max_connection_lifetime
        )

    def verify_connectivity(self):
        """启动时检查数据库连接"""
        try:
            self._driver.verify_connectivity()
            logger.info(f"Successfully connected to Neo4j Server at {self._uri}")
        except Exception as e:
            logger.error(f"Failed to connect to Neo4j: {e}")
            raise

    def ensure_database_created(self, db_name: str):
        """
        连接到 system 库，检查并创建目标数据库。
        """
        if db_name.lower() == "system":
            return

        # 简单的名称安全检查，防止 Cypher 注入
        if not re.match(r"^[a-zA-Z0-9\-]+$", db_name):
            raise ValueError(f"Invalid database name '{db_name}'. Only alphanumeric and underscores allowed.")

        # 必须连接到 'system' 库才能执行管理命令
        # 注意：DDL 语句建议使用 session.run (Auto-commit)，而不是 execute_write
        with self._driver.session(database="system") as session:
            try:
                # 1. 检查是否存在
                result = session.run("SHOW DATABASES YIELD name WHERE name = $name", name=db_name).single()
                
                if result:
                    logger.info(f"Database '{db_name}' already exists.")
                    return

                # 2. 如果不存在，尝试创建
                logger.info(f"Database '{db_name}' not found. Creating...")
                
                # 使用 WAIT 确保数据库创建完成并 Online 后再返回
                session.run(f"CREATE DATABASE `{db_name}` IF NOT EXISTS WAIT")
                logger.info(f"Database '{db_name}' created successfully.")

            except Exception as e:
                error_msg = str(e).lower()
                if "unsupported administration command" in error_msg or "community edition" in error_msg:
                    if db_name == "neo4j":
                        return # 默认库在社区版是存在的，忽略错误
                    logger.warning(
                        f"Failed to create database '{db_name}'. "
                        f"Neo4j Community Edition only supports 'neo4j' and 'system'. "
                        f"Using default behavior (might fail if db doesn't exist)."
                    )
                else:
                    logger.error(f"Failed to create database '{db_name}': {e}")
                    raise

    def close(self):
        if self._driver:
            self._driver.close()

    @contextmanager
    def session(self, db_name: str = "") -> Generator[Session, None, None]:
        """Session 上下文管理器"""
        # 优先使用传入的 db_name，否则使用实例默认
        target_db = db_name if db_name else self._database
        
        session = self._driver.session(database=target_db)
        try:
            yield session
        except Exception as e:
            logger.error(f"Session transaction failed: {e}") # 这一层通常由调用方处理异常日志
            raise
        finally:
            session.close()

    def execute_read(self, query: str, params: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """执行只读事务"""
        with self.session() as session:
            # 显式使用 list 立即求值，防止 Transaction 关闭后 Cursor 失效
            result = session.execute_read(lambda tx: list(tx.run(query, params or {})))
            return result

    def execute_write(self, query: str, params: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """执行写事务"""
        with self.session() as session:
            result = session.execute_write(lambda tx: list(tx.run(query, params or {})))
            return result