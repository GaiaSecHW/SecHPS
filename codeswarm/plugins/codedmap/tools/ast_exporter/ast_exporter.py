import shutil
import time
import gzip
import sys
import os
import json
import hashlib
import argparse
import logging
import fnmatch
import multiprocessing
import shlex
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import List, Dict, Any, Optional, Tuple, Set
from dataclasses import dataclass

import clang.cindex

# ==============================================================================
# 1. Setup & Logging
# ==============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [%(levelname)s] - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("ASTExporter")

# --- LibClang Compatibility Polyfill ---
try:
    KIND_MACRO_EXPANSION = clang.cindex.CursorKind.MACRO_EXPANSION
except AttributeError:
    try:
        KIND_MACRO_EXPANSION = clang.cindex.CursorKind.MACRO_INSTANTIATION
    except AttributeError:
        KIND_MACRO_EXPANSION = None
        logger.warning("Could not find MACRO_EXPANSION/MACRO_INSTANTIATION in libclang bindings.")

# ==============================================================================
# 2. Global Worker State
# ==============================================================================
_worker_clang_index: Optional[clang.cindex.Index] = None
_worker_config: Optional['ASTExporterConfig'] = None
_file_content_cache: Dict[str, bytes] = {}


# ==============================================================================
# 3. Configuration Class
# ==============================================================================

class ASTExporterConfig:
    def __init__(self, project_root: str, output_dir: str, build_dir: str, exclude_patterns: List[str]):
        self.project_root_str = str(Path(project_root).resolve())
        if not self.project_root_str.endswith(os.sep):
            self.project_root_str += os.sep
        self.build_dir_str = str(Path(build_dir).resolve())  # 预处理
        if not self.build_dir_str.endswith(os.sep):
            self.build_dir_str += os.sep
        self.output_dir = Path(output_dir).resolve()

        self.exclude_patterns = exclude_patterns


def worker_initializer(config_obj: ASTExporterConfig):
    global _worker_clang_index, _worker_config, _file_content_cache

    # [Robustness] 开启 Fault Handler 以便在底层 Crash 时打印堆栈
    import faulthandler
    faulthandler.enable()

    _worker_config = config_obj
    _worker_clang_index = clang.cindex.Index.create()
    _file_content_cache = {}
    os.environ['LIBCLANG_DISABLE_CRASH_RECOVERY'] = '1'


# ==============================================================================
# 4. Helper Utils (File System & Path)
# ==============================================================================

def get_file_hash(compile_command: Dict) -> str:
    if 'arguments' in compile_command:
        cmd_str = " ".join(compile_command['arguments'])
    else:
        cmd_str = compile_command.get('command', '')
    fingerprint = f"{compile_command['file']}|{compile_command['directory']}|{cmd_str}"
    return hashlib.md5(fingerprint.encode('utf-8')).hexdigest()[:12]


def normalize_path_for_glob(path_str: str) -> str:
    path_str = path_str.replace(os.sep, '/')
    if not path_str.startswith('/'):
        path_str = '/' + path_str
    return path_str


def should_exclude(file_path: Path, config: ASTExporterConfig) -> bool:
    try:
        rel_path = file_path.absolute().relative_to(config.project_root_str)
        path_str = str(rel_path)
    except ValueError:
        path_str = str(file_path.absolute())

    norm_path = normalize_path_for_glob(path_str)
    for pattern in config.exclude_patterns:
        if fnmatch.fnmatch(norm_path, pattern):
            return True
    return False


def is_project_code(cursor: clang.cindex.Cursor, config: ASTExporterConfig) -> bool:
    # 快速过滤系统头文件
    if cursor.location.is_in_system_header:
        return False

    source_file = cursor.location.file
    if not source_file:
        return True

    # 获取文件名字符串 (libclang 直接返回绝对路径通常)
    file_path = source_file.name

    # 允许源码目录 OR 构建目录
    return (file_path.startswith(config.project_root_str) or
            file_path.startswith(config.build_dir_str))


def clean_compile_args(raw_args: List[str], source_filename: str) -> List[str]:
    clean_args = []
    it = iter(raw_args)
    for arg in it:
        if arg in ['-o', '-c']:
            next(it, None)
            continue
        if arg.startswith(('-o', '-c')):
            continue
        # [Kernel] 保留部分优化flag可能有助于宏解析，但通常为了速度跳过警告
        if arg.startswith('-W'):
            continue
        if arg.endswith(source_filename):
            continue
        clean_args.append(arg)
    return clean_args


