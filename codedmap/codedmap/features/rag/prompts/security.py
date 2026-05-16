# codedmap/features/rag/prompts/security.py

try:
    from llama_index.core import PromptTemplate
except ImportError:
    PromptTemplate = None

# [System Prompt] 保持不变，强调角色和输出格式
VULN_ANALYSIS_SYSTEM_PROMPT = """
You are a senior security researcher specializing in Linux Kernel vulnerability discovery.
Your goal is to analyze the provided code context (Source Code + Call Graph + Data Definitions) to identify potential vulnerabilities.

Response Requirements:
1. Output MUST be a structured JSON object if requested, or a detailed Markdown report.
2. Focus on specific CWEs: Buffer Overflow, Use-After-Free, Integer Overflow, Race Condition, Injection.
3. If the context is insufficient to determine a vulnerability, explicitly state what is missing.
"""

# [Modified] 结合图上下文的分析 Prompt
# 变更点：
# 1. 新增 {used_types}: 用于展示结构体定义，辅助判断缓冲区溢出。
# 2. 新增 {literals}: 用于展示硬编码字符串，辅助判断 SQL注入/Command注入/密钥泄露。
# 3. 结构优化: 将上下文分为 "Code", "Flow", "Data Definitions" 三个板块。

if PromptTemplate is not None:
    GRAPH_CONTEXT_TEMPLATE = PromptTemplate(
        """
        You are analyzing a specific code entity with augmented Graph Context.
        
        ### 1. TARGET ENTITY
        **Function**: {target_name} (ID: {node_id})
        **File**: {file_path}
        
        ### 2. SOURCE CODE (Primary Truth)
        ```c
        {source_code}
        ```
        
        ### 3. GRAPH CONTEXT (Augmented Knowledge)
        The following information is retrieved from the Code Property Graph (CPG) to help you understand the surroundings.
        
        #### A. Control Flow Context
        * **Callers (Who calls this?)**: 
            {callers}
            *(Hint: Check if these callers pass untrusted user input.)*
            
        * **Callees (What does this call?)**: 
            {callees}
            *(Hint: Check if any of these are sensitive Sinks, e.g., memcpy, system, exec.)*
        
        #### B. Data Definitions & Constants
        * **Referenced Types (Struct/Class Definitions)**:
            {used_types}
            *(Hint: Use this to verify structure member offsets and buffer sizes.)*
            
        * **Hardcoded Literals**:
            {literals}
            *(Hint: Look for hardcoded credentials, SQL fragments, or format strings.)*
        
        ### 4. USER QUERY
        {query_str}
        
        ### 5. ANALYSIS INSTRUCTIONS
        Based on the Source Code and the Graph Context above, answer the query. 
        If referencing a specific caller or type definition, quote it explicitly.
        """
    )
else:
    GRAPH_CONTEXT_TEMPLATE = None