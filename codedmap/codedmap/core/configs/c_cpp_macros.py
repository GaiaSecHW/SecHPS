import re
import os
from typing import List, Optional, Literal, Dict, Union, Any, Pattern, Set

class MacroRegistry:
    """
    [Configuration] C/C++ 宏语义注册表。
    定义哪些"看起来像函数调用"的宏，实际上是控制结构(LOOP/IF)。
    """
    
    # L1: 内置知名宏 (Linux Kernel, Glib, OpenSSL, etc.)
    _KNOWN_LOOPS: Set[str] = {
        # Linux Kernel
        "list_for_each", "list_for_each_entry", "list_for_each_safe",
        "hlist_for_each", "hlist_for_each_entry",
        "rbtree_postorder_for_each_entry_safe",
        "for_each_cpu", "for_each_process",
        # BSD / General
        "TAILQ_FOREACH", "LIST_FOREACH", "SLIST_FOREACH", "RB_FOREACH",
        # OP-TEE specifically (Based on your case)
        "optee_cq_for_each_waiter" 
    }

    # L2: 启发式正则模式 (Convention)
    # 只要名字里带这些特征，99% 是循环
    _HEURISTIC_PATTERNS: List[Pattern] = [
        re.compile(r".*_for_each.*", re.IGNORECASE),
        re.compile(r".*_foreach.*", re.IGNORECASE),
        re.compile(r".*_iter_.*", re.IGNORECASE),
        re.compile(r".*_walk_.*", re.IGNORECASE)
    ]

    # 用户自定义 / AI 学习到的宏 (Runtime Dynamic)
    _DYNAMIC_LOOPS: Set[str] = set()

    @classmethod
    def is_loop(cls, name: str) -> bool:
        if not name: return False
        
        # 1. O(1) 查表
        if name in cls._KNOWN_LOOPS or name in cls._DYNAMIC_LOOPS:
            return True
        
        # 2. O(M) 正则匹配
        for pattern in cls._HEURISTIC_PATTERNS:
            if pattern.match(name):
                return True
                
        return False

    @classmethod
    def register_loop(cls, name: str):
        """用于 AI Pass 回写或从配置文件加载"""
        cls._DYNAMIC_LOOPS.add(name)

