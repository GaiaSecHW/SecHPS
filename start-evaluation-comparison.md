# 启动评估 vs 创建会话 - 对比分析

## 📊 功能对比

你的理解是正确的！**AI4WEB 的启动评估功能与 CloudCLI UI 的创建会话功能在业务上是一致的**，都是启动一个新的 AI 会话进行交互。

### 核心功能对比

| 维度 | AI4WEB 启动评估 | CloudCLI UI 创建会话 | 一致性 |
|------|----------------|---------------------|--------|
| **业务目标** | 启动 AI 评估会话 | 启动 AI 交互会话 | ✅ 一致 |
| **SDK 集成** | AI4WEB SDK | Claude Agent SDK | ✅ 类似 |
| **会话管理** | EvaluationSession 表 | .jsonl 文件 | ⚠️ 存储不同 |
| **流式输出** | SSE (Server-Sent Events) | WebSocket | ✅ 类似 |
| **状态跟踪** | 数据库记录状态 | 文件追加 | ⚠️ 实现不同 |
| **消息存储** | SessionMessage 表 | .jsonl 文件 | ⚠️ 存储不同 |

---

## 🔍 详细实现对比

### 1. 会话创建流程

#### AI4WEB 启动评估

```typescript
// 1. 创建数据库会话记录
const evaluation = await prisma.evaluationSession.create({
  data: {
    projectId: id,
    workflowId: workflowId,
    status: 'running',
  }
});

// 2. 创建 SSE 流
const stream = new ReadableStream({
  async start(controller) {
    // 3. 调用 AI4WEB SDK
    await caller.startEvaluation(evaluation.id, {
      projectName: project.name,
      projectDescription: project.description,
      environmentUrl: project.environmentUrl,
      files,
      taskDescription,
      initialMessage,
      workflowName,
    }, {
      onChunk: (text) => {
        // 发送消息块
        controller.enqueue(`data: ${JSON.stringify({ type: 'message', content: text })}\n\n`);
      },
      onComplete: async () => {
        // 更新会话状态
        await prisma.evaluationSession.update({
          where: { id: evaluation.id },
          data: { status: 'completed', completedAt: new Date() }
        });
      }
    });
  }
});
```

#### CloudCLI UI 创建会话

```javascript
// 1. 直接调用 SDK（无数据库记录）
const queryInstance = query({
  prompt: finalCommand,
  options: sdkOptions
});

// 2. 流式处理消息
for await (const message of queryInstance) {
  // 捕获 session_id
  if (message.session_id && !capturedSessionId) {
    capturedSessionId = message.session_id;
    ws.send(createNormalizedMessage({ 
      kind: 'session_created', 
      newSessionId: capturedSessionId 
    }));
  }
  
  // 转换并发送消息
  const normalized = claudeAdapter.normalizeMessage(message, sessionId);
  for (const msg of normalized) {
    ws.send(msg);
  }
  
  // 3. 追加到 .jsonl 文件
  await fs.appendFile(
    getSessionFilePath(sessionId),
    JSON.stringify(message) + '\n'
  );
}
```

**关键差异**：
- AI4WEB：先创建数据库记录，后启动 SDK
- CloudCLI：先启动 SDK，捕获 session_id，后追加文件

---

### 2. SDK 调用方式

#### AI4WEB SDK 集成

```typescript
// 获取模型配置
const modelConfig = await getModelConfig();

// 创建增强版评估调用器
const caller = createEnhancedEvaluationCaller(modelConfig, project.projectPath);

// 调用评估
await caller.startEvaluation(evaluation.id, {
  projectName: project.name,
  files: project.files.map(f => ({
    name: f.fileName,
    type: f.fileType,
    size: f.fileSize,
  })),
  taskDescription: project.config?.taskDescription,
  initialMessage: workflowPreview,
}, {
  onChunk: (text) => { /* SSE 推送 */ },
  onComplete: () => { /* 更新状态 */ },
  onError: (error) => { /* 处理错误 */ }
});
```

#### CloudCLI UI SDK 集成

```javascript
// 映射 CLI 选项到 SDK 格式
const sdkOptions = mapCliOptionsToSDK(options);

// 加载 MCP 配置
const mcpServers = await loadMcpConfig(options.cwd);
if (mcpServers) {
  sdkOptions.mcpServers = mcpServers;
}

// 设置系统提示词
sdkOptions.systemPrompt = {
  type: 'preset',
  preset: 'claude_code'
};

// 设置 CLAUDE.md 加载源
sdkOptions.settingSources = ['project', 'user', 'local'];

// 恢复会话（如果有）
if (sessionId) {
  sdkOptions.resume = sessionId;
}

// 设置工具权限回调
sdkOptions.canUseTool = async (toolName, input, context) => {
  // 处理工具权限请求
  const decision = await waitForToolApproval(requestId);
  return decision.allow 
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: decision.message };
};

// 调用 SDK
const queryInstance = query({
  prompt: finalCommand,
  options: sdkOptions
});
```

