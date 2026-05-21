import sqlite3
import json
import os
import sys
import argparse
from typing import List, Dict, Any, Tuple


# ==============================================================================
# Helper: Database Wrapper
# ==============================================================================

class AssignmentDebugger:
    def __init__(self, db_path: str):
        if not os.path.exists(db_path):
            print(f"[!] Error: Database file not found at: {db_path}")
            sys.exit(1)

        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.cursor = self.conn.cursor()

        # Detect table names (sometimes 'nodes'/'edges', sometimes singular)
        self.node_table = "node" if self._table_exists("node") else "nodes"
        self.edge_table = "edge" if self._table_exists("edge") else "edges"
        print(f"[*] Connected. Nodes: '{self.node_table}', Edges: '{self.edge_table}'")

    def _table_exists(self, name: str) -> bool:
        self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,))
        return self.cursor.fetchone() is not None

    def _parse_props(self, row) -> Dict:
        """解析节点属性，兼容 JSON 格式"""
        if row is None: return {}
        data = dict(row)
        props = {}
        # 提取 properties JSON
        if 'properties' in data and data['properties']:
            try:
                raw = data['properties']
                if isinstance(raw, str):
                    props = json.loads(raw)
                elif isinstance(raw, dict):
                    props = raw
            except:
                pass

        # 合并直接字段
        for k, v in data.items():
            if k not in ['properties'] and v is not None:
                props[k] = v
        return props

    def get_node(self, node_id: int) -> Dict:
        self.cursor.execute(f"SELECT * FROM {self.node_table} WHERE id=?", (node_id,))
        return self._parse_props(self.cursor.fetchone())

    def get_ast_children(self, parent_id: int) -> List[Dict]:
        """获取 AST 子节点，按 order/index 排序"""
        # 查找 AST 边
        sql = f"""
        SELECT dst, properties FROM {self.edge_table} 
        WHERE src=?
        """
        self.cursor.execute(sql, (parent_id,))
        edges = self.cursor.fetchall()
        print(dict(edges[0]))

        children = []
        for edge in edges:
            child_id = edge['dst']
            child_node = self.get_node(child_id)

            # 尝试获取排序索引
            order = child_node.get('order') or child_node.get('argumentIndex') or 999
            children.append((order, child_node))

        # 按 order 排序
        children.sort(key=lambda x: x[0])
        return [c[1] for c in children]

    # ==============================================================================
    # Core Logic: Analyze Assignments
    # ==============================================================================

    def scan_assignments(self, variable_filter: str = None, strict_func_ptr: bool = False):
        """
        扫描数据库中的赋值操作
        :param variable_filter: 只显示包含此名字的变量赋值
        :param strict_func_ptr: 只显示右值看起来像函数的赋值
        """
        print(f"\n=== Scanning ASSIGNMENT Constraints ===")
        if variable_filter:
            print(f"[*] Filtering for LHS variable containing: '{variable_filter}'")
        if strict_func_ptr:
            print(f"[*] Filtering for potential FUNCTION POINTER assignments only")

        # 查找所有赋值类型的 CALL 节点
        # 通常是 <operator>.assignment, =, <operator>.assignmentPlus 等
        sql = f"""
        SELECT * FROM {self.node_table} 
        WHERE label='CALL' 
        AND (properties like '%<operator>.assignment%')
        """
        self.cursor.execute(sql)
        assignments = self.cursor.fetchall()

        count = 0
        found_interesting = 0

        print(dict(assignments[0]))
        for row in assignments:

            node = self._parse_props(row)
            nid = node['id']

            # 获取 LHS (左值) 和 RHS (右值)
            children = self.get_ast_children(nid)
            if len(children) < 2:
                continue  # 异常 AST

            lhs = children[0]
            rhs = children[1]

            lhs_code = lhs.get('code', lhs.get('name', '<unknown>'))
            rhs_code = rhs.get('code', rhs.get('name', '<unknown>'))

            # --- 过滤器 1: 变量名 ---
            if variable_filter and variable_filter not in lhs_code:
                continue

            # --- 过滤器 2: 函数指针启发式检查 ---
            is_interesting = False

            # Case A: RHS 是 METHOD_REF (直接引用函数)
            if rhs.get('label') == 'METHOD_REF':
                is_interesting = True

            # Case B: RHS 是取地址操作 (&func)
            elif rhs.get('name') == '<operator>.addressOf':
                # 深入检查取地址的内容
                rhs_children = self.get_ast_children(rhs['id'])
                if rhs_children:
                    addr_target = rhs_children[0]
                    # 如果取的是一个函数，或者是未知的名字
                    if addr_target.get('label') == 'METHOD_REF' or not addr_target.get('typeFullName'):
                        is_interesting = True

            # Case C: 简单的名字赋值 (可能是在赋函数名)
            # 这里比较模糊，我们假设如果 RHS 没有括号调用，且不是数字，可能是函数指针
            elif "(" not in rhs_code and not rhs_code.isdigit():
                # 排除一些明显的常量
                if "NULL" not in rhs_code and "false" not in rhs_code:
                    is_interesting = True

            # 应用严格模式
            if strict_func_ptr and not is_interesting:
                continue

            count += 1
            if is_interesting: found_interesting += 1

            # --- 输出结果 ---
            color = "\033[96m" if is_interesting else ""  # 青色高亮有趣的赋值
            reset = "\033[0m"

            print(f"{color}[ASSIGN ID: {nid}]{reset} in {node.get('location') or '?'}")
            print(f"  Code:  {node.get('code')}")
            print(f"  LHS (Dst): [{lhs.get('label')}] {lhs_code} (ID: {lhs['id']})")
            print(f"  RHS (Src): [{rhs.get('label')}] {rhs_code} (ID: {rhs['id']})")

            if is_interesting:
                print(f"  \033[92m>>> Potential Func Ptr Flow detected!\033[0m")
            print("-" * 40)

        print(f"\n[Summary] Scanned {len(assignments)} assignments.")
        print(f"          Displayed {count} relevant assignments.")
        print(f"          Found {found_interesting} potential function pointer flows.")

    def close(self):
        self.conn.close()


# ==============================================================================
# Main
# ==============================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Check CPG for Assignment Constraints")
    parser.add_argument("db_path", help="Path to cpg.db")
    parser.add_argument("--var", help="Filter by variable name (LHS)", default=None)
    parser.add_argument("--ptr-only", action="store_true", help="Only show potential function pointer assignments")

    args = parser.parse_args()

    debugger = AssignmentDebugger(args.db_path)
    try:
        debugger.scan_assignments(variable_filter=args.var, strict_func_ptr=args.ptr_only)
    finally:
        debugger.close()