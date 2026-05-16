import logging
import multiprocessing
import os
import shutil
import sys
import time
from pathlib import Path


# 确保项目根目录在 path 中
sys.path.append(os.getcwd())


# 引入核心组件
from codedmap.core.configs.cpg_config import CPGConfig
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.storage.driver_neo4j.bulk.command import ImportScriptGenerator

from codedmap.app.query.slicer import GraphSlicer
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel

# 设置日志显示
# logging.getLogger('cpg.CParser').disabled = True
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

multiprocessing.set_start_method('spawn', force=True)

if __name__ == "__main__":

    # 1. 配置准备
    config = CPGConfig(
        project_root=r'/home/dbearzhu/test_data/qemu-7.2.22',
        storage={
            "backend": r"sqlite",
            "use_bulk_import": True,
            "work_dir": r"/home/dbearzhu/test_data/workspace",
            "csv_output_dir": "/home/dbearzhu/test_data/qemu_csv",
            "uri": r"sqlite:///home/dbearzhu/test_data/workspace/interim_graph2.db",
            "username": r"neo4j",
            "password": r"hello123456",
            "database": r"simple-qemu"
        }
    )

    try:

        store = CPGStore(config.storage)
        store.init_db()

        #methods = store.query.methods().to_list()
        #logger.info(f"✅  CPG with {len(methods)} methods")

        # 可选：简单的后续查询验证
        #if len(methods) > 0:
        #    sample = methods[0]
        #    logger.info(f"Sample Method: {sample.full_name}")

        csv_out_dir = Path(config.storage.csv_output_dir)
        store.snapshot(str(csv_out_dir))
        # 生成 Neo4j 导入脚本提示
        try:
            script_path = ImportScriptGenerator.generate(csv_out_dir, config.storage.database)
            logger.info(f"Import Script Generated: {script_path}")
        except ImportError:
            pass

        logger.info(f"✅ Data exported to: {csv_out_dir}")

    except Exception as e:
        logger.error(f"Pipeline failed: {e}", exc_info=True)

