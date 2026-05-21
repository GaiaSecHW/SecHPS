import sys
import os

sys.path.append(os.getcwd())

from codedmap.core.schema.graph.nodes import MethodNode, CallNode


def test_debug():
    print("--- Start Test ---")

    # 1. 测试 MethodNode (走 Declaration 分支)
    # 注意：这里不传 id，应该触发自动生成
    m = MethodNode(
        name="testFunc",
        fullName="testFunc",
        fileName="a.c",
        signature="int()",
        isExternal=False
    )
    print(f"Method ID Generated: {m.id}")

    # 2. 测试 CallNode (走 Structural 分支)
    c = CallNode(
        name="foo",
        fileName="a.c",
        lineNumber=10,
        dispatchType="STATIC_DISPATCH"
    )
    print(f"Call ID Generated: {c.id}")

    print("--- End Test ---")


if __name__ == "__main__":
    test_debug()