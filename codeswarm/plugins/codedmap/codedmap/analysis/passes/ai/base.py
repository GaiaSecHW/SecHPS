# codedmap/analysis/passes/ai/base.py

import logging
import hashlib
import json
from typing import List, Dict, Any, Optional, Iterable, TypeVar, Generic, Union, Iterator
from abc import abstractmethod

from codedmap.analysis.traversal import ContextLoader
from codedmap.core.schema.graph.nodes import CPGNode
from codedmap.core.schema.graph.patch import GraphPatch, PatchStrategy
from codedmap.core.configs.ai import AIConfig
from codedmap.core.configs.analysis import AnalysisConfig
from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.store import CPGStore

# 引入基类和 Runner
from codedmap.analysis.passes.base_batch import BaseBatchPass
from codedmap.infra.executor.runner import BaseRunner, ThreadPoolRunner
from codedmap.infra.executor.messages.analysis import AnalysisTask, TaskResult, AIAnalysisResult
from codedmap.infra.utils.disk_map import DiskMap
from pathlib import Path

logger = logging.getLogger(__name__)

# T: 待分析的节点类型 (e.g. MethodNode)
# R: AI 分析结果类型 (e.g. CodeTaggingResult dict or Pydantic model)
T = TypeVar("T", bound=CPGNode)
R = TypeVar("R")


