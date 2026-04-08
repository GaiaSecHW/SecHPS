# Claude SDK 学习总结

## 项目架构概览

CloudCLI UI 是一个基于 Web 的 Claude Code CLI 界面，支持多 Agent（Claude Code、Cursor CLI、Codex、Gemini CLI）。

### 技术栈
- **前端**: React 18 + TypeScript + Vite + Tailwind CSS
- **后端**: Express.js + WebSocket
- **数据库**: SQLite (better-sqlite3)
- **SDK**: @anthropic-ai/claude-agent-sdk

---

## 核心功能实现

### 1. Claude SDK 调用方式

#### SDK 初始化与查询 (`server/claude-sdk.js`)

```javascript
import { query } from '@anthropic-ai/claude-agent-sdk';

// 核心查询函数
async function queryClaudeSDK(command, options = {}, ws) {
  const sdkOptions = mapCliOptionsToSDK(options);
  
  // 加载 MCP 配置
  const mcpServers = await loadMcpConfig(options.cwd);
  if (mcpServers) {
    sdkOptions.mcpServers = mcpServers;
  }
  
  // 处理图片
  const imageResult = await handleImages(command, options.images, options.cwd);
  const finalCommand = imageResult.modifiedCommand;
  
  // 创建查询实例
  const queryInstance = query({
    prompt: finalCommand,
    options: sdkOptions
  });
  
  // 流式处理消息
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
  }
}
```

#### SDK 选项映射

```javascript
function mapCliOptionsToSDK(options = {}) {
  const sdkOptions = {};
  
  // 工作目录
  if (options.cwd) {
    sdkOptions.cwd = options.cwd;
  }
  
  // 权限模式
  if (options.permissionMode === 'bypassPermissions') {
    sdkOptions.permissionMode = 'bypassPermissions';
  }
  
  // 工具设置
  sdkOptions.allowedTools = options.toolsSettings?.allowedTools || [];
  sdkOptions.disallowedTools = options.toolsSettings?.disallowedTools || [];
  
  // 模型选择
  sdkOptions.model = options.model || 'sonnet';
  
  // 系统提示词配置（加载 CLAUDE.md）
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'
  };
  
  // 设置源（加载项目、用户、本地配置）
  sdkOptions.settingSources = ['project', 'user', 'local'];
  
  // 恢复会话
  if (options.sessionId) {
    sdkOptions.resume = options.sessionId;
  }
  
  return sdkOptions;
}
```

#### MCP 配置加载

```javascript
async function loadMcpConfig(cwd) {
  const claudeConfigPath = path.join(os.homedir(), '.claude.json');
  const configContent = await fs.readFile(claudeConfigPath, 'utf8');
  const claudeConfig = JSON.parse(configContent);
  
  let mcpServers = {};
  
  // 全局 MCP 服务器
  if (claudeConfig.mcpServers) {
    mcpServers = { ...claudeConfig.mcpServers };
  }
  
  // 项目特定 MCP 服务器
  if (claudeConfig.claudeProjects && cwd) {
    const projectConfig = claudeConfig.claudeProjects[cwd];
    if (projectConfig?.mcpServers) {
      mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
    }
  }
  
  return Object.keys(mcpServers).length > 0 ? mcpServers : null;
}
```

#### 工具权限处理

```javascript
sdkOptions.canUseTool = async (toolName, input, context) => {
  // 需要交互的工具（如 AskUserQuestion）
  const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);
  
  // 检查是否被禁止
  const isDisallowed = sdkOptions.disallowedTools.some(entry =>
    matchesToolPermission(entry, toolName, input)
  );
  
  // 检查是否已允许
  const isAllowed = sdkOptions.allowedTools.some(entry =>
    matchesToolPermission(entry, toolName, input)
  );
  
  if (isAllowed) {
    return { behavior: 'allow', updatedInput: input };
  }
  
  // 需要用户批准
  const requestId = createRequestId();
  ws.send(createNormalizedMessage({ 
    kind: 'permission_request', 
    requestId, 
    toolName, 
    input 
  }));
  
  // 等待用户决策
  const decision = await waitForToolApproval(requestId, {
    timeoutMs: requiresInteraction ? 0 : 55000,
    signal: context?.signal
  });
  
  return decision.allow 
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: decision.message };
};
```

---

### 2. 项目管理

#### 项目发现 (`server/projects.js`)

