# Audit Narrative: audit-spec-llm

## 范围
- **攻击模式**: direct_prompt_injection, tool_or_mcp_boundary, rag_source_trust, memory_or_tenant_isolation
- **步骤**: identify_prompt_inputs, identify_tool_and_mcp_boundaries, check_memory_and_tenant_isolation

## 目标文件 (10 个)
- src/app/api/agent/chat/route.ts
- src/app/api/agent/execute/route.ts
- src/lib/agent-executor.ts
- src/lib/agent-registry.ts
- src/lib/mcp-client.ts
- src/lib/mcp-loader.ts
- src/lib/model-client.ts
- src/lib/tool-executor.ts
- src/app/api/mcp-servers/test/route.ts
- src/app/api/mcp/route.ts

## 关键扩展阅读
- src/services/ai/claude-agent.ts (ClaudeAgentService 核心)
- src/services/evaluation/caller.ts (prompt 构建链)
- src/services/evaluation/enhanced-caller.ts (增强评估调用)
- src/services/evaluation/prompt.ts/PromptBuilder
- src/services/evaluation/history.ts (对话历史)
- src/app/api/projects/[id]/start/route.ts (MCP/CLAUDE.md 加载)

## 审计结果摘要

| 发现ID | 标题 | 严重度 | 置信度 |
|--------|------|--------|--------|
| LLM-001 | 用户消息直接注入 LLM Prompt (Prompt Injection) | HIGH | HIGH |
| LLM-002 | Skill Content 作为不受信系统提示词 | HIGH | HIGH |
| LLM-003 | MCP Local Stdio 任意命令执行 | HIGH | HIGH |
| LLM-004 | CLAUDE.md 文件注入系统提示词 | MEDIUM | HIGH |
| LLM-005 | 远程 MCP URL 无 SSRF 防护 | MEDIUM | HIGH |
| LLM-006 | Agent 默认工具集含 Bash 高危工具 | MEDIUM | MEDIUM |

## 已覆盖的攻击模式
- ✅ direct_prompt_injection - LLM-001, LLM-002, LLM-004
- ✅ tool_or_mcp_boundary - LLM-003, LLM-005, LLM-006
- ✅ rag_source_trust - LLM-002, LLM-004
- ✅ memory_or_tenant_isolation - 未确认对应 CVE 但识别到 gap

## 已完成的步骤
- ✅ identify_prompt_inputs - 识别 4 条用户控制数据进入 LLM Prompt 路径
- ✅ identify_tool_and_mcp_boundaries - 识别 MCP Local/SSE/HTTP 三种边界
- ✅ check_memory_and_tenant_isolation - 识别 agent 执行路由缺少租户隔离检查

## 关键发现详情

### LLM-001: 用户消息直接注入 LLM Prompt
用户通过 POST /api/agent/chat 发送的 message 字段，流经 EvaluationCaller.continueConversation → ConversationHistory.addUserMessage → PromptBuilder.buildMessages → prompt 字符串拼接 → ClaudeAgentService.sendPrompt → Claude SDK query()，**整个链路无任何输入消毒或注入检测**。攻击者构造特制 message 可覆盖系统指令、诱导 Agent 调用 Bash/Write/Edit 工具。

### LLM-002: Skill Content 直接作为系统提示词
AgentExecutor.buildPrompt() 使用 `skill.content || skill.description` 直接作为 System 消息发送。有 skill:create 权限的用户可创建含注入指令的 Skill，其内容自动获得系统提示词特权位置。

### LLM-003: MCP Local 任意命令执行
LocalMcpClient 通过 `child_process.spawn(command, args)` 执行用户 MCP 配置中的 command。无命令白名单、无参数过滤。AI 模型可通过 MCP 工具调用触发恶意命令执行。

## 攻击链
LLM-001 (prompt injection) + LLM-006 (Bash tool) = 系统命令执行
LLM-002 (skill injection) + LLM-006 (Bash tool) = 系统命令执行
LLM-003 (MCP spawn) → 直接命令执行
LLM-004 (CLAUDE.md injection) + LLM-006 (Bash tool) = 系统命令执行

## 跨 Agent 依赖
- 与 audit-spec-auth-access 协调：agent/chat 和 agent/execute 的 tenant 隔离检查
- 与 audit-spec-injection 协调：Skill import 的安全审查
- 与 audit-spec-rce 协调：MCP spawn + Bash execute 的 RCE 路径
