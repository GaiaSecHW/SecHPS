import sqlite3
import json
import os
import sys
import argparse
from typing import List, Dict, Any, Optional, Set, Counter


# ==============================================================================
# Database Tools (Based on your CPGDebugger)
# ==============================================================================

class CPGDebugger:
    def __init__(self, db_path: str):
        if not os.path.exists(db_path):
            print(f"[!] Error: Database file not found at: {db_path}")
            sys.exit(1)

        print(f"[*] Connecting to SQLite: {db_path}")
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.cursor = self.conn.cursor()

        # 自动探测表名
        self.table_name = "nodes"
        try:
            self.cursor.execute("SELECT count(*) FROM nodes")
        except sqlite3.OperationalError:
            self.table_name = "node"

        print(f"[*] Detected Table Name: '{self.table_name}'")

    def _parse_props(self, row) -> Dict:
        """解析属性，兼容 JSON 和扁平列"""
        data = dict(row)
        props = {}

        # 1. 尝试解析 properties JSON 列
        if 'properties' in data and data['properties']:
            try:
                raw_props = data['properties']
                if isinstance(raw_props, str):
                    props = json.loads(raw_props)
                elif isinstance(raw_props, dict):
                    props = raw_props
            except:
                pass

        # 2. 合并扁平列
        for k, v in data.items():
            if k not in ['properties', 'id', 'label'] and v is not None:
                props[k] = v

        # 3. 补充 ID 和 Label
        props['id'] = data['id']
        props['label'] = data['label']

        # 4. 提取 dispatch_type (关键字段)
        # 有些 parser 放在 properties 里，有些放在列里
        if 'dispatchType' in props:
            props['_dispatch_type'] = props['dispatchType']
        elif 'dispatch_type' in props:
            props['_dispatch_type'] = props['dispatch_type']
        else:
            props['_dispatch_type'] = None

        return props

    def diagnose_dynamic_calls(self):
        """
        [Core Diagnosis] 分析为何 global_points_to 找不到动态调用
        """
        print(f"\n=== [Diagnosis] Analyzing CALL nodes for Dynamic Dispatch issues ===")

        # --- Step 1: 统计操作符分布 ---
        print(f"[*] Scanning all CALL nodes...")

        sql = f"SELECT * FROM {self.table_name} WHERE label='CALL'"
        self.cursor.execute(sql)

        operator_counter = Counter()
        dispatch_type_counter = Counter()
        total_calls = 0

        # 潜在的动态调用候选者 (Name 不是明显的操作符，且不是 Static Dispatch)
        candidates = []

        # 需要被忽略的已知纯计算操作符 (GlobalPointsToPass 中的黑名单)
        IGNORED_OPERATORS = {
            "<operator>.assignment", "<operator>.assignmentPlus", "<operator>.assignmentMinus",
            "<operator>.fieldAccess", "<operator>.indirectFieldAccess", "<operator>.indexAccess",
            "<operator>.addressOf", "<operator>.indirection", "<operator>.pointerShift",
            "<operator>.getElementPtr", "<operator>.addition", "<operator>.subtraction",
            "<operator>.multiplication", "<operator>.division", "<operator>.logicalNot",
            "<operator>.equals", "<operator>.notEquals", "<operator>.lessThan",
            "<operator>.greaterThan", "<operator>.sizeOf", "<operator>.cast", "<operator>.memberAccess"
        }

        for row in self.cursor:
            node = self._parse_props(row)
            name = node.get('name', '')
            dtype = node.get('_dispatch_type', 'N/A')

            total_calls += 1
            dispatch_type_counter[str(dtype)] += 1

            if name.startswith("<operator>."):
                operator_counter[name] += 1

            # 模拟 Solver 的筛选逻辑
            is_dynamic = False

            # 逻辑 A: 显式标记
            if dtype == "DYNAMIC_DISPATCH":
                is_dynamic = True
            # 逻辑 B: 名字匹配 (白名单)
            elif name == "<operator>.indirectCall":
                is_dynamic = True
            # 逻辑 C (User Proposed): 黑名单筛选
            elif name.startswith("<operator>.") and name not in IGNORED_OPERATORS:
                # 记录那些是 operator 但不在我们黑名单里的，这可能是我们要找的漏网之鱼
                pass
            elif not name.startswith("<operator>.") and dtype != "STATIC_DISPATCH":
                # 可能是普通函数名的间接调用
                pass

            # 收集样本：如果名字以 <operator> 开头，但不在常见的计算操作符中
            if name.startswith("<operator>.") and name not in IGNORED_OPERATORS:
                if len(candidates) < 20:  # 只采20个样
                    candidates.append(node)

        print(f"\n[-] Total CALL nodes processed: {total_calls}")

        print(f"\n[-] Dispatch Type Distribution:")
        for k, v in dispatch_type_counter.items():
            print(f"    {k.ljust(20)}: {v}")

        print(f"\n[-] Operator Name Distribution (Top 20):")
        # 重点看这里有没有类似 <operator>.pointerCall 的东西
        for op, count in operator_counter.most_common(20):
            marker = ""
            if op == "<operator>.indirectCall":
                marker = " <--- STANDARD (Should be caught)"
            elif op not in IGNORED_OPERATORS:
                marker = " <--- SUSPICIOUS (Might be your missing calls)"
            print(f"    {str(count).ljust(6)} {op} {marker}")

        print(f"\n[-] Suspicious Operator Candidates (Sample):")
        if not candidates:
            print("    None found. (Wait, do you have ANY operators other than assignment/math?)")
        else:
            for c in candidates:
                print(f"    ID: {c['id']} | Name: {c['name']} | Code: {c.get('code', '')[:50]}")
                # 检查 AST 子节点 (这是 Solver 能否解析的关键)
                self._check_ast_children(c['id'])

    def _check_ast_children(self, node_id):
        """检查某个节点的 AST 子节点情况"""
        # 注意：这里需要根据你的 edges 表结构来查。
        # 假设 edge 表名为 edges 或 edge，且 label 为 'AST'

        edge_table = "edges"
        try:
            self.cursor.execute("SELECT count(*) FROM edges")
        except:
            edge_table = "edge"  # fallback

        # 查找出边 (AST)
        # schema 通常是: outNode (src), inNode (dst), label
        # 或者: start_id, end_id, type

        # 尝试探测列名
        try:
            self.cursor.execute(f"SELECT * FROM {edge_table} LIMIT 1")
            cols = [description[0] for description in self.cursor.description]

            src_col = 'src'
            dst_col = 'dst'
            type_col = 'type'

        except:
            print("    [!] Could not detect edge table schema.")
            return

        sql = f"""
            SELECT count(*) as cnt 
            FROM {edge_table} 
            WHERE {src_col} = ? AND {type_col} = 'AST'
        """
        self.cursor.execute(sql, (node_id,))
        res = self.cursor.fetchone()
        count = res['cnt'] if res else 0

        print(f"        -> AST Children Count: {count}")
        if count == 0:
            print("           \033[91m[CRITICAL] No AST children! Solver cannot resolve ptr.\033[0m")
        elif count >= 1:
            print("           [OK] Has children. Check if child 0 is the function pointer.")

    def close(self):
        self.conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CPG Dynamic Call Debugger")
    parser.add_argument("db_path", help="Path to cpg.db file")

    args = parser.parse_args()

    debugger = CPGDebugger(args.db_path)
    try:
        debugger.diagnose_dynamic_calls()
    finally:
        debugger.close()