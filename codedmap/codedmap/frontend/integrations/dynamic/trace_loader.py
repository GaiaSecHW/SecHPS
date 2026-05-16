import logging
import json
import os
from typing import Dict, List, Any, Optional

from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType

# 导入架构基类
from codedmap.integrations.base import BaseIntegration
from codedmap.utils.code_location_resolver import CodeLocationResolver

# 导入 Trace 相关的 Schema 定义
# (假设之前定义的 TraceSessionNode, TraceEventNode 等在 schema/overlays/trace.py 中)
from codedmap.core.schema.overlays.trace import (
    TraceSessionNode, 
    TraceEventNode, 
    RuntimeValueNode,
    EDGE_EXECUTED_IN, 
    EDGE_NEXT_EVENT, 
    EDGE_MAPPED_TO, 
    EDGE_HAS_VALUE
)

logger = logging.getLogger(__name__)

class DynamicTraceIntegration(BaseIntegration):
    """
    [Integration] 动态执行轨迹加载器。
    
    职责：
    1. 解析标准 JSON 格式的 Trace 日志 (GDB/Frida/QEMU 输出)。
    2. 构建时序链 (Session -> Event -> Value)。
    3. 映射回静态 CPG (Event -> Method/Call)。
    4. 支持缺失静态节点的自动锚点创建 (Lazy Anchoring)。
    """
    
    def __init__(self):
        # 注册插件名称
        super().__init__("DynamicTrace")

    def run(self, 
            store: CPGStore, 
            trace_file_path: str, 
            create_anchors: bool = False, 
            **kwargs) -> CPGGraph:
        """
        执行集成逻辑。
        
        Args:
            store: CPG 存储接口。
            trace_file_path: trace.json 文件路径。
            create_anchors: 如果静态节点(文件/方法)不存在，是否自动创建占位符节点。
                            (适用于无源码分析或部分构建场景)。
        
        Returns:
            CPGGraph: 包含动态数据的增量图。
        """
        logger.info(f"[{self.name}] Loading trace from: {trace_file_path}")
        
        # 1. 初始化
        delta = CPGGraph()
        resolver = CodeLocationResolver(store)
        
        # 清空基类的 ID 缓存，防止跨任务 ID 冲突
        self._anchor_cache.clear()

        # 2. 读取并验证 JSON
        if not os.path.exists(trace_file_path):
            logger.error(f"Trace file not found: {trace_file_path}")
            return delta

        try:
            with open(trace_file_path, 'r', encoding='utf-8') as f:
                trace_data = json.load(f)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid trace JSON format: {e}")
            return delta
        except Exception as e:
            logger.error(f"Failed to read trace file: {e}")
            return delta

        # 3. 创建 Session 节点 (Trace 的根节点)
        session = TraceSessionNode(
            session_id=trace_data.get("session_id", "unknown_session"),
            tool=trace_data.get("tool", "GenericTraceTool"),
            start_time=trace_data.get("timestamp", ""),
            command_line=trace_data.get("cmd", "")
        )
        delta.add_node(session)
        
        # 获取事件列表并按 Seq 排序 (防止日志乱序)
        events_data = trace_data.get("events", [])
        if not events_data:
            logger.warning("Trace file contains no events.")
            return delta

        events_data.sort(key=lambda x: x.get("seq", 0))

        # 用于构建链表的指针
        previous_event_node = None
        processed_count = 0

        # 4. 遍历处理事件
        for evt in events_data:
            # --- A. 创建 Event 节点 ---
            event_node = TraceEventNode(
                seq_id=evt.get("seq", 0),
                file_path=evt.get("file", ""),
                line_number=evt.get("line", 0),
                function_name=evt.get("func"),
                thread_id=evt.get("thread", 0),
                pc_address=evt.get("pc")
            )
            delta.add_node(event_node)
            processed_count += 1
            
            # --- B. 关联 Session (Event -> Session) ---
            delta.add_edge(event_node.id, session.id, type=EDGE_EXECUTED_IN)
            
            # --- C. 构建时序链 (Time Travel: Prev -> Curr) ---
            if previous_event_node:
                delta.add_edge(previous_event_node.id, event_node.id, type=EDGE_NEXT_EVENT)
            previous_event_node = event_node
            
            # --- D. 映射回静态 CPG (Event -> Static Node) ---
            # 只有当 Event 包含源码位置信息时才尝试映射
            if event_node.file_path and event_node.line_number > 0:
                
                # 尝试 1: 在数据库中查找存在的静态节点
                static_candidates = resolver.resolve_location(
                    event_node.file_path, 
                    event_node.line_number
                )
                
                if static_candidates:
                    # 找到了静态节点，建立连接
                    # 过滤策略：优先连接 Method, Call, ControlStructure，忽略细粒度的 Identifier
                    mapped_any = False
                    for static_node in static_candidates:
                        if static_node.label in [NodeLabel.METHOD, NodeLabel.CALL, NodeLabel.CONTROL_STRUCTURE]:
                            delta.add_edge(event_node.id, static_node.id, type=EDGE_MAPPED_TO)
                            mapped_any = True
                    
                    # 兜底：如果那一行没有特定结构节点，连接到第一个找到的节点 (防止孤立)
                    if not mapped_any and static_candidates:
                        delta.add_edge(event_node.id, static_candidates[0].id, type=EDGE_MAPPED_TO)
                
                # 尝试 2: 如果静态节点不存在，且允许创建锚点 (Lazy Anchor)
                elif create_anchors:
                    # 调用 BaseIntegration 的能力，创建文件锚点
                    # 这样 Trace 至少能挂载到文件名下，不至于完全游离
                    file_anchor = self.get_or_create_file_anchor(delta, event_node.file_path)
                    delta.add_edge(event_node.id, file_anchor.id, type=EDGE_MAPPED_TO)
                    
                    # (可选) 如果 Event 中有函数名，也可以尝试创建 Method 锚点
                    if event_node.function_name:
                         method_anchor = self.get_or_create_method_anchor(
                             delta, 
                             event_node.function_name, 
                             event_node.file_path
                         )
                         delta.add_edge(event_node.id, method_anchor.id, type=EDGE_MAPPED_TO)

            # --- E. 挂载运行时变量 (Event -> RuntimeValue) ---
            values = evt.get("values", [])
            for val in values:
                val_node = RuntimeValueNode(
                    var_name=val.get("name", "unknown"),
                    var_type=val.get("type", "unknown"),
                    # 确保 value 转换为字符串存储
                    value_content=str(val.get("value", "")),
                    memory_address=str(val.get("addr", "")) if val.get("addr") else None
                )
                delta.add_node(val_node)
                
                # 建立边: Event --[HAS_VALUE]--> Value
                delta.add_edge(event_node.id, val_node.id, type=EDGE_HAS_VALUE)

        logger.info(f"[{self.name}] Trace loaded successfully. "
                    f"Session: {session.session_id}, Events: {processed_count}")
        
        return delta