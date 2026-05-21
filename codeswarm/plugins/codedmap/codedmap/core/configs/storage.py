"""Storage backend configuration for CPG SDK."""
from pathlib import Path
from typing import Optional, Literal
from pydantic import BaseModel, Field, SecretStr


class StorageConfig(BaseModel):
    """存储后端配置"""

    model_config = {"populate_by_name": True}

    backend: Literal["memory", "neo4j", "sqlite"] = Field(
        default="memory",
        description="The runtime graph database engine. Use 'neo4j' for direct connection, 'memory' for testing, or 'sqlite' for local file-based storage."
    )

    uri: str = Field(
        default="bolt://localhost:7687",
        alias="sqlite_path",
        description="Connection URI. e.g., 'bolt://localhost:7687' for Neo4j, or '/path/to/graph.db' for Sqlite. Alias: sqlite_path."
    )

    username: str = Field(default="neo4j", description="Neo4j Username")
    password: Optional[SecretStr] = Field(default=None, description="Neo4j Password")

    database: str = Field(
        default="neo4j",
        description="Target Neo4j database name (used for connection or import script generation)"
    )

    batch_size: int = Field(default=5000, description="Batch size for bulk insertion")

    use_bulk_import: bool = Field(
        default=False,
        description=(
            "If True, enables the 'Intermediate Storage' pipeline:\n"
            "1. Overrides 'backend' to 'sqlite' automatically.\n"
            "2. Stores data in a local SQLite DB within workspace during analysis.\n"
            "3. Exports data to CSV for Neo4j Admin Import at the end."
        )
    )

    csv_output_dir: Optional[Path] = Field(
        default=None,
        description="Final destination for the exported CSV files (only used if use_bulk_import=True)."
    )

    def get_neo4j_auth(self):
        """Return (username, password) tuple for Neo4j authentication."""
        if self.password:
            return (self.username, self.password.get_secret_value())
        return (self.username, "")
