import sqlite3
import json
import os
import sys
import argparse
from typing import List, Dict, Any, Optional, Set
from pathlib import Path

# ==============================================================================
# Helper Logic (复用 Pass 中的核心逻辑)
# ==============================================================================

PREFIX_FULL = "F:"  # Method Full Name
PREFIX_LOCAL = "L:"  # Local (File Scope) Name
PREFIX_ALIAS = "A:"  # [New] Alias Name (from Macro)
PREFIX_MANGLED = "M:"  # [New] Mangled Name (C++)


def normalize_path(raw_path: str) -> str:
    """模拟 Pass 中的路径归一化逻辑"""
    if not raw_path: return ""
    try:
        # 简单模拟：如果包含项目根目录结构，尝试截断
        if "/" in raw_path:
            parts = raw_path.split("/")
            if len(parts) > 2:
                return "/".join(parts[-2:])
        return raw_path
    except:
        return raw_path


def extract_func_name(full_name: str) -> str:
    """模拟 Pass 中的函数名提取逻辑"""
    if not full_name: return ""
    if ':' in full_name and '/' in full_name:
        return full_name.rsplit(':', 1)[-1]
    return full_name


# ==============================================================================
# Database Tools
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
        """
        [Updated] 解析属性，特别关注 aliasNames 和 mangledName
        """
        data = dict(row)
        props = {}

        # 1. 尝试解析 properties JSON 列
        if 'properties' in data and data['properties']:
            try:
                # 兼容 properties 可能是字符串或已经是dict
                raw_props = data['properties']
                if isinstance(raw_props, str):
                    props = json.loads(raw_props)
                elif isinstance(raw_props, dict):
                    props = raw_props
            except:
                pass

        # 2. 合并扁平列 (如果有)
        for k, v in data.items():
            if k not in ['properties', 'id', 'label'] and v is not None:
                props[k] = v

        # 3. 补充 ID 和 Label
        props['id'] = data['id']
        props['label'] = data['label']

        # 4. [Helper] 将关键的新特性提到顶层方便访问
        if 'aliasNames' in props:
            props['_alias_names'] = props['aliasNames']
        elif 'alias_names' in props:  # 兼容不同命名风格
            props['_alias_names'] = props['alias_names']
        else:
            props['_alias_names'] = []

        if 'mangledName' in props:
            props['_mangled'] = props['mangledName']
        elif 'mangled_name' in props:
            props['_mangled'] = props['mangled_name']
        else:
            props['_mangled'] = None

        return props

    def _print_node_basics(self, node: Dict, node_type: str):
        print(f"\n[{node_type} Node ID: {node['id']}]")
        print(f"  name       : {node.get('name')}")

        # 显示新特性
        mangled = node.get('_mangled')
        aliases = node.get('_alias_names')

        if mangled:
            print(f"  mangledName: {mangled} \033[92m(New!)\033[0m")
        if aliases:
            print(f"  aliasNames : {aliases} \033[92m(New!)\033[0m")

        print(f"  fullName   : {node.get('fullName') or node.get('full_name')}")
        print(f"  fileName   : {node.get('fileName') or node.get('file_name')}")

    def find_methods(self, name_pattern: str):
        """查找 Method 定义"""
        print(f"\n=== Searching for METHOD definition: '{name_pattern}' ===")

        # 这里的 SQL 只能查 name，对于 Alias 存储在 properties JSON 里的情况，
        # 我们需要先拉取可能得候选者，或者全量扫描 (调试时全量扫描通常可以接受)
        # 为了效率，我们先查 name LIKE

        sql = f"SELECT * FROM {self.table_name} WHERE label='METHOD'"
        self.cursor.execute(sql)

        count = 0
        for row in self.cursor:
            node = self._parse_props(row)
            name = node.get('name', '')
            aliases = node.get('_alias_names', [])

            # 检查 Name 或 Alias 是否匹配
            match = (name_pattern in name)
            if not match:
                for alias in aliases:
                    if name_pattern in alias:
                        match = True
                        break

            if match:
                count += 1
                self._print_node_basics(node, "METHOD")
                # print signature
                print(f"  signature  : {node.get('signature')}")

                # Simulation: Generate Keys
                keys = self._simulate_method_keys(node)
                print(f"  [Sim] Generated Index Keys: {keys}")

        if count == 0:
            print(f"[-] No METHOD found matching '{name_pattern}' (Checked names and aliases)")

    def find_calls(self, name_pattern: str):
        """查找 Call 调用"""
        print(f"\n=== Searching for CALL usage: '{name_pattern}' ===")

        sql = f"SELECT * FROM {self.table_name} WHERE label='CALL'"
        self.cursor.execute(sql)

        count = 0
        for row in self.cursor:
            node = self._parse_props(row)
            name = node.get('name', '')

            # Call 的别名通常比较少见，但为了对称性也查一下
            if name_pattern in name:
                count += 1
                self._print_node_basics(node, "CALL")
                print(f"  methodFull : {node.get('methodFullName')}")

                # Simulation: Generate Query Keys
                keys = self._simulate_call_query_keys(node)
                print(f"  [Sim] Query Keys (Priority Order):")
                for k_type, k_val in keys:
                    print(f"    - {k_type.ljust(12)}: {k_val}")

        if count == 0:
            print(f"[-] No CALL found matching '{name_pattern}'")

    def _simulate_method_keys(self, node: Dict) -> Set[str]:
        """模拟 Linker Phase 1：为 Method 生成索引键"""
        keys = set()

        # 1. Alias Keys
        for alias in node.get('_alias_names', []):
            keys.add(f"{PREFIX_ALIAS}{alias}")

        # 2. Mangled Key
        if node.get('_mangled'):
            keys.add(f"{PREFIX_MANGLED}{node.get('_mangled')}")

        # 3. Full Name Key
        raw_full = node.get('fullName') or node.get('full_name')
        if raw_full and raw_full != "ANY":
            clean = extract_func_name(raw_full)
            keys.add(f"{PREFIX_FULL}{clean}")
            # Backup Simple Name
            name = node.get('name')
            if name and name != clean:
                keys.add(f"{PREFIX_FULL}{name}")

        return keys

    def _simulate_call_query_keys(self, node: Dict) -> List[tuple]:
        """模拟 Linker Phase 2：为 Call 生成查询键 (带优先级)"""
        keys = []  # List[(Type, Key)]

        # 1. Mangled
        if node.get('_mangled'):
            keys.append(('MANGLED', f"{PREFIX_MANGLED}{node.get('_mangled')}"))

        # 2. Alias
        for alias in node.get('_alias_names', []):
            keys.append(('ALIAS', f"{PREFIX_ALIAS}{alias}"))

        # 2.5 Alias Fallback (Implicit)
        # 如果 Call 名字本身就是别名 (例如 do_cntp)
        name = node.get('name')
        if name:
            keys.append(('ALIAS_FB', f"{PREFIX_ALIAS}{name}"))

        # 3. Full Name
        raw_full = node.get('methodFullName')
        if raw_full:
            clean = extract_func_name(raw_full)
            keys.append(('FULL', f"{PREFIX_FULL}{clean}"))
            if name and name != clean:
                keys.append(('FULL_SIMPLE', f"{PREFIX_FULL}{name}"))

        # 4. Local Name
        raw_file = node.get('fileName')
        if raw_file and name:
            # 注意：这里的 project_root 模拟可能不准，仅做演示
            clean_file = normalize_path(raw_file)
            keys.append(('LOCAL', f"{PREFIX_LOCAL}{clean_file}:{name}"))

        return keys

    def analyze_link(self, target_name: str):
        """[Core] 深度分析链接逻辑 (Updated for Alias/Mangled)"""
        print(f"\n=== [Deep Analysis] Linking logic for '{target_name}' ===")

        # --- Step 1: Build In-Memory Index for Targets ---
        # 也就是寻找所有可能是 target 的 Method 定义
        print(f"[*] Scanning DB for Candidate Methods (Name/Alias match '{target_name}')...")

        index = {}  # Key -> MethodID
        candidates = []

        sql = f"SELECT * FROM {self.table_name} WHERE label='METHOD'"
        self.cursor.execute(sql)
        for row in self.cursor:
            node = self._parse_props(row)

            # 判断这个 Method 是否相关 (名字匹配，或者别名匹配)
            # 宽泛匹配：只要这个 Method 产生了包含 target_name 的 key，我们就关注它
            keys = self._simulate_method_keys(node)

            is_relevant = False
            # 简单过滤：名字里包含 target_name 或者是相关的 Alias
            if target_name in node.get('name', ''): is_relevant = True
            for alias in node.get('_alias_names', []):
                if target_name in alias: is_relevant = True

            if is_relevant:
                candidates.append(node)
                for k in keys:
                    index[k] = node['id']

        print(f"[*] Found {len(candidates)} relevant methods.")
        for cand in candidates:
            print(f"    - ID {cand['id']} ({cand['name']}) | Aliases: {cand.get('_alias_names')}")
            print(f"      Keys: {self._simulate_method_keys(cand)}")

        # --- Step 2: Analyze Calls ---
        print(f"\n[*] Scanning DB for Calls to '{target_name}'...")
        sql = f"SELECT * FROM {self.table_name} WHERE label='CALL'"
        self.cursor.execute(sql)

        for row in self.cursor:
            node = self._parse_props(row)
            name = node.get('name', '')

            # 只分析名字匹配的 call
            if name != target_name and target_name not in name:
                continue

            print(f"\n  > Analyzing Call ID {node['id']} ('{name}')...")

            # 生成查询键
            query_keys = self._simulate_call_query_keys(node)

            matched = False
            for k_type, key in query_keys:
                if key in index:
                    target_id = index[key]
                    print(f"    [MATCH] \033[92m{k_type.ljust(12)}: {key} -> Method {target_id}\033[0m")
                    matched = True
                    break  # 找到最高优先级的就停止
                else:
                    print(f"    [MISS ] {k_type.ljust(12)}: {key}")

            if not matched:
                print(f"    [FAIL ] \033[91mNo link found for this call.\033[0m")
                print(f"            (Debug Hint: Check if Method keys contain any of the Call keys)")

    def close(self):
        self.conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CPG SQLite Debugger (Enhanced)")
    parser.add_argument("db_path", help="Path to cpg.db file")
    parser.add_argument("--method", help="Find definition of a method (checks alias too)")
    parser.add_argument("--call", help="Find calls to a method")
    parser.add_argument("--analyze", help="Deep analysis of why a link fails")

    args = parser.parse_args()

    debugger = CPGDebugger(args.db_path)

    try:
        if args.method:
            debugger.find_methods(args.method)

        if args.call:
            debugger.find_calls(args.call)

        if args.analyze:
            debugger.analyze_link(args.analyze)

        if not (args.method or args.call or args.analyze):
            print("[-] Please specify an action: --method, --call, or --analyze")

    finally:
        debugger.close()