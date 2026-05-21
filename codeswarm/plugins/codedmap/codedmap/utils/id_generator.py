# codedmap\utils\id_generator.py
import hashlib
import struct
import time
import threading
from typing import Any


class SnowflakeGenerator:
    def __init__(self, machine_id: int = 1):
        self.machine_id = machine_id
        self.sequence = 0
        self.last_timestamp = -1
        
        self.sequence_bits = 12
        self.machine_id_bits = 10
        self.timestamp_bits = 41
        
        self.machine_id_shift = self.sequence_bits
        self.timestamp_shift = self.sequence_bits + self.machine_id_bits
        
        self.sequence_mask = (1 << self.sequence_bits) - 1
        self.machine_id_mask = (1 << self.machine_id_bits) - 1
        
        self._lock = threading.Lock()

    def _current_timestamp(self):
        return int(time.time() * 1000)

    def next_id(self) -> int:
        with self._lock:
            timestamp = self._current_timestamp()

            if timestamp < self.last_timestamp:
                raise Exception("Clock moved backwards!")

            if self.last_timestamp == timestamp:
                # 同一毫秒内，序列号自增
                self.sequence = (self.sequence + 1) & self.sequence_mask
                if self.sequence == 0:
                    # 溢出，等待下一毫秒
                    while timestamp <= self.last_timestamp:
                        timestamp = self._current_timestamp()
            else:
                # 不同毫秒，序列号重置
                self.sequence = 0

            self.last_timestamp = timestamp

            id_ = ((timestamp) << self.timestamp_shift) | \
                  (self.machine_id << self.machine_id_shift) | \
                  self.sequence
            return id_

# ==========================================
# 关键点：必须在模块级别实例化，确保单例
# ==========================================
_generator = SnowflakeGenerator(machine_id=1)

def generate_id() -> int:
    """全局 ID 生成入口"""
    return _generator.next_id()


# ------------------------------------------------------------------
# 策略 2: 确定性 ID (适用于 Shared Nodes)
# ------------------------------------------------------------------
def generate_deterministic_id(*args: Any) -> int:
    """
    生成基于内容的确定性 ID。

    改进点：
    1. 增加类型转字符串的稳定性 (None -> "")
    2. 使用分隔符防止前缀碰撞
    """
    # 1. 构造唯一的 Fingerprint
    # 这里我们使用 "|"，因为在代码语义中相对常见，但在组合键中配合位置信息足够安全

    normalized_args = []
    for arg in args:
        if arg is None:
            normalized_args.append("")
        else:
            normalized_args.append(str(arg))

    raw_key = "|".join(normalized_args)

    # 2. 计算 SHA-256
    m = hashlib.sha256()
    m.update(raw_key.encode('utf-8'))

    # 3. 提取前 8 个字节
    hash_bytes = m.digest()[:8]

    # 4. 解包
    val = struct.unpack(">Q", hash_bytes)[0]

    # 5. 确保为 63位 正整数 (兼容 Neo4j/Java Long)
    return val & 0x7FFFFFFFFFFFFFFF