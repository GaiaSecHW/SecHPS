# codedmap/app/taint/core/scheduler.py

import logging
import concurrent.futures
from typing import List, Tuple
from itertools import islice


from .engine import TaintEngine
from codedmap.app.taint.models.flow import TaintFlow
from codedmap.app.taint.rules.config import TaintConfiguration

from codedmap.core.schema.graph.nodes import CPGNode
from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.store import CPGStore

logger = logging.getLogger(__name__)

def _worker_task(config_dict: dict, source_ids: List[int], run_config: TaintConfiguration) -> List[TaintFlow]:
    """
    [Worker Process] 独立的子进程任务。
    注意：这里不能直接传 CPGStore 对象，因为它包含 socket/lock，不可序列化。
    我们需要在子进程重新连接 DB。
    config_dict is StorageConfig.model_dump() — not a full CPGConfig dict.
    """
    # 1. 重新连接存储
    storage_config = StorageConfig(**config_dict)

    # Memory 模式警告
    if storage_config.backend.lower() != "neo4j":
        logger.warning("Parallel scanning on MemoryBackend is inefficient.")

    store = CPGStore(storage_config)
    engine = TaintEngine(store)

    # 2. 恢复 Source 节点
    sources = []
    # [Refactor] 批量加载 ID 对应的节点对象
    # 如果 source_ids 很大，这里可以分批，但 worker 通常只拿到了 batch_size (100)
    subgraph = store.get_subgraph(source_ids)
    for nid in source_ids:
        node = subgraph.get_node_by_id(nid)
        if node: sources.append(node)

    worker_config = TaintConfiguration(
        sources=sources,
        sinks=run_config.sinks,
        sanitizers=run_config.sanitizers
    )

    # 3. 执行
    try:
        flows = engine.scan(worker_config)
    finally:
        # [Refactor] 确保 store 关闭 (如果是 Neo4j Driver 需要 close 释放连接池)
        if hasattr(store, "close"):
            store.close()
        # 或者 store._reader.client.close()

    return flows

class ParallelTaintScanner:
    """
    [Scheduler] 并行污点扫描调度器。
    """
    def __init__(self, storage_config: StorageConfig, workers: int = 4, batch_size: int = 100):
        self.config_dict = storage_config.model_dump()  # 序列化 StorageConfig 以便传递给子进程
        self.workers = workers
        self.batch_size = batch_size

    def scan(self, taint_config: TaintConfiguration) -> List[TaintFlow]:
        all_flows = []

        # 1. 获取 Source IDs
        # 这一步会触发 Traversal 执行，对于千万级 Source，建议直接在这里用 count() 预估
        # 如果是 Traversal，to_list() 可能会 OOM，建议分页获取 ID。
        # 既然是 Scheduler，我们假设上层传入的是已经筛选好的比较精确的 Source 集合。
        logger.info("Collecting source IDs...")
        source_ids = [node.id for node in taint_config.sources_iter]

        if not source_ids:
            return []

        logger.info(f"Distributing {len(source_ids)} sources...")

        # 2. 切分
        batches = [
            source_ids[i : i + self.batch_size]
            for i in range(0, len(source_ids), self.batch_size)
        ]

        # 3. 执行
        # 注意：run_config (TaintConfiguration) 中包含了 sinks/sanitizers。
        # 如果 criteria 是 Callable (函数)，pickle 可能会失败（如果是 lambda 或 局部函数）。
        # 必须确保 Criteria 是顶层函数或可序列化对象。
        with concurrent.futures.ProcessPoolExecutor(max_workers=self.workers) as executor:
            futures = {
                executor.submit(_worker_task, self.config_dict, batch, taint_config): batch
                for batch in batches
            }

            for future in concurrent.futures.as_completed(futures):
                try:
                    flows = future.result()
                    all_flows.extend(flows)
                except Exception as e:
                    logger.error(f"Worker failed: {e}", exc_info=True)

        return all_flows