**关键差异**：
- AI4WEB：封装在 `createEnhancedEvaluationCaller` 中，更高级的抽象
- CloudCLI：直接使用原始 SDK，配置更细粒度

---

### 3. 流式输出方式

#### AI4WEB SSE 流

```typescript
// Server-Sent Events
const stream = new ReadableStream({
  async start(controller) {
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
      type: 'message',
      content: text,
      timestamp: Date.now(),
    })}\n\n`));
  }
});

return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  },
});
```

#### CloudCLI WebSocket 流

```javascript
// WebSocket 实时推送
for await (const message of queryInstance) {
  ws.send(createNormalizedMessage({
    kind: 'message',
    sessionId,
    content: message
  }));
}
```

**关键差异**：
- AI4WEB：SSE（单向，服务器推送）
- CloudCLI：WebSocket（双向，实时通信）

---

### 4. 会话状态管理

#### AI4WEB 数据库管理

```typescript
// 创建会话记录
await prisma.evaluationSession.create({
  data: {
    projectId: id,
    status: 'running',
    startedAt: new Date(),
  }
});

// 更新状态
await prisma.evaluationSession.update({
  where: { id: evaluation.id },
  data: {
    status: 'completed',
    completedAt: new Date(),
  }
});

// 保存消息
await prisma.sessionMessage.create({
  data: {
    evaluationSessionId: evaluation.id,
    role: 'assistant',
    content: message,
  }
});
```

#### CloudCLI 文件管理

```javascript
// 追加消息到 .jsonl 文件
await fs.appendFile(
  getSessionFilePath(sessionId),
  JSON.stringify(message) + '\n'
);

// 读取会话历史
const fileStream = fs.createReadStream(filePath);
const rl = readline.createInterface({ input: fileStream });

for await (const line of rl) {
  const message = JSON.parse(line);
  messages.push(message);
}
```

**关键差异**：
- AI4WEB：结构化数据库存储，支持复杂查询
- CloudCLI：文件追加存储，简单高效

---

## 🎯 架构对比总结

### AI4WEB 架构

```
用户请求
  ↓
POST /api/projects/[id]/start
  ↓
创建 EvaluationSession (数据库)
  ↓
调用 AI4WEB SDK
  ↓
SSE 流式输出
  ↓
保存 SessionMessage (数据库)
  ↓
更新 EvaluationSession 状态
```

### CloudCLI UI 架构

```
用户请求
  ↓
WebSocket 连接
  ↓
调用 Claude Agent SDK
  ↓
WebSocket 流式输出
  ↓
追加到 .jsonl 文件
  ↓
捕获 session_id
```

---

## 💡 关键差异分析

### 1. 存储策略

| 维度 | AI4WEB | CloudCLI UI |
|------|--------|-------------|
| **会话元数据** | 数据库 EvaluationSession 表 | .jsonl 文件名 |
| **消息历史** | 数据库 SessionMessage 表 | .jsonl 文件内容 |
| **查询能力** | ✅ 强大的 SQL 查询 | ❌ 需要文件扫描 |
| **事务支持** | ✅ ACID 事务 | ❌ 无事务 |
| **性能** | ⚠️ 数据库写入开销 | ✅ 文件追加极快 |
| **备份** | ✅ 数据库导出 | ✅ 文件复制 |
| **扩展性** | ✅ 支持多租户 | ❌ 单用户 |

### 2. SDK 集成策略

| 维度 | AI4WEB | CloudCLI UI |
|------|--------|-------------|
| **封装层次** | 高级封装（EvaluationCaller） | 原始 SDK |
| **配置灵活性** | ⚠️ 较少配置选项 | ✅ 完整 SDK 配置 |
| **MCP 支持** | ❌ 未集成 | ✅ 完整支持 |
| **会话恢复** | ⚠️ 通过数据库 | ✅ SDK 原生支持 |
| **工具权限** | ⚠️ 简化处理 | ✅ 完整权限系统 |
| **系统提示词** | ⚠️ 自定义配置 | ✅ CLAUDE.md 支持 |

### 3. 流式输出策略

| 维度 | AI4WEB | CloudCLI UI |
|------|--------|-------------|
| **协议** | SSE | WebSocket |
| **方向** | 单向（服务器推送） | 双向（实时通信） |
| **连接管理** | 简单 | 复杂（需要心跳、重连） |
| **浏览器支持** | ✅ 原生支持 | ✅ 原生支持 |
| **适用场景** | 单向数据流 | 双向交互 |

---

## 🔧 改进建议

### 针对 AI4WEB 的优化建议

#### 1. 增强 SDK 集成（参考 CloudCLI）

```typescript
// 添加 MCP 配置支持
async function loadMcpConfig(projectPath: string) {
  const claudeConfigPath = path.join(os.homedir(), '.claude.json');
  const configContent = await fs.readFile(claudeConfigPath, 'utf8');
  const claudeConfig = JSON.parse(configContent);
  
  let mcpServers = {};
  
  // 全局 MCP 服务器
  if (claudeConfig.mcpServers) {
    mcpServers = { ...claudeConfig.mcpServers };
  }
  
  // 项目特定 MCP 服务器
  if (claudeConfig.claudeProjects && projectPath) {
    const projectConfig = claudeConfig.claudeProjects[projectPath];
    if (projectConfig?.mcpServers) {
      mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
    }
  }
  
  return Object.keys(mcpServers).length > 0 ? mcpServers : null;
}

