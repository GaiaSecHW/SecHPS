import logging
from typing import Dict, Type
from codedmap.infra.storage.store import CPGStore
from codedmap.integrations.base import BaseIntegration

# 确保 Schema 定义被加载 (Auto-registration)
import codedmap.core.schema.overlays 

logger = logging.getLogger(__name__)

class IntegrationManager:
    """
    [Plugin System] 集成管理器。
    负责管理和执行各种外部数据的摄入。
    """
    def __init__(self, store: CPGStore):
        self.store = store
        self._registry: Dict[str, BaseIntegration] = {}

    def register(self, integration: BaseIntegration):
        self._registry[integration.name] = integration

    def execute(self, name: str, **kwargs):
        """执行指定的集成任务"""
        plugin = self._registry.get(name)
        if not plugin:
            raise ValueError(f"Integration '{name}' not found.")
        
        logger.info(f"Running integration: {name}...")
        try:
            # 1. 运行插件逻辑，获取增量图
            delta_graph = plugin.run(self.store, **kwargs)
            
            # 2. 持久化
            if delta_graph and (delta_graph.nodes or delta_graph.edges):
                self.store.backend.merge(delta_graph)
                logger.info(f"Integration {name} completed. Data merged.")
            else:
                logger.warning(f"Integration {name} produced no data.")
                
        except Exception as e:
            logger.error(f"Integration {name} failed: {e}", exc_info=True)
            raise