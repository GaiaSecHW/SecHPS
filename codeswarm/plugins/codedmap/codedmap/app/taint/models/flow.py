# codedmap/app/taint/models/flow.py

from typing import List
from pydantic import BaseModel, Field

from codedmap.core.schema.graph.nodes import AstNode

class TaintStep(BaseModel):
    """
    污点传播路径中的单一步骤。
    """
    node: AstNode
    description: str = Field(default="", description="步骤描述，如 'arg 1 of memcpy'")

    def __hash__(self):
        return hash(self.node.id)

class TaintFlow(BaseModel):
    """
    一条完整的从 Source 到 Sink 的污点传播路径。
    """
    source: TaintStep
    sink: TaintStep
    path: List[TaintStep] = Field(default_factory=list)
    confidence: float = Field(default=1.0, description="置信度")

    def __str__(self):
        if not self.path:
            return "Empty Flow"

        lines = ["=== Taint Flow Detected ==="]
        lines.append(f"Source: {self.source.node.label}({self.source.node.id}) code=`{self.source.node.get_code()}`")

        for i, step in enumerate(self.path):
            code = step.node.get_code()
            if code:
                code = code.strip()
                # 截断过长的代码
                if len(code) > 50: code = code[:47] + "..."
                lines.append(f"  {i+1}. [{step.node.label}] ID:{step.node.id} | {code}")

        lines.append(f"Sink: {self.sink.node.label}({self.sink.node.id}) code=`{self.sink.node.get_code()}`")
        lines.append("===========================")
        return "\n".join(lines)