```javascript
// Claude 项目存储在 ~/.claude/projects/
// 每个项目是一个目录，名称是项目路径的编码（/ 替换为 -）
// 包含 .jsonl 文件，存储会话历史

async function discoverClaudeProjects() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const projects = [];
  
  const projectDirs = await fs.readdir(claudeDir);
  
  for (const dir of projectDirs) {
    const projectPath = path.join(claudeDir, dir);
    const stats = await fs.stat(projectPath);
    
    if (stats.isDirectory()) {
      // 从 .jsonl 文件中提取 cwd（项目路径）
      const sessions = await fs.readdir(projectPath);
      const jsonlFiles = sessions.filter(f => f.endsWith('.jsonl'));
      
      let projectFullPath = null;
      if (jsonlFiles.length > 0) {
        // 读取第一个会话文件获取 cwd
        const firstSession = path.join(projectPath, jsonlFiles[0]);
        const lineReader = readline.createInterface({
          input: fsSync.createReadStream(firstSession)
        });
        
        for await (const line of lineReader) {
          const entry = JSON.parse(line);
          if (entry.cwd) {
            projectFullPath = entry.cwd;
            break;
          }
        }
      }
      
      // 如果没有 cwd，从目录名解码
      if (!projectFullPath) {
        projectFullPath = dir.replace(/-/g, '/');
      }
      
      projects.push({
        name: path.basename(projectFullPath),
        fullPath: projectFullPath,
        sessions: await getProjectSessions(dir)
      });
    }
  }
  
  return projects;
}
```

#### 会话管理

```javascript
// 会话存储在 ~/.claude/projects/{encoded-project-path}/{session-id}.jsonl
// 每行是一个 JSON 对象，包含会话消息

async function getProjectSessions(projectDir) {
  const sessions = [];
  const projectPath = path.join(os.homedir(), '.claude', 'projects', projectDir);
  const files = await fs.readdir(projectPath);
  
  for (const file of files) {
    if (file.endsWith('.jsonl')) {
      const sessionId = file.replace('.jsonl', '');
      const filePath = path.join(projectPath, file);
      const stats = await fs.stat(filePath);
      
      // 读取第一行获取会话摘要
      const firstLine = await readFirstLine(filePath);
      const firstEntry = JSON.parse(firstLine);
      
      sessions.push({
        id: sessionId,
        title: firstEntry.message?.content || 'New Session',
        created_at: stats.birthtime,
        updated_at: stats.mtime,
        messageCount: await countLines(filePath)
      });
    }
  }
  
  return sessions.sort((a, b) => b.updated_at - a.updated_at);
}
```

---

### 3. 前端 API 调用

#### API 客户端 (`src/utils/api.js`)

```javascript
// 获取所有项目
projects: () => authenticatedFetch('/api/projects'),

// 获取项目会话（分页）
sessions: (projectName, limit = 5, offset = 0) =>
  authenticatedFetch(`/api/projects/${projectName}/sessions?limit=${limit}&offset=${offset}`),

// 获取会话消息（统一接口，支持多 Agent）
unifiedSessionMessages: (sessionId, provider = 'claude', { 
  projectName = '', 
  projectPath = '', 
  limit = null, 
  offset = 0 
} = {}) => {
  const params = new URLSearchParams();
  params.append('provider', provider);
  if (projectName) params.append('projectName', projectName);
  if (projectPath) params.append('projectPath', projectPath);
  if (limit !== null) {
    params.append('limit', String(limit));
    params.append('offset', String(offset));
  }
  return authenticatedFetch(`/api/sessions/${sessionId}/messages?${params}`);
},

// 重命名会话
renameSession: (sessionId, summary, provider) =>
  authenticatedFetch(`/api/sessions/${sessionId}/rename`, {
    method: 'PUT',
    body: JSON.stringify({ summary, provider }),
  }),

// 删除会话
deleteSession: (projectName, sessionId) =>
  authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}`, {
    method: 'DELETE',
  }),
```

#### 项目状态管理 (`src/hooks/useProjectsState.ts`)

```typescript
export function useProjectsState({ sessionId, navigate, latestMessage, isMobile, activeSessions }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  
  // 获取项目列表
  const fetchProjects = useCallback(async ({ showLoadingState = true } = {}) => {
    if (showLoadingState) {
      setIsLoadingProjects(true);
    }
    const response = await api.projects();
    const projectData = await response.json();
    setProjects(projectData);
  }, []);
  
  // WebSocket 实时更新
  useEffect(() => {
    if (latestMessage?.type === 'projects_updated') {
      const updatedProjects = latestMessage.projects;
      setProjects(updatedProjects);
      
      // 更新选中的项目和会话
      if (selectedProject) {
        const updatedProject = updatedProjects.find(p => p.name === selectedProject.name);
        if (updatedProject) {
          setSelectedProject(updatedProject);
          
          if (selectedSession) {
            const updatedSession = getProjectSessions(updatedProject)
              .find(s => s.id === selectedSession.id);
            if (updatedSession) {
              setSelectedSession(updatedSession);
            }
          }
        }
      }
    }
  }, [latestMessage]);
  
  return {
    projects,
    selectedProject,
    selectedSession,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    fetchProjects
  };
}
```

---

### 4. 后端 API 路由

#### 项目路由 (`server/routes/projects.js`)

```javascript
// GET /api/projects - 获取所有项目
router.get('/projects', async (req, res) => {
  const projects = await discoverClaudeProjects();
  res.json(projects);
});

