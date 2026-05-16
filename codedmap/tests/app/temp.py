import os
import sys

# 确保项目根目录在 path 中
sys.path.append(os.getcwd())

from pathlib import Path
from codedmap.infra.storage.driver_neo4j.bulk.command import ImportScriptGenerator

# 指向你的 neo4j_import 目录
csv_dir = Path(r"/mnt/d/Programs/Neo4j/data/Application/Data/dbmss/dbms-c134e98d-775a-419d-b195-462409d5c372/import")
ImportScriptGenerator.generate(csv_dir, "simple-qemu")