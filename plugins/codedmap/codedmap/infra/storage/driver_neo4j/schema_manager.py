# codedmap/infra/storage/driver_neo4j/schema_manager.py

import logging
from typing import Optional
from codedmap.core.schema.graph.enums import NodeLabel, VectorIndexName
from codedmap.core.configs.ai import AIConfig

from .client import Neo4jClient

logger = logging.getLogger(__name__)



class SchemaManager:
    def __init__(self, client: Neo4jClient, ai_config: Optional[AIConfig] = None):
        self.client = client

        self.vector_dimensions = 1536
        if ai_config and hasattr(ai_config, 'embedding_dim'):
            self.vector_dimensions = ai_config.embedding_dim
            logger.info(f"SchemaManager configured with vector dimensions: {self.vector_dimensions}")
        else:
            logger.warning(f"Using default vector dimensions: {self.vector_dimensions}. Ensure this matches your Embedding Model!")

    def init_schema(self):
        """初始化所有的约束和索引"""
        logger.info("Initializing database schema...")

        # 1. 核心基石：通用节点约束 (Critical for Edge Performance)
        self._create_constraint(NodeLabel.BASE_LABEL.value, "id", unique=True)

        # 2. 具体类型约束 (加速具体类型的 MERGE)
        all_labels = [label for label in NodeLabel]

        if NodeLabel.VECTOR not in all_labels:
            all_labels.append(NodeLabel.VECTOR)
        
        for label in all_labels:
            # 兼容性处理：如果 label 是枚举，取 value
            val = label.value if hasattr(label, 'value') else label
            self._create_constraint(val, "id", unique=True)

        # 3. 业务索引 (加速常规属性查询)
        index_specs = [
            (NodeLabel.METHOD, "fullName"),
            (NodeLabel.METHOD, "name"),
            (NodeLabel.FILE, "name"),
            (NodeLabel.TYPE_DECL, "fullName"),
            (NodeLabel.CALL, "methodFullName"),
            (NodeLabel.IDENTIFIER, "name"),
            (NodeLabel.EMBEDDING_CHUNK, "chunk_index"),
            (NodeLabel.DIRECTORY, "path"),
            (NodeLabel.DIRECTORY, "name"),
            (NodeLabel.INSIGHT, "category"),
            (NodeLabel.INSIGHT, "source"),
            # [New] VectorNode 辅助索引
            (NodeLabel.VECTOR, "model_version")
        ]

        for label_enum, prop in index_specs:
            val = label_enum.value if hasattr(label_enum, 'value') else label_enum
            self._create_index(val, prop)

        # 4. 向量索引 (Vector Indices)
        global_index_name = VectorIndexName.GLOBAL.value
        
        self._create_vector_index(
            index_name=global_index_name,
            label=NodeLabel.VECTOR.value,
            property="embedding"
        )

        logger.info("Schema initialization complete.")

    def _create_constraint(self, label: str, property: str, unique: bool = True):
        constraint_name = f"constraint_{label.lower()}_{property}"
        type_str = "IS UNIQUE" if unique else "IS NOT NULL"
        query = f"""
        CREATE CONSTRAINT {constraint_name} IF NOT EXISTS
        FOR (n:{label}) REQUIRE n.{property} {type_str}
        """
        try:
            self.client.execute_write(query)
        except Exception as e:
            logger.debug(f"Constraint creation info for {label}: {e}")

    def _create_index(self, label: str, property: str):
        index_name = f"index_{label.lower()}_{property}"
        query = f"""
        CREATE INDEX {index_name} IF NOT EXISTS
        FOR (n:{label}) ON (n.{property})
        """
        try:
            self.client.execute_write(query)
        except Exception as e:
            logger.debug(f"Index creation info for {label}: {e}")

    def _create_vector_index(self, index_name: str, label: str, property: str):
        """
        [New] 创建向量索引 (Neo4j 5.x+ Syntax)
        """
        query = f"""
        CREATE VECTOR INDEX {index_name} IF NOT EXISTS
        FOR (n:{label}) ON (n.{property})
        OPTIONS {{
            indexConfig: {{
                `vector.dimensions`: {self.vector_dimensions},
                `vector.similarity_function`: 'cosine'
            }}
        }}
        """
        try:
            logger.info(f"Creating vector index: {index_name} on {label}({property}) with dim={self.vector_dimensions}...")
            self.client.execute_write(query)
        except Exception as e:
            logger.error(f"Failed to create vector index {index_name}: {e}")

    def drop_all(self):
        """
        危险：清空当前数据库（包含数据、约束和索引）
        """
        logger.warning("🔥 Dropping ALL data and schema in current database...")

        # 1. 删除数据的 Query (分批提交)
        delete_data_query = """
        MATCH (n)
        CALL {
            WITH n
            DETACH DELETE n
        } IN TRANSACTIONS OF 10000 ROWS
        """

        try:
            # 使用 session 模式（自动提交事务），适合 DDL 操作
            with self.client.session() as session:

                # --- Step 1: 清空数据 ---
                logger.info("Step 1: Deleting Nodes and Relationships...")
                session.run(delete_data_query)

                # --- Step 2: 清空约束 (Constraints) ---
                logger.info("Step 2: Dropping Constraints...")
                # 获取所有约束名称
                # SHOW CONSTRAINTS 是 Neo4j 4.x/5.x 的标准语法
                result = session.run("SHOW CONSTRAINTS YIELD name")
                constraints = [record["name"] for record in result]

                for name in constraints:
                    # 使用 IF EXISTS 防止竞态条件，使用反引号包裹名字防止特殊字符
                    session.run(f"DROP CONSTRAINT `{name}` IF EXISTS")

                if constraints:
                    logger.info(f"Dropped {len(constraints)} constraints.")

                # --- Step 3: 清空索引 (Indexes) ---
                logger.info("Step 3: Dropping Indexes...")
                # 获取所有索引名称，排除系统内部的 LOOKUP 索引
                result = session.run("SHOW INDEXES YIELD name, type WHERE type <> 'LOOKUP' RETURN name")
                indexes = [record["name"] for record in result]

                for name in indexes:
                    session.run(f"DROP INDEX `{name}` IF EXISTS")

                if indexes:
                    logger.info(f"Dropped {len(indexes)} indexes.")

            logger.info("✅ Database (Data + Schema) dropped successfully.")

        except Exception as e:
            logger.error(f"Drop all failed: {e}")
            # 根据需要决定是否抛出异常
            raise e