// GET /api/projects/:name/sessions - 获取项目会话
router.get('/projects/:name/sessions', async (req, res) => {
  const { name } = req.params;
  const { limit = 10, offset = 0 } = req.query;
  
  const sessions = await getProjectSessions(name, {
    limit: parseInt(limit),
    offset: parseInt(offset)
  });
  
  res.json(sessions);
});
```

#### 消息路由 (`server/routes/messages.js`)

```javascript
// GET /api/sessions/:sessionId/messages - 统一消息接口
router.get('/:sessionId/messages', async (req, res) => {
  const { sessionId } = req.params;
  const provider = req.query.provider || 'claude';
  const projectName = req.query.projectName || '';
  const projectPath = req.query.projectPath || '';
  const limit = req.query.limit ? parseInt(req.query.limit) : null;
  const offset = parseInt(req.query.offset || '0');
  
  const adapter = getProvider(provider);
  if (!adapter) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }
  
  const result = await adapter.fetchHistory(sessionId, {
    projectName,
    projectPath,
    limit,
    offset
  });
  
  res.json(result);
});
```

---

## 数据流总结

### 1. 项目列表加载
```
用户打开页面
  → 前端调用 api.projects()
  → 后端发现 ~/.claude/projects/ 目录
  → 读取每个项目目录，提取项目路径
  → 返回项目列表（包含会话元数据）
  → 前端渲染侧边栏
```

### 2. 会话列表加载
```
用户点击项目
  → 前端调用 api.sessions(projectName, limit, offset)
  → 后端读取 ~/.claude/projects/{project}/ 目录
  → 遍历 .jsonl 文件，提取会话信息
  → 返回会话列表（包含摘要、时间、消息数）
  → 前端渲染会话列表
```

### 3. 会话详情加载
```
用户点击会话
  → 前端调用 api.unifiedSessionMessages(sessionId, provider)
  → 后端读取对应的 .jsonl 文件
  → 解析每行 JSON，提取消息内容
  → 返回消息列表（支持分页）
  → 前端渲染聊天界面
```

### 4. 新建会话并发送消息
```
用户输入消息并提交
  → 前端通过 WebSocket 发送消息
  → 后端调用 queryClaudeSDK()
  → SDK 创建新会话，返回 session_id
  → 流式返回消息（通过 WebSocket）
  → 前端实时渲染消息
  → 会话结束，保存到 .jsonl 文件
```

---

## 关键设计模式

### 1. 适配器模式（多 Agent 支持）
```javascript
// 统一接口，不同实现
const providers = {
  claude: claudeAdapter,
  cursor: cursorAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter
};

function getProvider(name) {
  return providers[name];
}

// 统一的消息格式
interface NormalizedMessage {
  kind: 'message' | 'tool_use' | 'tool_result' | 'error' | 'complete';
  sessionId: string;
  provider: string;
  content: any;
}
```

### 2. 流式处理
```javascript
// 后端流式读取 .jsonl 文件
async function* streamMessages(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream });
  
  for await (const line of rl) {
    if (line.trim()) {
      yield JSON.parse(line);
    }
  }
}

// 前端流式渲染
for await (const message of queryInstance) {
  ws.send(normalizeMessage(message));
}
```

### 3. WebSocket 实时通信
```javascript
// 后端推送
ws.send(JSON.stringify({
  kind: 'session_created',
  newSessionId: sessionId
}));

// 前端监听
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  handleMessage(message);
};
```

---

## 对 AI4WEB 项目的启示

### 1. 会话存储
- 使用 `.jsonl` 格式存储会话，每行一个消息对象
- 文件名即为 session_id
- 支持流式读取，内存友好

### 2. 项目发现
- 扫描固定目录（如 `~/.claude/projects/`）
- 从会话文件中提取项目路径
- 支持手动添加项目

### 3. 实时更新
- WebSocket 推送会话状态变化
- 文件监听（chokidar）检测新会话
- 前端实时刷新项目列表

### 4. 多 Agent 支持
- 统一的消息格式（NormalizedMessage）
- 适配器模式封装不同 Agent 的差异
- 统一的 API 接口（`/api/sessions/:id/messages?provider=xxx`）

### 5. SDK 集成
- 使用官方 SDK（`@anthropic-ai/claude-agent-sdk`）
- 支持恢复会话（`resume: sessionId`）
- 支持工具权限控制（`canUseTool` 回调）
- 支持 MCP 服务器配置