def _read_file_cached(file_path: str) -> Optional[bytes]:
    global _file_content_cache
    if file_path in _file_content_cache:
        return _file_content_cache[file_path]
    if not os.path.exists(file_path):
        return None
    try:
        with open(file_path, 'rb') as f:
            content = f.read()
            if len(_file_content_cache) > 100:
                _file_content_cache.clear()
            _file_content_cache[file_path] = content
            return content
    except Exception:
        return None


# ==============================================================================
# 5. Source Code Extraction Utils
# ==============================================================================

def _get_source_buffer(cursor: clang.cindex.Cursor,
                       memory_source: Optional[bytes],
                       main_filename: str) -> Tuple[Optional[bytes], int]:
    loc = cursor.location
    if not loc.file:
        return None, -1
    try:
        file_path = str(Path(loc.file.name).resolve())
        is_in_main_file = (file_path == main_filename)
    except:
        return None, -1
    target_bytes = memory_source if is_in_main_file else _read_file_cached(file_path)
    if target_bytes and 0 <= loc.offset < len(target_bytes):
        return target_bytes, loc.offset
    return None, -1


def get_raw_identifier(cursor, source_bytes: Optional[bytes], main_filename: str) -> str:
    target_bytes, offset = _get_source_buffer(cursor, source_bytes, main_filename)
    if not target_bytes:
        return ""
    chunk = target_bytes[offset:min(offset + 256, len(target_bytes))]
    try:
        chunk_str = chunk.decode('utf-8', errors='ignore')
    except:
        return ""
    extracted = []
    for i, char in enumerate(chunk_str):
        if i == 0 and char == '~':
            extracted.append(char)
            continue
        if char.isalnum() or char == '_':
            extracted.append(char)
        else:
            break
    result = "".join(extracted)
    if result == "operator":
        return ""
    return result


def get_code_from_source(cursor, source_bytes: Optional[bytes], main_filename: str) -> str:
    extent = cursor.extent
    start = extent.start
    end = extent.end
    try:
        file_path = str(Path(start.file.name).resolve())
        is_main = (file_path == main_filename)
        content = source_bytes if is_main else _read_file_cached(file_path)
        if content and start.offset >= 0 and end.offset <= len(content):
            return content[start.offset:end.offset].decode('utf-8', errors='replace')
    except:
        pass
    try:
        tokens = list(cursor.get_tokens())
        if tokens:
            return "".join([t.spelling for t in tokens])
    except:
        pass
    return ""


def get_token_spelling(cursor, source_bytes: Optional[bytes], main_filename: str) -> str:
    try:
        tokens = list(cursor.get_tokens())
        for token in tokens:
            if token.kind == clang.cindex.TokenKind.PUNCTUATION:
                s = token.spelling
                if s not in ['(', ')', '[', ']', '{', '}', ';', ',', '.']:
                    return s
        if tokens:
            first = tokens[0]
            if first.kind == clang.cindex.TokenKind.KEYWORD:
                return first.spelling
    except Exception:
        pass
    return ""


# ==============================================================================
# 6. Serialization Logic (Helper Functions)
# ==============================================================================

