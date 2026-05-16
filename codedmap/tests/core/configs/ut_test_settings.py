import unittest
import os
import yaml
import tempfile
from pathlib import Path
from pydantic import ValidationError, SecretStr
from unittest.mock import patch

import sys
import os
# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

# 导入你的配置类
from codedmap.core.configs.cpg_config import CPGConfig
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.configs.parser import ParserConfig
from codedmap.core.configs.ai import AIConfig

class TestCPGConfig(unittest.TestCase):

    def setUp(self):
        # 基础测试路径
        self.dummy_root = Path("/tmp/test_project")

    # ==========================================
    # 1. 测试默认值 (Defaults)
    # ==========================================
    def test_default_values(self):
        """测试不传任何参数（除了必须的 project_root）时的默认值"""
        config = CPGConfig(project_root=self.dummy_root)
        
        # 验证 Storage 默认值
        self.assertEqual(config.storage.backend, "memory")
        self.assertEqual(config.storage.batch_size, 5000)
        self.assertIsNone(config.storage.password)
        
        # 验证 Parser 默认值
        self.assertIn("c", config.parser.languages)
        self.assertTrue(config.parser.n_workers >= 1) # 至少有1个worker
        
        # 验证 AI 默认值
        self.assertFalse(config.ai.enable_llm) # 默认应该关闭，防止烧钱
        self.assertEqual(config.ai.model_name, "gpt-4o")

    # ==========================================
    # 2. 测试 YAML 加载 (YAML Loading)
    # ==========================================
    def test_load_from_yaml_full(self):
        """测试从完整的 YAML 文件加载配置"""
        yaml_content = {
            "project_root": "/custom/root",
            "storage": {
                "backend": "neo4j",
                "uri": "bolt://1.2.3.4:7687",
                "batch_size": 100
            },
            "ai": {
                "enable_llm": True,
                "model_name": "gpt-3.5-turbo"
            }
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as tmp:
            yaml.dump(yaml_content, tmp)
            tmp_path = tmp.name
            
        try:
            config = CPGConfig.load_from_yaml(tmp_path)
            
            # 验证值被覆盖
            self.assertEqual(str(config.project_root), "/custom/root")
            self.assertEqual(config.storage.backend, "neo4j")
            self.assertEqual(config.storage.uri, "bolt://1.2.3.4:7687")
            self.assertEqual(config.storage.batch_size, 100)
            self.assertTrue(config.ai.enable_llm)
            self.assertEqual(config.ai.model_name, "gpt-3.5-turbo")
        finally:
            os.remove(tmp_path)

    def test_load_from_yaml_override_root(self):
        """测试 load_from_yaml 时的 project_root_override 参数"""
        # YAML 中不包含 project_root，或者包含但我们要覆盖它
        yaml_content = {
            "storage": {"backend": "csv"}
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as tmp:
            yaml.dump(yaml_content, tmp)
            tmp_path = tmp.name
            
        try:
            # Case 1: YAML 缺 project_root，必须由 override 提供
            config = CPGConfig.load_from_yaml(tmp_path, project_root_override="/override/path")
            self.assertEqual(str(config.project_root), "/override/path")
            self.assertEqual(config.storage.backend, "csv")
            
        finally:
            os.remove(tmp_path)

    def test_load_missing_file(self):
        """测试加载不存在的文件应该抛出异常"""
        with self.assertRaises(FileNotFoundError):
            CPGConfig.load_from_yaml("non_existent_config.yaml")

    # ==========================================
    # 3. 测试敏感信息与环境变量 (Secrets & Env)
    # ==========================================
    def test_secrets_handling(self):
        """测试 SecretStr 的行为"""
        config = CPGConfig(
            project_root=self.dummy_root,
            storage={"password": "my_secret_password"}
        )
        
        # 直接打印 config 不应该显示明文密码
        self.assertNotEqual(str(config.storage.password), "my_secret_password")
        # 使用 get_secret_value() 应该能获取明文
        self.assertEqual(config.storage.password.get_secret_value(), "my_secret_password")

    def test_get_openai_api_key_priority(self):
        """
        测试 API Key 的获取优先级：
        Config显式配置 > 环境变量 > None
        """
        # Case 1: Config 中有配置，Env 中也有 (Config 优先)
        with patch.dict(os.environ, {"OPENAI_API_KEY": "env_key"}):
            config = CPGConfig(
                project_root=self.dummy_root,
                ai={"api_key": "config_key"}
            )
            self.assertEqual(config.get_openai_api_key(), "config_key")

        # Case 2: Config 中无，Env 中有 (Fallback 到 Env)
        with patch.dict(os.environ, {"OPENAI_API_KEY": "env_key"}):
            config = CPGConfig(project_root=self.dummy_root) # ai.api_key 默认为 None
            self.assertEqual(config.get_openai_api_key(), "env_key")
            
        # Case 3: 都没有
        with patch.dict(os.environ, {}, clear=True):
            config = CPGConfig(project_root=self.dummy_root)
            self.assertIsNone(config.get_openai_api_key())

    def test_get_neo4j_auth(self):
        """测试 Neo4j Auth 辅助方法"""
        # Case A: 有密码
        config = CPGConfig(
            project_root=self.dummy_root,
            storage={"username": "admin", "password": "123"}
        )
        self.assertEqual(config.get_neo4j_auth(), ("admin", "123"))
        
        # Case B: 无密码
        config_no_pass = CPGConfig(project_root=self.dummy_root)
        self.assertEqual(config_no_pass.get_neo4j_auth(), ("neo4j", ""))

    # ==========================================
    # 4. 测试数据验证 (Validation)
    # ==========================================
    def test_validation_backend_enum(self):
        """测试非法枚举值 (Pydantic 应拦截)"""
        with self.assertRaises(ValidationError) as cm:
            CPGConfig(
                project_root=self.dummy_root,
                storage={"backend": "mysql"} # 'mysql' 不是允许的 literal
            )
        self.assertIn("Input should be 'memory', 'neo4j' or 'csv'", str(cm.exception))

    def test_validation_types(self):
        """测试类型错误"""
        with self.assertRaises(ValidationError):
            CPGConfig(
                project_root=self.dummy_root,
                analysis={"max_call_depth": "not_a_number"}
            )

if __name__ == '__main__':
    unittest.main()