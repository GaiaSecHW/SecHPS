import logging
import multiprocessing
import os
import shutil
import sys
from pathlib import Path

# 确保项目根目录在 path 中
sys.path.append(os.getcwd())

logging.getLogger('instructor').disabled = False
logging.getLogger('openai._base_client').disabled = True
logging.getLogger('httpcore.http11').disabled = True
logging.getLogger('codedmap.analysis.passes.base_batch').disabled = False

# 引入核心组件
from codedmap.core.configs.cpg_config import CPGConfig
from codedmap.pipeline.orchestrator import PipelineOrchestrator
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
        project_root=r'/Users/kibox/github_repo/sqlite-master/',
        storage={
            "backend": "sqlite",
            "use_bulk_import": True,
            "work_dir": "/Users/kibox/ai_workspace/test_data/work_dir",
            "csv_output_dir": "/Users/kibox/ai_workspace/test_data/sqlite_csv",
            "uri": "sqlite:///Users/kibox/ai_workspace/test_data/",
            "database": "simple-test"
        },
        ai={
            "enable_llm": False,
            "model_name": "glm-4.6v-flash",
            "enable_smart_dispatcher": False,
            "max_workers": 1,  # [New] 控制 AI Pass 的并发数
            "runner_type": "thread"  # [New] 选择并发模型 (thread/process/sequential)
        },
        parser={
            "languages": ["c"],
            "import_path": "/Users/kibox/ai_workspace/test_data/sqlite3_ast",
            "skip_uncompiled": True,
            "n_workers": 8,  # Frontend 解析进程数
        }
    )

    # 2. 初始化编排器
    orchestrator = PipelineOrchestrator(config=config)

    try:

        # [Change 3] 执行完整流水线
        # 这会自动按顺序执行:
        # 1. Frontend Ingestion (原 builder.build)
        # 2. Global Analysis (原 builder.run_passes)
        logger.info("=== Starting Full Pipeline ===")
        orchestrator.run_full_pipeline(force_rerun=True, skip_ingestion=False)

        # 3. 验证结果
        # Store 现在归 Orchestrator 管理
        store = orchestrator.store
        #methods = store.query.methods().to_list()
        #logger.info(f"✅ Pipeline Finished. Built CPG with {len(methods)} methods")

        # 可选：简单的后续查询验证
        #if len(methods) > 0:
        #    sample = methods[0]
        #    logger.info(f"Sample Method: {sample.full_name}")

    except Exception as e:
        logger.error(f"Pipeline failed: {e}", exc_info=True)

    finally:
        # [Change 4] 确保资源释放 (关闭连接池、线程池)
        orchestrator.shutdown()
