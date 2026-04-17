# Draft: Skill 数据源头追踪

## 关键数据模型

### 1. AgentDefinition（Skills 管理的核心）

```
model AgentDefinition {
  id              String    @id
  name            String    @unique
  displayName     String
  systemPrompt    String?   // Agent 的系统提示词
  allowedTools    String?   // 允许的工具（JSON）
  skills          String?   // ← 关键：关联的 Skill ID 列表（JSON）
  mcpServers      String?   // MCP 服务器配置
  isActive        Boolean
  ...
}
```

**这是 Skills 的管理入口！** AgentDefinition.skills 字段存储关联的 Skill ID。

### 2. AgentTeam（Agent 团队）

```
model AgentTeam {
  id           String  @id
  leadAgentId  String  // 主 Agent → AgentDefinition
  ...
}
```

### 3. AgentTeamMember（团队成员）

```
model AgentTeamMember {
  id             String  @id
  teamId         String
  agentId        String  // 关联 AgentDefinition
  overrideTools  String? // 覆盖工具配置
  // 注意：没有 overrideSkills 字段！
}
```

### 4. EvaluationSession（评估会话）

```
model EvaluationSession {
  agentTeamId  String?   // 关联 AgentTeam
  workflowId   String?   // 关联 Workflow
  skillsUsed   String?   // 使用的 Skills（JSON）
  ...
}
```

---

## 数据流追踪问题

### 问题：Skills 从哪里来？

**源头：AgentDefinition.skills**

```
AgentDefinition.skills (JSON: ["skill-id-1", "skill-id-2"])
    ↓
AgentTeam.leadAgentId → AgentDefinition
    ↓
AgentTeamMember.agentId → AgentDefinition
    ↓
EvaluationSession.agentTeamId → AgentTeam
    ↓
执行时读取 AgentDefinition.skills
```

---

## 待追踪

- [ ] AgentDefinition.skills 的读取位置
- [ ] Workflow + AgentTeam 的组合方式
- [ ] EvaluationSession 如何获取 Skills 列表
