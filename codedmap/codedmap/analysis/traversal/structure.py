# codedmap/analysis/traversal/structure.py

import logging
from typing import Dict, List, Union, Set, Literal, Tuple, Iterator
from pathlib import PurePosixPath

from codedmap.core.schema.graph.nodes import FileNode, TypeDeclNode, MethodNode
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType
from codedmap.infra.storage.store import CPGStore

from .base import BaseGraphNavigator, TraversalDirection

logger = logging.getLogger(__name__)

# 定义输出风格
TreeStyle = Literal["ascii", "markdown", "indent"]


class RepoStructureNavigator(BaseGraphNavigator):
    """
    [Project Level] 项目结构导航器。
    [Refactored v3.0] 适配 Lazy Storage，优化内存占用。
    """

    def __init__(self, store: CPGStore):
        super().__init__(store)
        # [Cache] 缓存文件依赖结果: {file_id: [deps]}
        self._deps_cache: Dict[int, List[str]] = {}

    def generate_repo_skeleton(self,
                               max_depth: int = 5,
                               ignore_dirs: List[str] = None,
                               style: TreeStyle = "ascii") -> str:
        """
        生成项目的树状结构字符串。
        """
        if ignore_dirs is None:
            ignore_dirs = [".git", "__pycache__", "node_modules", "dist", "build", "venv", ".idea", ".vscode"]

        # 优化: 转换为 set 加速查找
        ignore_set = set(ignore_dirs)

        # 1. 惰性获取所有 Source Files
        # query.files() 返回的是 Iterator，不会一次性加载所有文件到内存列表
        all_files_iter = self.store.query.files()

        # 2. 构建内存字典树 (File Tree)
        # 这里的 tree dict 依然可能较大，但在 Python 侧构建字典比持有 Pydantic 对象列表要省内存
        file_tree = {}

        # 流式处理
        for f in all_files_iter:
            raw_path = getattr(f, 'name', '') or getattr(f, 'fullName', '')
            if not raw_path or raw_path == "<unknown>": continue

            # 使用 PurePosixPath 处理跨平台路径分隔符
            path_obj = PurePosixPath(raw_path)
            parts = list(path_obj.parts)

            if path_obj.is_absolute():
                parts = parts[1:]  # 去掉根 /

            # 过滤掉 . 和 ..
            parts = [p for p in parts if p not in (".", "..")]

            # 过滤忽略目录 (Fast Check)
            if any(p in ignore_set for p in parts): continue

            self._insert_into_tree(file_tree, parts, f)

        # 3. 渲染 (DFS Traversal on the tree dict)
        lines = []
        self._render_tree(file_tree, lines, 0, max_depth, prefix="", style=style)
        return "\n".join(lines)

    # --- Dependency Analysis ---

    def get_module_dependencies(self, file_node: Union[FileNode, int]) -> List[str]:
        """
        获取指定文件依赖的其他文件列表 (带缓存).
        """
        file_id = self._ensure_node_id(file_node)

        # 1. [Cache Hit] 检查缓存
        if file_id in self._deps_cache:
            return self._deps_cache[file_id]

        # 2. [Cache Miss] 执行 DB 查询 (使用 DSL)
        # descendants(...) 找到所有 Call
        # out(CALL) 找到 Target Method
        # file() 找到 Target File
        target_files_iter = (self.store.query.by_id(file_id)
                             .descendants(edge_type=EdgeType.AST, max_depth=200, target_label=NodeLabel.CALL)
                             .out(EdgeType.CALL, target_class=MethodNode)
                             .file()
                             .distinct())  # 注意: 这里的 distinct 是 lazy 的

        dependencies = set()
        for target_file in target_files_iter:
            if target_file.id != file_id:
                path = getattr(target_file, 'name', None)
                if path and path != "<unknown>":
                    dependencies.add(path)

        result = sorted(list(dependencies))

        # 3. [Cache Write] 写入缓存
        self._deps_cache[file_id] = result
        return result

    # --- Internal Logic ---

    def _insert_into_tree(self, tree: Dict, parts: List[str], node: FileNode):
        current = tree
        for i, part in enumerate(parts):
            if i == len(parts) - 1:
                # Leaf node: store FileNode
                current[part] = node
            else:
                if part not in current:
                    current[part] = {}
                # 如果同一路径既是文件又是目录（极罕见），优先视为目录
                if isinstance(current[part], FileNode):
                    current[part] = {}
                current = current[part]

    def _render_tree(self, tree: Union[Dict, FileNode], lines: List[str],
                     depth: int, max_depth: int, prefix: str, style: TreeStyle):
        if depth > max_depth: return
        if not isinstance(tree, dict): return

        keys = sorted(tree.keys())
        for i, key in enumerate(keys):
            item = tree[key]
            is_last = (i == len(keys) - 1)

            connector, child_prefix_add = self._get_style_chars(style, is_last)

            current_line = f"{prefix}{connector}{key}"
            if isinstance(item, FileNode):
                # File Node
                lines.append(current_line)
                self._render_file_content(item, lines, prefix + child_prefix_add, style)
            else:
                # Directory
                lines.append(f"{current_line}/")
                self._render_tree(item, lines, depth + 1, max_depth, prefix + child_prefix_add, style)

    def _render_file_content(self, file_node: FileNode, lines: List[str], prefix: str, style: TreeStyle):
        """渲染文件内的 Class 和 Method"""
        # _get_neighbors 现在返回 Iterator，需要转 list 以便排序
        children_iter = self._get_neighbors(file_node, EdgeType.AST, TraversalDirection.OUT)
        children = list(children_iter)

        # 排序：按行号
        children.sort(key=lambda x: getattr(x, 'lineNumber', 0) or 0)

        valid = [c for c in children if c.label in [NodeLabel.TYPE_DECL, NodeLabel.METHOD]
                 and not getattr(c, 'name', '').startswith("<")]

        for i, child in enumerate(valid):
            is_last = (i == len(valid) - 1)
            connector, child_prefix_add = self._get_style_chars(style, is_last)

            name = getattr(child, 'name', 'unknown')
            if child.label == NodeLabel.TYPE_DECL:
                lines.append(f"{prefix}{connector}class {name}")
                self._render_type_content(child, lines, prefix + child_prefix_add, style)
            elif child.label == NodeLabel.METHOD:
                lines.append(f"{prefix}{connector}def {name}(...)")

    def _render_type_content(self, type_node: TypeDeclNode, lines: List[str], prefix: str, style: TreeStyle):
        """渲染类内部的方法"""
        # 同样，Iterator -> List -> Sort
        methods_iter = self._get_neighbors(type_node, EdgeType.AST, TraversalDirection.OUT)
        methods = list(methods_iter)

        methods = [m for m in methods if m.label == NodeLabel.METHOD and not getattr(m, 'name', '').startswith("<")]
        methods.sort(key=lambda x: getattr(x, 'lineNumber', 0) or 0)

        for i, method in enumerate(methods):
            is_last = (i == len(methods) - 1)
            connector, _ = self._get_style_chars(style, is_last)
            name = getattr(method, 'name', 'unknown')
            lines.append(f"{prefix}{connector}def {name}(...)")

    def _get_style_chars(self, style: TreeStyle, is_last: bool) -> Tuple[str, str]:
        """策略模式：获取不同风格的符号"""
        if style == "ascii":
            connector = "└── " if is_last else "├── "
            child_prefix = "    " if is_last else "│   "
            return connector, child_prefix
        elif style == "markdown":
            return "- ", "  "
        elif style == "indent":
            return "", "  "
        return "└── ", "    "