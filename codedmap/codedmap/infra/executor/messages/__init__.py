# codedmap/infra/executor/messages — IPC message types
#
# Pickle-safe dataclasses for cross-process communication:
# BaseTask, TaskResult, AnalysisTask, AIAnalysisResult, BatchAnalysisResult, ParserTask

from .base import BaseTask, TaskResult
from .analysis import AnalysisTask, AIAnalysisResult, BatchAnalysisResult, EdgeTuple, UpdateTuple
from .parser import ParserTask

__all__ = [
    "BaseTask", "TaskResult",
    "AnalysisTask", "AIAnalysisResult", "BatchAnalysisResult",
    "EdgeTuple", "UpdateTuple",
    "ParserTask",
]
