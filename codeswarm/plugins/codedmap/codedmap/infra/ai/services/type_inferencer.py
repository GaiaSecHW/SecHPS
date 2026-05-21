from typing import Optional
from pydantic import BaseModel, Field
from codedmap.infra.ai.client import BaseAgent
from codedmap.infra.ai.prompts.manager import prompt_manager
from codedmap.infra.ai.prompts.registry import PromptTemplate

class TypeInferenceResult(BaseModel):
    inferred_type: str = Field(..., description="The inferred C/C++ type (e.g. 'struct inode *').")
    confidence: float = Field(..., description="Confidence score.")
    reasoning: str = Field(..., description="Evidence derived from code usage.")

class TypeInferenceAgent(BaseAgent):
    """
    [Type System Enhancer] 工业级类型推导 Agent。
    """
    
    def infer(self, variable_name: str, usage_slice: str) -> TypeInferenceResult:
        sys_content = prompt_manager.render(
            PromptTemplate.TYPE_INFERENCE_SYSTEM, 
            variable_name=variable_name
        )
        
        user_content = prompt_manager.render(
            PromptTemplate.TYPE_INFERENCE_USER,
            variable_name=variable_name,
            usage_slice=usage_slice
        )
        
        try:
            return self.predict(
                [{"role": "system", "content": sys_content}, 
                 {"role": "user", "content": user_content}],
                response_model=TypeInferenceResult
            )
        except Exception:
            return TypeInferenceResult(inferred_type="ANY", confidence=0.0, reasoning="Error")