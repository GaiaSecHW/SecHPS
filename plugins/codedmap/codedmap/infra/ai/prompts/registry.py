from enum import Enum

class PromptTemplate(str, Enum):
    # System Prompts
    MACRO_ANALYSIS_SYSTEM = "macro_analysis_system.j2"
    MODULE_SUMMARY_SYSTEM = "module_summary_system.j2"
    RESOLVER_SYSTEM = "resolver_system.j2"
    SEMANTIC_SYSTEM = "semantic_system.j2"
    LIB_SUMMARY_SYSTEM = "lib_summary_system.j2"
    SECURITY_TAGGING_SYSTEM = "security_tagging_system.j2"
    
    # User Prompts (如果 User Input 也很复杂，也可以模板化)
    MACRO_ANALYSIS_USER = "macro_analysis_user.j2"
    MODULE_SUMMARY_USER = "module_summary_user.j2"
    RESOLVER_USER = "resolver_user.j2"
    SEMANTIC_USER = "semantic_user.j2"
    LIB_SUMMARY_USER = "lib_summary_user.j2"
    SECURITY_TAGGING_USER = "security_tagging_user.j2"

    DISPATCH_CRITIC_SYSTEM = "dispatch_critic_system.j2"
    DISPATCH_CRITIC_USER = "dispatch_critic_user.j2"

    SYNTAX_HEALER_SYSTEM = "syntax_healer_system.j2"
    SYNTAX_HEALER_USER = "syntax_healer_user.j2"