// 增强 SDK 选项
const sdkOptions = {
  cwd: project.projectPath,
  model: modelConfig.model,
  
  // 添加系统提示词配置
  systemPrompt: {
    type: 'preset',
    preset: 'claude_code'
  },
  
  // 添加设置源
  settingSources: ['project', 'user', 'local'],
  
  // 添加 MCP 服务器
  mcpServers: await loadMcpConfig(project.projectPath),
  
  // 添加工具权限处理
  canUseTool: async (toolName, input, context) => {
    // 处理工具权限请求
    const decision = await handleToolPermission(toolName, input);
    return decision.allow 
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: decision.message };
  }
};
```

#### 2. 添加会话恢复支持

```typescript
// 在 EvaluationSession 模型中添加 opencodeSessionId 字段
model EvaluationSession {
  id               String   @id
  opencodeSessionId String? @unique  // SDK 会话 ID
  // ...
}

// 在启动评估时恢复会话
if (existingSession?.opencodeSessionId) {
  sdkOptions.resume = existingSession.opencodeSessionId;
}
```

#### 3. 添加 CLAUDE.md 支持

```typescript
// 在项目中添加 CLAUDE.md 支持
async function loadProjectClaudeMd(projectPath: string) {
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  try {
    const content = await fs.readFile(claudeMdPath, 'utf8');
    return content;
  } catch {
    return null;
  }
}

// 将 CLAUDE.md 作为系统提示词的一部分
const projectClaudeMd = await loadProjectClaudeMd(project.projectPath);
if (projectClaudeMd) {
  sdkOptions.systemPrompt = {
    type: 'custom',
    content: projectClaudeMd
  };
}
```

#### 4. 添加工具权限管理

```typescript
// 在数据库中存储工具权限规则
model ToolPermission {
  id          String   @id
  projectId   String
  toolName    String   // 工具名称或模式（如 Bash(npm:*)）
  permission  String   // allow | deny
  createdAt   DateTime @default(now())
  
  project     Project  @relation(...)
  
  @@unique([projectId, toolName])
}

// 在 SDK 调用时使用
async function checkToolPermission(projectId: string, toolName: string, input: any) {
  const permissions = await prisma.toolPermission.findMany({
    where: { projectId }
  });
  
  for (const perm of permissions) {
    if (matchesToolPermission(perm.toolName, toolName, input)) {
      return perm.permission === 'allow';
    }
  }
  
  // 默认行为：请求用户批准
  return 'request';
}
```

---

## 📊 总结

### 业务一致性 ✅

**AI4WEB 的启动评估功能与 CloudCLI UI 的创建会话功能在业务上完全一致**：
- 都是启动一个新的 AI 会话
- 都是调用 SDK 进行交互
- 都是流式输出结果
- 都是跟踪会话状态

### 架构差异 ⚠️

主要差异在于实现方式：
1. **存储策略**：AI4WEB 使用数据库，CloudCLI 使用文件系统
2. **SDK 集成**：AI4WEB 封装更高层，CloudCLI 更接近原始 SDK
3. **流式输出**：AI4WEB 使用 SSE，CloudCLI 使用 WebSocket
4. **配置灵活性**：CloudCLI 提供更细粒度的 SDK 配置

### 改进方向 🎯

AI4WEB 可以借鉴 CloudCLI 的以下优点：
1. 添加 MCP 配置支持
2. 添加 CLAUDE.md 支持
3. 添加会话恢复功能
4. 添加工具权限管理系统
5. 增强系统提示词配置

这些改进可以让 AI4WEB 的启动评估功能更加强大和灵活！