class AIEnhancedPass(BaseBatchPass, Generic[T, R]):
    """
    [Architecture V3 - Industrial Grade] AI 增强 Pass 基类。

    特性：
    1. 适配 BaseBatchPass 接口，兼容 PassManager。
    2. 内置 ThreadPoolRunner，专用于 IO 密集型 LLM 请求。
    3. 集成 DiskMap 进行持久化缓存 (Prompt Hash -> Result)，支持断点续传。
    4. 批量 Patch 提交，优化大规模图写入性能。
    5. 全链路流式处理，内存占用恒定。
    """

    def __init__(self, store: CPGStore, runner: BaseRunner,
                 config: Optional[AnalysisConfig] = None,
                 storage_config: Optional[StorageConfig] = None,
                 ai_config: Optional[AIConfig] = None,
                 project_root: Optional[Path] = None,
                 **kwargs):
        """
        Args:
            store: 存储接口
            runner: BaseRunner (注意：这里接收的是 Manager 传递的 ProcessPoolRunner，
                    但在 AI Pass 中我们会忽略它，使用内部的 ThreadPoolRunner)
            config: 分析配置
            storage_config: 存储配置
            ai_config: AI 增强配置
            project_root: 项目根目录
        """
        super().__init__(store, runner, config=config, storage_config=storage_config,
                         project_root=project_root, **kwargs)
        self.ai_config = ai_config or AIConfig()

        # [Concurrency] 覆盖 Runner
        # AI 请求是 IO 密集型且通常不仅限于 CPU 核心数，因此使用 ThreadPoolRunner。
        ai_workers = self.ai_config.max_workers if self.ai_config else 8

        self.ai_runner = ThreadPoolRunner(max_workers=ai_workers)
        self.context_loader = ContextLoader(self.store)

        # [State Management] 持久化缓存 Map
        # Key: Prompt Hash (SHA256 Hex) -> Value: Result JSON
        self.cache_map: Optional[DiskMap] = None

        # 统计面板
        self.stats = {
            "scanned": 0,
            "filtered": 0,
            "cache_hits": 0,  # 命中缓存次数
            "llm_calls": 0,  # 实际调用 LLM 次数
            "success": 0,
            "failed": 0,
            "patches_applied": 0
        }

    # =========================================================================
    # Template Hooks (必须实现)
    # =========================================================================

    @abstractmethod
    def get_agent(self) -> Any:
        """获取 Agent 实例，用于 Worker 内部或本地调试"""
        pass

    @abstractmethod
    def find_candidates(self) -> Iterable[T]:
        """[Source] 查找候选节点，必须返回迭代器以节省内存"""
        pass

    @abstractmethod
    def generate_prompt_content(self, node: T) -> Optional[List[Dict[str, Any]]]:
        """
        [Prompting] 生成 OpenAI 格式的消息列表。
        e.g. [{"role": "system", ...}, {"role": "user", ...}]
        返回 None 表示跳过此节点。
        """
        pass

    @abstractmethod
    def create_patch(self, node: T, result: R) -> Optional[GraphPatch]:
        """
        [Patching] 根据分析结果生成图变更补丁。
        """
        pass

    @staticmethod
    @abstractmethod
    def execute_worker_task(task: AnalysisTask) -> AIAnalysisResult:
        """
        [Worker Function] 线程池中执行的静态函数。
        接收 Task，调用 LLM，返回 Result。
        注意：此处不能访问 self (实例属性)，必须依赖 task 中的数据。
        """
        pass

    # =========================================================================
    # Optional Hooks (可选覆盖)
    # =========================================================================

    def heuristic_filter(self, node: T) -> bool:
        """[Filter] 静态规则过滤（如：太短的函数不分析）。"""
        return True

    def get_agent_config(self) -> Dict[str, Any]:
        """传递给 Worker 用于初始化 Agent 的配置"""
        if self.ai_config:
            return {
                "model_name": self.ai_config.model_name,
                "api_base": self.ai_config.api_base,
                "api_key": self.ai_config.get_openai_api_key(),
            }
        return {}

    def serialize_result(self, result: R) -> str:
        """将结果序列化为 JSON 字符串以存入 DiskMap"""
        if hasattr(result, "model_dump_json"):  # Pydantic V2
            return result.model_dump_json()
        if hasattr(result, "json"):  # Pydantic V1
            return result.json()
        return json.dumps(result, ensure_ascii=False)

    def deserialize_result(self, data: str) -> R:
        """从 JSON 字符串反序列化结果，子类若 R 不是 dict 需重写"""
        return json.loads(data)

    # =========================================================================
    # Main Pipeline Logic
    # =========================================================================

    def run(self):
        """
        [Override] 完全重写执行逻辑，不使用 BaseBatchPass.run_parallel。
        实现 "Check Cache -> Yield Task -> Run -> Update Cache -> Patch" 循环。
        """
        logger.info(f"[{self.name}] Starting AI Analysis (Industrial Mode). Workers: {self.ai_runner.max_workers}")

        # 1. 初始化持久化缓存 (使用 BaseBatchPass 的逻辑管理 DiskMap 生命周期)
        # 我们使用一个特定的 table name 用于缓存
        cache_path = self.work_dir / f"{self.name}_cache.db"
        self.cache_map = DiskMap(
            table_name="llm_cache",
            key_type="TEXT",
            value_type="TEXT",  # 存储 JSON
            existing_db_path=str(cache_path)
        )
        self.cache_map.__enter__()

        try:
            agent_config = self.get_agent_config()
            batch_size = 50  # Patch 批处理大小
            patch_buffer: List[GraphPatch] = []

            # --- 内部生成器：处理缓存命中逻辑 ---
            # 这个生成器会做两件事：
            # 1. 如果缓存命中：直接生成 Patch 并添加到 buffer (副作用)，yield None
            # 2. 如果缓存未命中：yield AnalysisTask 给线程池

            def task_producer() -> Iterator[AnalysisTask]:
                candidates = self.find_candidates()
                for node in candidates:
                    self.stats["scanned"] += 1

                    if not self.heuristic_filter(node):
                        self.stats["filtered"] += 1
                        continue

                    # 生成 Prompt
                    prompt_inputs = self.generate_prompt_content(node)
                    if not prompt_inputs:
                        continue

                    # 计算指纹 (Content Hash)
                    # 将 prompt 内容序列化后计算 hash，确保 prompt 变了会重新跑
                    prompt_str = json.dumps(prompt_inputs, sort_keys=True)
                    content_hash = hashlib.sha256(prompt_str.encode('utf-8')).hexdigest()

                    # Check DiskMap Cache
                    cached_json = self.cache_map.get(content_hash)

                    if cached_json:
                        self.stats["cache_hits"] += 1
                        try:
                            # 缓存命中：直接反序列化并生成 Patch
                            result_obj = self.deserialize_result(cached_json)
                            patch = self.create_patch(node, result_obj)
                            if patch and not patch.is_empty:
                                patch_buffer.append(patch)
                                if len(patch_buffer) >= batch_size:
                                    self._flush_buffer(patch_buffer)
                        except Exception as e:
                            logger.warning(f"[{self.name}] Cached result error node {node.id}: {e}")
                    else:
                        # 缓存未命中：生成任务
                        # 注意：这里我们不再需要复杂的 payload，只需要在 AnalysisTask 属性里传必要信息
                        yield AnalysisTask(
                            task_id=content_hash,
                            pass_name=self.name,
                            target_node_id=node.id,
                            target_label=str(node.label),  # 补充基类字段
                            prompt_inputs=prompt_inputs,
                            agent_config=agent_config,
                            # 依然可以在 payload 里带上 hash 方便 worker 直接回传，或者 worker 从 task_id 取
                            payload={"hash": content_hash}
                        )

            # 2. 执行流水线
            # self.ai_runner.execute 接受迭代器，并在内部使用 ThreadPool 处理
            # 注意：execute 返回的是 Future 的 result 迭代器

            worker_func = self.__class__.execute_worker_task
            results_iter = self.ai_runner.execute(task_producer(), worker_func)

            # 3. 处理 Runner 结果 (Cache Miss 的部分)
            for res in results_iter:
                # [Update] 类型检查与字段访问
                if res.status != "SUCCESS":
                    self.stats["failed"] += 1
                    logger.error(f"[{self.name}] Task {res.task_id} failed: {res.error}")
                    continue

                # 兼容性防御：确保是 AIAnalysisResult
                if not isinstance(res, AIAnalysisResult):
                    # 如果 Worker 返回了基类 TaskResult，尝试从 payload 恢复（但这不应该发生）
                    logger.warning(f"[{self.name}] Received generic TaskResult, expected AIAnalysisResult.")
                    result_data = res.payload
                    # 尝试从 task_id 或 payload 恢复 hash，这里简化处理，直接跳过或报错
                    continue

                self.stats["llm_calls"] += 1
                self.stats["success"] += 1

                # [Update] 直接访问强类型字段
                result_data = res.model_response
                content_hash = res.prompt_hash
                node_id = res.target_node_id

                if result_data is None or not content_hash or node_id is None:
                    logger.warning(f"[{self.name}] Invalid result structure. ID={node_id}, Hash={bool(content_hash)}")
                    continue

                # A. 写回缓存
                try:
                    serialized = self.serialize_result(result_data)
                    self.cache_map.set(content_hash, serialized)
                except Exception as e:
                    logger.error(f"[{self.name}] Cache write failed: {e}")

                # B. 生成 Patch
                node = self.store.get_node(node_id)
                if node:
                    try:
                        patch = self.create_patch(node, result_data)
                        if patch and not patch.is_empty:
                            patch_buffer.append(patch)
                    except Exception as e:
                        logger.error(f"[{self.name}] Patch creation failed: {e}")

                # C. Flush
                if len(patch_buffer) >= batch_size:
                    self._flush_buffer(patch_buffer)

                # Final Flush
            self._flush_buffer(patch_buffer)
            logger.info(f"[{self.name}] Analysis Finished. Stats: {self.stats}")

        except Exception as e:
            logger.error(f"[{self.name}] Fatal error: {e}", exc_info=True)
            raise
        finally:
            self.cleanup()

    def _flush_buffer(self, buffer: List[GraphPatch]):
        """Helper to flush patches and clear buffer"""
        if not buffer:
            return

        try:
            # 必须使用 merge_all 合并为一个大的原子操作，或者分批提交
            # 这里选择 merge_all 以保证尽可能少的 DB 事务
            count = len(buffer)
            merged_patch = GraphPatch.merge_all(buffer, strategy=PatchStrategy.OVERWRITE)
            merged_patch.created_by = self.name

            self.store.apply_patch(merged_patch)

            self.stats["patches_applied"] += count
            logger.info(f"[{self.name}] Applied batch of {count} patches. (Total: {self.stats['patches_applied']})")
        except Exception as e:
            logger.error(f"[{self.name}] Failed to flush patches: {e}")
        finally:
            buffer.clear()

    def cleanup(self):
        """
        [Lifecycle] 清理资源。
        必须调用 super().cleanup() 确保基类资源释放。
        同时关闭自己的 DiskMap。
        """
        if self.cache_map:
            try:
                self.cache_map.__exit__(None, None, None)
            except Exception as e:
                logger.warning(f"[{self.name}] Error closing cache map: {e}")
            self.cache_map = None

        super().cleanup()