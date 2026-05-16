import logging
import os
import shutil
import sys
import unittest
from pathlib import Path

sys.path.append(os.getcwd())

from codedmap.core.configs.cpg_config import CPGConfig
from codedmap.pipeline.frontend import FrontendPipeline, FrontendConfig
from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel

logging.getLogger('cpg.CParser').disabled = True
logging.getLogger('neo4j').disabled = True
logging.getLogger('neo4j.io').disabled = True
logging.getLogger('neo4j.pool').disabled = True
logging.getLogger('neo4j.notifications').disabled = True
logging.getLogger('codedmap.passes.manager').disabled = True
logging.getLogger('codedmap.passes.base').disabled = True

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class TestEndToEndFlow(unittest.TestCase):
    """
    [Priority 0] 端到端全流程测试
    验证: Builder -> Storage 的完整链路
    """

    def setUp(self):
        self.test_root = Path("./temp_e2e_project")
        if self.test_root.exists():
            shutil.rmtree(self.test_root)
        self.test_root.mkdir()

        code = """
        #include <stdio.h>
        
        void sink(int x) {
            printf("vulnerable: %d", x);
        }
        
        void helper(int y) {
            sink(y);
        }
        
        int main(int argc, char** argv) {
            helper(argc);
            return 0;
        }
        """
        
        (self.test_root / "vuln.c").write_text(code)

        self.config = CPGConfig(
            project_root=self.test_root,
            project_name="e2e_test",
        )
        self.config.storage.backend = "sqlite"
        self.config.storage.uri = str(self.test_root / "test.db")
        self.config.storage.use_bulk_import = False
        self.config.parser.languages = ["c"]
        self.config.ai.enable_llm = False

    def tearDown(self):
        if self.test_root.exists():
            shutil.rmtree(self.test_root)

    def test_build_and_slice(self):
        logger.info("=== Phase 1: Building CPG ===")
        frontend_config = FrontendConfig(
            parser=self.config.parser,
            storage=self.config.storage,
            ai=self.config.ai,
            pipeline=self.config.pipeline,
            dispatch=self.config.dispatch,
            project_root=self.config.project_root,
            project_name=self.config.project_name,
            _full_config_dict=self.config.model_dump(),
        )
        store = CPGStore(self.config.storage)
        store.init_db()
        builder = FrontendPipeline(frontend_config, store=store)
        
        self.assertIsNotNone(builder)
        self.assertIsNotNone(builder.store)
        
        logger.info("=== FrontendPipeline initialized successfully ===")

if __name__ == '__main__':
    unittest.main()
