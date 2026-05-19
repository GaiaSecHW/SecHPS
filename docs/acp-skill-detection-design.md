# ACP Skill 执行检测设计

## 背景

CodeSwarm Worker 使用 ACP (Agent Client Protocol) 与 OpenCode 通信。OpenCode Agent 在执行任务时会加载 skill（通过内置 `skill` 工具），但当前事件流中无法区分 Agent 正在执行哪个 skill。

**目标**：在 Worker 事件流中检测 skill 切换，让前端日志能清晰展示 "当前正在执行哪个 skill"。

## 现状分析

### 事件流架构

```
OpenCode (ACP Agent)
  → ACP SDK (session/update notifications)
    → ACPClient (codeswarm/packages/acp/src/index.ts)
      → ProcessManager (codeswarm/packages/worker/src/process-manager.ts)
        → Daemon (codeswarm/packages/worker/src/daemon.ts)
          → POST /api/codeswarm/worker/event
            → Event Route (src/app/api/codeswarm/worker/event/route.ts)
              → CodeswarmEvent DB + TaskExecutionLog DB + Redis pub/sub
                → 前端 SSE 展示
```

### OpenCode skill 工具

OpenCode 内置 `skill` 工具（文档：https://opencode.ai/docs/tools/），功能是 "Load a skill (a SKILL.md file) and return its content in the conversation"。

当 LLM 调用 skill 工具时，ACP 协议会发出 `tool_call` session update：

```json
{
  "sessionUpdate": "tool_call",
  "toolCallId": "call_xxx",
  "title": "skill",
  "kind": "other",
  "status": "pending",
  "rawInput": { "name": "vulnerability-scanner" }
}
```

- `kind`：ACP 标准分类（read/edit/delete/move/search/execute/think/fetch/other），skill 不在标准类别中，通常为 `"other"`
- `title`：工具标题，OpenCode 的 skill 工具会设为 `"skill"`
- `rawInput`：skill 参数，包含 skill 名称

### 当前问题

1. **ACP Client 信息丢失**（`codeswarm/packages/acp/src/index.ts:268`）：

```typescript
const kind = update.kind || update.title || '';
this.eventHandlers.toolCall?.(kind, update.rawInput || {});
```

只传了 `kind || title`，`title` 被 `kind` 遮蔽（`"other"` 优先），且 `kind` 和 `title` 没有分开传递。

2. **ProcessManager 无 skill 感知**（`codeswarm/packages/worker/src/process-manager.ts:156`）：

```typescript
toolCall: (tool: string, input: unknown) => {
  onEvent({ type: 'tool_call', tool, input, timestamp });
}
```

只透传 `tool_call` 事件，不做任何 skill 检测。

3. **Event Route 无 skill 事件处理**（`src/app/api/codeswarm/worker/event/route.ts`）：

日志映射表中没有 skill 相关的 event type。

4. **前端无 skill 执行展示**：Task Detail 页面展示了 skills 配置，但日志中没有 skill 执行阶段的区分。

## 设计方案

### 改动范围

| 层 | 文件 | 改动 |
|---|---|---|
| ACP Client | `codeswarm/packages/acp/src/index.ts` | 扩展 `toolCall` 回调，分离 `kind`、`title`、`rawInput` |
| ProcessManager | `codeswarm/packages/worker/src/process-manager.ts` | 检测 skill 调用，发出 `skill_start`/`skill_complete` 事件 |
| Event Route | `src/app/api/codeswarm/worker/event/route.ts` | 处理 `skill_start` 事件，生成 skill 日志 |
| AgentEvent 类型 | `codeswarm/packages/worker/src/process-manager.ts` | 新增 `skill_start`/`skill_complete` 事件类型 |
| 前端日志展示 | `src/app/dashboard/task-builder/[id]/page.tsx` | LogsGroupedDisplay 中新增 Skill 执行分组 |

### Phase 1：ACP Client 扩展

**文件**：`codeswarm/packages/acp/src/index.ts`

扩展 `toolCall` 回调签名，传递完整信息：

```typescript
// 改动前
export interface ACPClientEvents {
  toolCall: (tool: string, input: unknown) => void;
}

// 改动后
export interface ACPClientEvents {
  toolCall: (tool: string, input: unknown, title?: string) => void;
}
```

`handleSessionUpdate` 中：

```typescript
case 'tool_call': {
  const kind = update.kind || update.title || '';
  const title = update.title || '';
  this.eventHandlers.toolCall?.(kind, update.rawInput || {}, title);
  break;
}
```

### Phase 2：ProcessManager skill 检测

**文件**：`codeswarm/packages/worker/src/process-manager.ts`

新增事件类型：

```typescript
export type AgentEventType =
  | 'agent_message_chunk'
  | 'tool_call'
  | 'tool_call_update'
  | 'error'
  | 'phase_start'
  | 'phase_complete'
  | 'phase_error'
  | 'log_chunk'
  | 'session_created'
  | 'skill_start'       // 新增
  | 'skill_complete';   // 新增
```

