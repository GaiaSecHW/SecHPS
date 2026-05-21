# codedmap/infra/executor/runner.py

import logging
import multiprocessing
from abc import ABC, abstractmethod
from typing import Iterable, Iterator, Callable, Any, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

from codedmap.infra.executor.messages.base import BaseTask, TaskResult

logger = logging.getLogger(__name__)


class BaseRunner(ABC):
    """
    [Execution Strategy] 执行器基类。
    """

    def __init__(self, max_workers: int = 4):
        self.max_workers = max_workers

    @abstractmethod
    def execute(self,
                tasks: Iterable[BaseTask],
                handler_func: Callable[[BaseTask], TaskResult],
                initializer: Optional[Callable] = None,
                initargs: Tuple = (),
                chunksize: int = 1) -> Iterator[TaskResult]:
        """
        执行一批任务，并以迭代器形式返回结果。

        Args:
            tasks: 任务生成器
            handler_func: 处理函数
            initializer: [New] Worker 初始化函数 (用于建立 DB 连接等)
            initargs: [New] 初始化参数元组
            chunksize: 任务分块大小。对 ProcessPool 生效，其他 Runner 可忽略。
        """
        pass


# --- 实现 1: 串行执行 (调试/单步跟踪用) ---
class SequentialRunner(BaseRunner):
    """调试用：单线程串行"""

    def execute(self, tasks, handler_func, initializer=None, initargs=(), chunksize: int = 1):
        logger.info("Executing tasks sequentially (Debug Mode)...")

        # [Fix] 模拟 Worker 初始化
        # 如果不执行这一步，handler_func 运行时 _worker_store 将为 None
        if initializer:
            logger.debug("Initializing sequential environment...")
            try:
                initializer(*initargs)
            except Exception as e:
                logger.error(f"Sequential initialization failed: {e}")
                return  # 初始化失败直接退出

        for task in tasks:
            try:
                yield handler_func(task)
            except Exception as e:
                logger.error(f"Task {getattr(task, 'task_id', 'unknown')} failed: {e}")
                yield TaskResult(task.task_id if hasattr(task, 'task_id') else "unknown", "FAILED", error=str(e))


# --- 实现 2: 多线程执行 (IO 密集型 - AI/DB 请求) ---
class ThreadPoolRunner(BaseRunner):
    """
    IO 密集型 Runner。
    注意：Python ThreadPoolExecutor 原生支持 initializer。
    """

    def execute(self, tasks, handler_func, initializer=None, initargs=(), chunksize: int = 1):
        # [Fix] 将 initializer 传递给 ThreadPoolExecutor
        # 这样每个线程启动时也会调用初始化函数 (尽管在线程模式下全局变量是共享的，
        # 但这样能保证行为与 ProcessPool 一致，比如确保 import 或某些 setup 被执行)
        with ThreadPoolExecutor(max_workers=self.max_workers,
                                initializer=initializer,
                                initargs=initargs) as executor:

            future_to_task = {executor.submit(handler_func, t): t for t in tasks}

            for future in as_completed(future_to_task):
                task = future_to_task[future]
                try:
                    yield future.result()
                except Exception as e:
                    logger.error(f"Thread task failed: {e}")
                    task_id = getattr(task, 'task_id', 'unknown')
                    yield TaskResult(task_id, "FAILED", error=str(e))


# --- 实现 3: 多进程执行 (CPU 密集型 - 静态分析/切片) ---
class ProcessPoolRunner(BaseRunner):
    """
    [Architecture Upgrade] CPU 密集型 Runner。
    """

    def __init__(self, max_workers: int = 4, maxtasks_per_child: int = 20):
        super().__init__(max_workers)
        self.maxtasks_per_child = maxtasks_per_child

    def execute(self, tasks, handler_func, initializer=None, initargs=(), chunksize: int = 1):
        print(f"[Runner-Exec] Creating Pool with maxtasksperchild={self.maxtasks_per_child}", flush=True)
        pool = multiprocessing.Pool(
            processes=self.max_workers,
            maxtasksperchild=self.maxtasks_per_child,
            initializer=initializer,
            initargs=initargs
        )

        try:
            result_iter = pool.imap_unordered(handler_func, tasks, chunksize=chunksize)

            for result in result_iter:
                yield result

        except Exception as e:
            logger.error(f"ProcessPool crashed: {e}")
            pool.terminate()
            raise
        finally:
            pool.close()
            pool.join()