def compact_node(node: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(node, dict): return node
    res = {}
    for k, v in node.items():
        if v is None or v is False: continue
        if isinstance(v, dict):
            v = compact_node(v)
            if not v: continue
        elif isinstance(v, list):
            if not v: continue
            v = [compact_node(item) if isinstance(item, dict) else item for item in v]
            if not v: continue
        if v == "" and k in ["spelling", "usr", "opcode", "mangled_name", "storage_class"]:
            continue
        res[k] = v
    return res


def _normalize_cursor_path(cursor: clang.cindex.Cursor, config: ASTExporterConfig) -> Optional[str]:
    start = cursor.extent.start
    if not start.file: return None
    try:
        raw_path = Path(start.file.name).resolve()
        if raw_path.is_relative_to(config.build_dir_str):
            return str(f"_generated/{raw_path.relative_to(config.build_dir_str)}")
        if raw_path.is_relative_to(config.project_root_str):
            return str(raw_path.relative_to(config.project_root_str))
        return str(raw_path)
    except Exception:
        return start.file.name


def _extract_type_info(cursor: clang.cindex.Cursor) -> Optional[Dict[str, Any]]:
    """
    [Safe & Enhanced] 提取类型信息，包含 Size/Align 保护。
    """
    try:
        t = cursor.type
        if t.kind == clang.cindex.TypeKind.INVALID: return None

        info = {
            "fullname": t.spelling,
            "canonical": t.get_canonical().spelling,
            "kind": t.kind.name,
            "is_const": t.is_const_qualified(),
            "is_pointer": t.kind == clang.cindex.TypeKind.POINTER,
            "is_reference": t.kind in [clang.cindex.TypeKind.LVALUEREFERENCE, clang.cindex.TypeKind.RVALUEREFERENCE],
            "return_type": cursor.result_type.spelling if cursor.kind == clang.cindex.CursorKind.FUNCTION_DECL else None
        }

        # [CRITICAL] LibClang Crash Prevention
        unsafe_kinds = [
            clang.cindex.TypeKind.INVALID,
            clang.cindex.TypeKind.UNEXPOSED,
            clang.cindex.TypeKind.FUNCTIONPROTO,
            clang.cindex.TypeKind.FUNCTIONNOPROTO,
            clang.cindex.TypeKind.INCOMPLETEARRAY,
            clang.cindex.TypeKind.VOID
        ]

        is_builtin = False
        try:
            if cursor.location.file is None: is_builtin = True
        except:
            pass

        if t.kind not in unsafe_kinds and not is_builtin:
            try:
                size = t.get_size()
                if size > 0: info["size"] = size

                align = t.get_align()
                if align > 0: info["align"] = align
            except Exception:
                pass

        return info
    except:
        return None


def _extract_modifiers(cursor: clang.cindex.Cursor, node: Dict[str, Any]):
    if cursor.storage_class != clang.cindex.StorageClass.INVALID:
        node["storage_class"] = cursor.storage_class.name
        if cursor.storage_class == clang.cindex.StorageClass.STATIC:
            node["is_static"] = True

    if cursor.access_specifier != clang.cindex.AccessSpecifier.INVALID:
        node["access_specifier"] = cursor.access_specifier.name

    if cursor.kind in [clang.cindex.CursorKind.FUNCTION_DECL, clang.cindex.CursorKind.CXX_METHOD,
                       clang.cindex.CursorKind.CONSTRUCTOR]:
        try:
            if cursor.is_static_method(): node["is_static_method"] = True
            if cursor.is_virtual_method(): node["is_virtual_method"] = True
            if cursor.is_variadic(): node["is_variadic"] = True
            if clang.cindex.conf.lib.clang_Cursor_isFunctionInlined(cursor):
                node["is_inline"] = True
        except:
            pass

    if cursor.kind == clang.cindex.CursorKind.CXX_METHOD:
        try:
            if cursor.is_pure_virtual_method(): node["is_pure_virtual"] = True
        except:
            pass

    if cursor.kind == clang.cindex.CursorKind.CONSTRUCTOR:
        try:
            if hasattr(cursor, 'is_converting_constructor') and not cursor.is_converting_constructor():
                node["is_explicit"] = True
        except:
            pass


def _extract_content(cursor: clang.cindex.Cursor, node: Dict[str, Any],
                     source_bytes: Optional[bytes], main_filename: str):
    kind = cursor.kind
    if kind in [
        clang.cindex.CursorKind.INTEGER_LITERAL, clang.cindex.CursorKind.FLOATING_LITERAL,
        clang.cindex.CursorKind.STRING_LITERAL, clang.cindex.CursorKind.CHARACTER_LITERAL,
        clang.cindex.CursorKind.CXX_BOOL_LITERAL_EXPR
    ]:
        val = get_code_from_source(cursor, source_bytes, main_filename)
        if val: node["value"] = val

    elif kind in [
        clang.cindex.CursorKind.BINARY_OPERATOR,
        clang.cindex.CursorKind.COMPOUND_ASSIGNMENT_OPERATOR
    ]:
        op = get_token_spelling(cursor, source_bytes, main_filename)
        if op: node["opcode"] = op

    elif kind == clang.cindex.CursorKind.UNARY_OPERATOR:
        # [Enhanced] 区分前缀与后缀操作符
        op = get_token_spelling(cursor, source_bytes, main_filename)

        # 只有 ++ 和 -- 存在前后缀歧义，其他如 *, &, !, ~, - 都是前缀
        if op in ["++", "--"]:
            is_postfix = False
            try:
                # 获取操作数 (第一个子节点)
                children = list(cursor.get_children())
                if children:
                    operand = children[0]
                    # 如果表达式起始位置 == 操作数起始位置，说明操作数在前 -> 后缀
                    if cursor.extent.start.offset == operand.extent.start.offset:
                        is_postfix = True
            except:
                pass

            # 在 JSON 中明确标记
            if is_postfix:
                node["opcode"] = f"{op}(post)"  # 例如 "++(post)"
            else:
                node["opcode"] = op  # 默认为前缀 "++"
        elif op:
            node["opcode"] = op

    elif kind == clang.cindex.CursorKind.ENUM_CONSTANT_DECL:
        try:
            node["enum_value"] = cursor.enum_value
        except:
            pass


def _determine_dispatch_type(cursor: clang.cindex.Cursor) -> str:
    ref = cursor.referenced
    if ref is None: return "DYNAMIC_DISPATCH"

    kind = ref.kind
    if kind == clang.cindex.CursorKind.FUNCTION_DECL:
        return "STATIC_DISPATCH"
    if kind == clang.cindex.CursorKind.CXX_METHOD:
        if ref.is_virtual_method() or ref.is_pure_virtual_method():
            return "DYNAMIC_DISPATCH"
        return "STATIC_DISPATCH"
    if kind in [clang.cindex.CursorKind.VAR_DECL,
                clang.cindex.CursorKind.PARM_DECL,
                clang.cindex.CursorKind.FIELD_DECL]:
        return "DYNAMIC_DISPATCH"
    if kind in [clang.cindex.CursorKind.CONSTRUCTOR, clang.cindex.CursorKind.DESTRUCTOR]:
        return "STATIC_DISPATCH"
    return "STATIC_DISPATCH"


# ==============================================================================
# 7. Serializer Class (The Core)
# ==============================================================================

@dataclass
class AnalysisContext:
    config: ASTExporterConfig
    source_bytes: Optional[bytes]
    main_filename: str

    def normalize_path(self, cursor: clang.cindex.Cursor) -> Optional[str]:
        return _normalize_cursor_path(cursor, self.config)


class CursorSerializer:
    def __init__(self, context: AnalysisContext):
        self.ctx = context

    def serialize(self, cursor: clang.cindex.Cursor) -> Optional[Dict[str, Any]]:
        if cursor.kind != clang.cindex.CursorKind.TRANSLATION_UNIT and not is_project_code(cursor, self.ctx.config):
            return None
        return self._serialize_recursive(cursor)

    def _serialize_recursive(self, cursor: clang.cindex.Cursor) -> Dict[str, Any]:
        node = self._build_skeleton(cursor)

        # Enrich Data
        self._enrich_flags(cursor, node)
        self._enrich_type_info(cursor, node)
        self._enrich_signature(cursor, node)
        self._enrich_alias_and_dispatch(cursor, node)
        self._enrich_modifiers(cursor, node)
        self._enrich_content(cursor, node)
        self._enrich_designated_init(cursor, node)
        self._enrich_references(cursor, node)
        self._enrich_field_info(cursor, node)  # [New] Field Offsets
        self._enrich_inheritance(cursor, node)

        # Children Collection (Semantic + Lexical)
        children = self._collect_children_smart(cursor)
        if children:
            node["children"] = children

        return compact_node(node)

    def _build_skeleton(self, cursor: clang.cindex.Cursor) -> Dict[str, Any]:
        extent = cursor.extent
        start = extent.start
        end = extent.end

        # 1. 获取原始拼写
        spelling = cursor.spelling

        # 2. 如果是控制结构且 spelling 为空，尝试从源码截取宏名
        if not spelling and cursor.kind in [
            clang.cindex.CursorKind.FOR_STMT,
            clang.cindex.CursorKind.IF_STMT,
            clang.cindex.CursorKind.WHILE_STMT,
            clang.cindex.CursorKind.SWITCH_STMT,
            clang.cindex.CursorKind.DO_STMT
        ]:
            raw_id = get_raw_identifier(cursor, self.ctx.source_bytes, self.ctx.main_filename)
            if raw_id:
                spelling = raw_id

        return {
            "kind": cursor.kind.name,
            "spelling": spelling,
            "mangled_name": cursor.mangled_name,
            "usr": cursor.get_usr(),
            "location": {
                "file": self.ctx.normalize_path(cursor),
                "line": start.line,
                "col": start.column,
                "offset_start": start.offset,
                "offset_end": end.offset,
                "line_end": end.line,
                "col_end": end.column
            }
        }

    def _enrich_flags(self, cursor: clang.cindex.Cursor, node: Dict[str, Any]):
        if cursor.kind in [clang.cindex.CursorKind.UNEXPOSED_EXPR, clang.cindex.CursorKind.UNEXPOSED_STMT]:
            node["is_unexposed"] = True
        if KIND_MACRO_EXPANSION and cursor.kind == KIND_MACRO_EXPANSION:
            node["macro_name"] = cursor.spelling
        if cursor.is_definition():
            node["is_definition"] = True

    def _enrich_type_info(self, cursor: clang.cindex.Cursor, node: Dict[str, Any]):
        info = _extract_type_info(cursor)
        if info:
            node["type"] = info

    def _enrich_signature(self, cursor: clang.cindex.Cursor, node: Dict[str, Any]):
        if cursor.kind in [clang.cindex.CursorKind.FUNCTION_DECL, clang.cindex.CursorKind.CXX_METHOD,
                           clang.cindex.CursorKind.CONSTRUCTOR]:
            try:
                node["signature"] = cursor.type.spelling
            except:
                pass

    def _enrich_alias_and_dispatch(self, cursor: clang.cindex.Cursor, node: Dict[str, Any]):
        kind = cursor.kind
        if kind in [clang.cindex.CursorKind.FUNCTION_DECL, clang.cindex.CursorKind.VAR_DECL,
                    clang.cindex.CursorKind.STRUCT_DECL, clang.cindex.CursorKind.UNION_DECL,
                    clang.cindex.CursorKind.PARM_DECL, clang.cindex.CursorKind.FIELD_DECL]:
            raw_name = get_raw_identifier(cursor, self.ctx.source_bytes, self.ctx.main_filename)
            if raw_name and raw_name != cursor.spelling and not raw_name.startswith('~'):
                node["alias_name"] = raw_name
        elif kind == clang.cindex.CursorKind.CALL_EXPR:
            raw_code = get_raw_identifier(cursor, self.ctx.source_bytes, self.ctx.main_filename)
            if not raw_code:
                slice_code = get_code_from_source(cursor, self.ctx.source_bytes, self.ctx.main_filename)
                if slice_code: raw_code = slice_code.split('(')[0].strip()
            if raw_code and raw_code != cursor.spelling:
                node["alias_name"] = raw_code
            node["dispatch_type"] = _determine_dispatch_type(cursor)

    def _enrich_modifiers(self, cursor: clang.cindex.Cursor, node: Dict[str, Any]):
        _extract_modifiers(cursor, node)

    def _enrich_content(self, cursor: clang.cindex.Cursor, node: Dict[str, Any]):
        _extract_content(cursor, node, self.ctx.source_bytes, self.ctx.main_filename)

    def _enrich_references(self, cursor: clang.cindex.Cursor, node: Dict[str, Any]):
        if cursor.referenced and cursor.referenced != cursor:
            try:
                node["ref_usr"] = cursor.referenced.get_usr()
            except:
                pass

    def _enrich_field_info(self, cursor: clang.cindex.Cursor, node: Dict[str, Any]):
        """[Enhanced] Extract field offsets for points-to analysis"""
        if cursor.kind == clang.cindex.CursorKind.FIELD_DECL:
            try:
                offset_bits = cursor.get_field_offsetof()
                if offset_bits >= 0:
                    node["offset_bits"] = offset_bits
                    node["offset_bytes"] = offset_bits // 8
            except:
                pass
        elif cursor.kind == clang.cindex.CursorKind.CXX_BASE_SPECIFIER:
            try:
                node["is_virtual_base"] = cursor.is_virtual_base()
                node["access_specifier"] = cursor.access_specifier.name
                node["type_full_name"] = cursor.type.spelling
            except:
                pass

    def _enrich_inheritance(self, cursor: clang.cindex.Cursor, node: Dict[str, Any]):
        """
        [New] 专门提取继承关系列表 (Base Classes)。
        使得 Parser 可以直接通过 node["inherits_from"] 获取继承链，而无需遍历 children。
        """
        if cursor.kind in [clang.cindex.CursorKind.STRUCT_DECL,
                           clang.cindex.CursorKind.CLASS_DECL]:
            inherits = []
            # LibClang 中，继承关系表现为当前 Class Cursor 的子节点，
            # 且子节点的 kind 为 CXX_BASE_SPECIFIER。
            # 这里进行一次浅层遍历即可。
            try:
                for child in cursor.get_children():
                    if child.kind == clang.cindex.CursorKind.CXX_BASE_SPECIFIER:
                        # child.type 指向基类的类型
                        # child.spelling 通常是 "class Foo"，child.type.spelling 是 "Foo" 或完整类型
                        base_name = child.type.spelling

                        # 如果需要更精确的规范名，可以使用:
                        # base_name = child.type.get_canonical().spelling

                        if base_name:
                            inherits.append(base_name)
            except Exception:
                pass

            if inherits:
                node["inherits_from"] = inherits

    def _enrich_designated_init(self, cursor: clang.cindex.Cursor, node: Dict[str, Any]):
        """
        支持标准 C99/C++20 的 .field = value 语法。
        """
        if cursor.kind.name == "DESIGNATED_INIT_EXPR":
            try:
                tokens = list(cursor.get_tokens())

                found_dot = False
                for token in tokens:
                    if token.spelling == '=':
                        break

                    # 只要识别 "." 即可，这是最安全的锚点
                    if token.spelling == '.':
                        found_dot = True
                        continue

                    if found_dot and token.kind == clang.cindex.TokenKind.IDENTIFIER:
                        node["designator_field"] = token.spelling
                        break
            except Exception:
                pass

    def _get_safe_cursor_id(self, cursor: clang.cindex.Cursor) -> Tuple:
        """[Safety] Avoid cursor.hash crash"""
        try:
            return (cursor.kind.value, cursor.extent.start.offset, cursor.extent.end.offset, cursor.spelling)
        except:
            return (object(),)

    def _collect_children_smart(self, cursor: clang.cindex.Cursor) -> List[Dict[str, Any]]:
        children_nodes = []
        processed_ids = set()
        current_order = 0  # [New] Global order counter

        # Strategy 1: Explicit Semantic Arguments
        if cursor.kind in [clang.cindex.CursorKind.FUNCTION_DECL,
                           clang.cindex.CursorKind.CXX_METHOD,
                           clang.cindex.CursorKind.CONSTRUCTOR]:
            try:
                args = list(cursor.get_arguments())
                for i, arg_cursor in enumerate(args):
                    safe_id = self._get_safe_cursor_id(arg_cursor)
                    if safe_id in processed_ids: continue

                    arg_node = self._serialize_recursive(arg_cursor)
                    arg_node["kind"] = "PARM_DECL"
                    arg_node["argument_index"] = i
                    arg_node["order"] = current_order
                    current_order += 1

                    children_nodes.append(arg_node)
                    processed_ids.add(safe_id)
            except Exception:
                pass

        # Strategy 2: Standard AST Traversal
        for child in cursor.get_children():
            safe_id = self._get_safe_cursor_id(child)
            if safe_id in processed_ids: continue

            should_visit = True
            if cursor.kind == clang.cindex.CursorKind.TRANSLATION_UNIT:
                should_visit = is_project_code(child, self.ctx.config)

            if should_visit:
                child_node = self._serialize_recursive(child)
                child_node["order"] = current_order
                current_order += 1

                children_nodes.append(child_node)
                processed_ids.add(safe_id)

        return children_nodes


def serialize_cursor(cursor: clang.cindex.Cursor, config: ASTExporterConfig,
                     source_bytes: Optional[bytes], main_filename: str) -> Optional[Dict[str, Any]]:
    ctx = AnalysisContext(config, source_bytes, main_filename)
    serializer = CursorSerializer(ctx)
    return serializer.serialize(cursor)


# ==============================================================================
# 8. Pipeline Execution
# ==============================================================================

def process_single_unit(cmd: Dict) -> Tuple[str, str]:
    global _worker_clang_index, _worker_config, _file_content_cache

    source_file = Path(cmd['file'])
    _file_content_cache.clear()

    source_content = b""
    try:
        with open(str(source_file), 'rb') as f:
            source_content = f.read()
    except Exception as e:
        logger.warning(f"Failed to read source {source_file}: {e}")

    try:
        os.chdir(cmd['directory'])
        args = cmd.get('arguments', shlex.split(cmd.get('command', '')))[1:]
        clean_args = clean_compile_args(args, source_file.name)

        # 0x01 DetailedPreprocessingRecord
        parse_options = 0x04 | 0x200

        tu = _worker_clang_index.parse(str(source_file), args=clean_args, options=parse_options)
        if not tu: return "ERROR", f"Parse failed: {source_file}"

        ast_json = serialize_cursor(tu.cursor, _worker_config, source_content, str(source_file.resolve()))
        if not ast_json: return "SKIPPED", f"Empty AST: {source_file}"

        file_hash = get_file_hash(cmd)
        rel_path = _normalize_cursor_path(tu.cursor, _worker_config) or source_file.name
        out_name = f"{Path(source_file.name).name}_{file_hash}.json.gz"
        out_path = _worker_config.output_dir / Path(rel_path).parent / out_name

        out_path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(out_path, 'wt', encoding='utf-8') as f:
            json.dump(ast_json, f, indent=None)

        return "SUCCESS", f"Exported: {source_file.name}"

    except Exception as e:
        # 即使这里 catch 了，底层 segfault 也会导致 worker 死掉
        # Faulthandler 会在 stderr 打印详情
        return "CRASH", f"Exception {source_file}: {e}"


def main():
    sys.setrecursionlimit(2000)
    parser = argparse.ArgumentParser(description="Parallel AST Exporter using LibClang")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--build-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--jobs", type=int, default=multiprocessing.cpu_count())
    parser.add_argument("--exclude", nargs='*', default=["*/test/*", "*/tests/*", "*/examples/*"])

    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    build_dir = Path(args.build_dir).resolve()
    pkg_root = Path(args.output_dir).resolve()

    artifacts_dir = pkg_root / "ast_artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"Exporting package to: {pkg_root}")

    src_db = build_dir / "compile_commands.json"
    dst_db = pkg_root / "compile_commands.json"

    if not src_db.exists():
        logger.error(f"compile_commands.json not found in {build_dir}")
        return

    try:
        shutil.copy2(src_db, dst_db)
    except Exception as e:
        logger.error(f"Failed to copy compile_commands.json: {e}")
        return

    with open(src_db, 'r') as f:
        commands = json.load(f)

    config = ASTExporterConfig(
        str(project_root),
        str(artifacts_dir),
        str(build_dir),
        args.exclude
    )

    tasks = []
    for cmd in commands:
        fpath = Path(cmd['file'])
        full_path = fpath.resolve() if fpath.is_absolute() else (Path(cmd['directory']) / fpath).resolve()

        if should_exclude(full_path, config): continue
        cmd['file'] = str(full_path)
        tasks.append(cmd)

    logger.info(f"Queued {len(tasks)} units. Workers: {args.jobs}")

    stats = {"SUCCESS": 0, "SKIPPED": 0, "ERROR": 0, "CRASH": 0}
    start_time = time.time()

    with ProcessPoolExecutor(max_workers=args.jobs, initializer=worker_initializer, initargs=(config,)) as exe:
        futures = {exe.submit(process_single_unit, cmd): cmd for cmd in tasks}

        for future in as_completed(futures):
            status, msg = future.result()
            stats[status] += 1

            if status != "SUCCESS":
                logger.warning(f"[{status}] {msg}")
            else:
                if stats["SUCCESS"] % 100 == 0:
                    logger.info(f"Progress: {stats['SUCCESS']}/{len(tasks)}")

    duration = time.time() - start_time
    logger.info(f"Done. Package ready at: {pkg_root}, completed in {duration:.2f}s. \nStats: {stats}")


if __name__ == "__main__":
    main()