扩展 `AgentEvent` 接口：

```typescript
export interface AgentEvent {
  // ... 现有字段
  skill?: string;  // skill 名称（skill_start/skill_complete 事件使用）
}
```

skill 检测逻辑（在 `runAgent` 的 `toolCall` handler 中）：

```typescript
// 需要跟踪当前 skill
let currentSkill: string | null = null;

toolCall: (tool: string, input: unknown, title?: string) => {
  // 检测 skill 调用：title 或 kind 为 "skill"，或 input 中包含 skill 标识
  const isSkillCall = title === 'skill' || tool === 'skill'
    || (typeof input === 'object' && input !== null && 'skill' in input);

  if (isSkillCall) {
    const skillName = extractSkillName(input) || 'unknown';

    // 如果有上一个 skill，先发出完成事件
    if (currentSkill && currentSkill !== skillName) {
      onEvent?.({
        type: 'skill_complete',
        skill: currentSkill,
        timestamp: new Date().toISOString(),
      });
    }

    currentSkill = skillName;
    onEvent?.({
      type: 'skill_start',
      skill: skillName,
      content: `开始执行 Skill: ${skillName}`,
      timestamp: new Date().toISOString(),
    });
  }

  // 仍然发出原始 tool_call 事件（保持向后兼容）
  onEvent?.({
    type: 'tool_call',
    tool,
    input,
    timestamp: new Date().toISOString(),
  });
},
```

skill 名称提取函数：

```typescript
function extractSkillName(input: unknown): string | null {
  if (typeof input === 'object' && input !== null) {
    // OpenCode skill 工具的 input 格式
    if ('name' in input && typeof input.name === 'string') return input.name;
    if ('skill' in input && typeof input.skill === 'string') return input.skill;
    if ('id' in input && typeof input.id === 'string') return input.id;
  }
  if (typeof input === 'string') return input;
  return null;
}
```

runAgent 结束时，如果还有未完成的 skill，发出完成事件：

```typescript
// 在 runAgent 的 finally 块或成功返回前
if (currentSkill && onEvent) {
  onEvent({
    type: 'skill_complete',
    skill: currentSkill,
    timestamp: new Date().toISOString(),
  });
  currentSkill = null;
}
```

### Phase 3：Event Route 处理

**文件**：`src/app/api/codeswarm/worker/event/route.ts`

在事件到日志的映射表中新增：

```typescript
} else if (eventType === 'skill_start') {
  message = 'Skill 执行';
  details = eventData.skill
    ? `开始执行 Skill: ${eventData.skill}`
    : (eventData.content || '');
  level = 'info';
} else if (eventType === 'skill_complete') {
  message = 'Skill 完成';
  details = eventData.skill
    ? `Skill 执行完成: ${eventData.skill}`
    : '';
  level = 'info';
}
```

### Phase 4：前端展示（可选）

**文件**：`src/app/dashboard/task-builder/[id]/page.tsx`

在 `LogsGroupedDisplay` 中新增 skill 执行分组：

```typescript
// 在现有分组（Agent Output、Tool Calls、Errors、Timeline）基础上新增：
const skillLogs = logs.filter(
  l => l.message === 'Skill 执行' || l.message === 'Skill 完成'
);

// 渲染为独立的可折叠面板，展示 skill 执行时间线
```

或在现有的 Execution Timeline 中用不同颜色高亮 skill 事件。

## 检测准确性分析

| 场景 | 能否检测 | 说明 |
|---|---|---|
| Agent 加载 skill | ✅ | tool_call 中 title/kind 为 "skill"，input 含 skill 名 |
| Agent 切换 skill | ✅ | 新的 skill tool_call 触发，自动发出上一个 skill_complete |
| Agent 隐式使用 skill（未调用 tool） | ❌ | 如果 skill 已在上下文中，Agent 不会再次调用 skill tool |
| Agent 不使用任何 skill | ✅ | 不会收到 skill 类型的 tool_call，无 skill_start 事件 |

**局限性**：skill 加载是一次性的（加载后内容留在对话上下文中），后续 Agent 可能持续使用 skill 内容而不再次调用 skill tool。因此 `skill_start` 代表 "skill 被加载到上下文"，而非 "skill 正在被活跃执行"。

## 兼容性

- 新增的 `skill_start`/`skill_complete` 事件不影响现有事件流
- ACP client 的 `toolCall` 回调新增可选参数 `title`，向后兼容
- Event Route 的 else-if 链新增分支，不影响其他事件处理
- 前端改动独立于现有日志分组，不破坏已有功能

## 实施计划

1. Phase 1 + Phase 2（Worker 端）：修改 ACP Client 和 ProcessManager，Worker 端开始发出 skill 事件
2. Phase 3（后端）：Event Route 处理新事件
3. Phase 4（前端，可选）：UI 展示 skill 执行时间线
