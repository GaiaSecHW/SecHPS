# Claude SDK 数据架构设计

## 核心原则

**数据库只存储项目目录，所有会话数据通过 Claude SDK 实时获取**

## 数据库表（精简版）

### Project 表
```prisma
model Project {
  id            String   @id @default(cuid())
  name          String
  projectPath   String   @unique  // 核心字段：项目目录路径
  description   String?
  status        String   @default("idle")
  // ... 其他配置字段
}
```

### EvaluationSession 表
```prisma
model EvaluationSession {
  id                String   @id @default(cuid())
  projectId         String
  opencodeSessionId String?  @unique  // SDK 会话 ID
  workflowId        String?
  status            String   @default("pending")
  // ❌ 不存储消息、TODO 等 - 通过 SDK 获取
}
```

## SDK API 端点映射

### 1. 列出项目会话
**SDK**: `listSessions({ dir: projectPath })`
**用途**: 获取项目下所有会话
**返回**: 
```typescript
Array<{
  sessionId: string;
  title?: string;
  summary?: string;
  customTitle?: string;
  firstPrompt?: string;
  branch?: string;
  cwd: string;
  tag?: string;
}>
```

### 2. 获取会话消息
**SDK**: `getSessionMessages(sessionId, { dir: projectPath })`
**用途**: 获取会话的所有消息
**返回**: `SessionMessage[]`
**包含**:
- 用户消息
- AI 响应
- 工具调用（包括 TodoWrite）
- 工具结果

### 3. 提取 TODO 列表
**实现**: 从 `getSessionMessages()` 结果中过滤 TodoWrite
```typescript
const messages = await getSessionMessages(sessionId, { dir: projectPath });
const todoMessage = messages.find(m => 
  m.type === 'tool_use' && 
  (m.name === 'TodoWrite' || m.tool_name === 'TodoWrite')
);
const todos = todoMessage?.input?.todos || [];
```

### 4. 获取子代理会话
**SDK**: `listSubagents(sessionId, { dir: projectPath })`
**用途**: 获取主会话的子代理列表
**返回**: `string[]` - 子代理 ID 列表

### 5. 获取子代理消息
**SDK**: `getSubagentMessages(sessionId, agentId, { dir: projectPath })`
**用途**: 获取子代理的消息历史
**返回**: `SessionMessage[]`

### 6. 获取会话信息
**SDK**: `getSessionInfo(sessionId, { dir: projectPath })`
**用途**: 获取单个会话的详细信息
**返回**: `SDKSessionInfo | undefined`

## API 端点实现

### /api/projects/[id]/sessions
- 从数据库获取项目
- 使用 `listSessions({ dir: project.projectPath })`
- 返回会话列表

### /api/sessions/[id]/messages
- 从数据库获取评估会话（关联项目）
- 使用 `getSessionMessages(opencodeSessionId, { dir: project.projectPath })`
- 返回消息列表

### /api/sessions/[id]/todo
- 从数据库获取评估会话（关联项目）
- 使用 `getSessionMessages(opencodeSessionId, { dir: project.projectPath })`
- 过滤 TodoWrite 消息
- 返回 TODO 列表

### /api/sessions/[id]/children
- 从数据库获取评估会话（关联项目）
- 使用 `listSubagents(opencodeSessionId, { dir: project.projectPath })`
- 返回子代理 ID 列表

### /api/sessions/[id]
- 从数据库获取评估会话（关联项目）
- 使用 `getSessionInfo(opencodeSessionId, { dir: project.projectPath })`
- 返回会话详情

## 优势

1. ✅ **实时数据** - SDK 直接读取最新状态
2. ✅ **数据一致** - 不需要在数据库和文件间同步
3. ✅ **简化存储** - 数据库只存储核心业务数据
4. ✅ **SDK 原生** - 使用官方 API，稳定性更好
5. ✅ **完整功能** - SDK 提供完整的会话管理能力

## 实施步骤

1. ✅ 已修改 `/api/evaluations/[id]/messages` - 使用 SDK
2. ✅ 已修改 `/api/sessions/[id]/todo` - 使用 SDK
3. ⏳ 修改 `/api/sessions/[id]` - 使用 SDK
4. ⏳ 修改 `/api/sessions/[id]/children` - 使用 SDK
5. ⏳ 修改 `/api/projects/[id]/sessions` - 使用 SDK
