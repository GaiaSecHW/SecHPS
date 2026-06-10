from enum import Enum
import os
import logging
from typing import Any, Dict, Union
from jinja2 import Environment, FileSystemLoader, TemplateNotFound, select_autoescape

logger = logging.getLogger(__name__)

class PromptManager:
    """
    [Singleton] Prompt 模板加载与渲染管理器。
    """
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(PromptManager, cls).__new__(cls)
            cls._instance._init_env()
        return cls._instance

    def _init_env(self):
        # 获取 templates 目录的绝对路径
        current_dir = os.path.dirname(os.path.abspath(__file__))
        self.templates_dir = os.path.join(current_dir, "templates")
        
        # [Debug Info] 打印路径信息，帮助排查
        if not os.path.exists(self.templates_dir):
            logger.critical(f"❌ Prompt templates directory NOT FOUND at: {self.templates_dir}")
        else:
            # 列出目录下的文件，确认 .j2 文件存在
            files = os.listdir(self.templates_dir)
            logger.info(f"✅ PromptManager initialized. Loading templates from: {self.templates_dir}")
            logger.debug(f"   Found templates: {files}")

        # 初始化 Jinja2 环境
        self.env = Environment(
            loader=FileSystemLoader(self.templates_dir),
            autoescape=select_autoescape(['html', 'xml']),
            trim_blocks=True,
            lstrip_blocks=True
        )

    def render(self, template_name: Union[str, Enum], **kwargs: Any) -> str:
        """
        渲染 Prompt 模板。
        
        Args:
            template_name: 模板文件名或 Enum
            **kwargs: 注入模板的变量
        """
        # [Fix] 显式处理 Enum，确保获取的是文件名 (.value)
        if isinstance(template_name, Enum):
            filename = template_name.value
        else:
            filename = str(template_name)

        try:
            template = self.env.get_template(filename)
            return template.render(**kwargs)
        except TemplateNotFound:
            logger.error(f"❌ Prompt template not found: '{filename}' in {self.templates_dir}")
            return ""
        except Exception as e:
            logger.error(f"❌ Error rendering prompt '{filename}': {e}")
            return ""

# 全局单例实例
prompt_manager = PromptManager()