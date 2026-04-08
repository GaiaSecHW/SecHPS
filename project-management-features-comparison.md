# 项目管理功能对比分析

## 📋 对比范围

**仅对比以下四个核心功能**：
1. 新建项目
2. 启动评估
3. 查看详情
4. 历史评估

---

## 🔍 功能对比矩阵

### 1. 新建项目

| 维度 | AI4WEB | CloudCLI UI | 差异分析 |
|------|--------|-------------|---------|
| **触发方式** | 用户手动创建（填写表单） | 自动发现 + 手动添加路径 | ⭐⭐⭐ 根本差异 |
| **项目来源** | 数据库记录 | 扫描 ~/.claude/projects/ | ⭐⭐ 存储差异 |
| **必填信息** | name, description, projectPath (可选) | 自动提取路径 | ⭐⭐⭐ 繁简差异 |
| **元数据** | ✅ 支持环境配置、描述、配置关联 | ❌ 仅路径和显示名 | ⭐⭐ 功能差异 |
| **存储位置** | 数据库 Project 表 | ~/.claude/project-config.json | ⭐⭐⭐ 存储差异 |
| **多租户** | ✅ 用户隔离（userId） | ❌ 单用户共享 | ⭐⭐⭐ 架构差异 |

#### AI4WEB 实现代码

```typescript
// POST /api/projects
export async function POST(request: Request) {
  const user = await verifyToken(request);
  const formData = await request.formData();
  
  // 1. 创建项目记录
  const project = await prisma.project.create({
    data: {
      userId: user.id,  // 👤 用户隔离
      name: formData.get('name'),
      description: formData.get('description'),
      projectPath: formData.get('projectPath'),
      configId: formData.get('configId'),
      // 🌐 环境配置
      environmentUrl: formData.get('environmentUrl'),
      adminUsername: formData.get('adminUsername'),
      adminPassword: formData.get('adminPassword'),
      // ...
    }
  });
  
  // 2. 处理文件上传
  const files = formData.getAll('files');
  for (const file of files) {
    await prisma.projectFile.create({
      data: {
        projectId: project.id,
        fileName: file.name,
        filePath: await saveFile(file),
        // ...
      }
    });
  }
  
  return NextResponse.json({ project });
}
```

**前端界面**：
```typescript
// src/app/dashboard/code/page.tsx
<form onSubmit={handleCreateProject}>
  <input name="name" placeholder="项目名称" required />
  <textarea name="description" placeholder="项目描述" />
  <input name="projectPath" placeholder="项目路径（可选）" />
  <select name="configId">
    <option>选择配置（可选）</option>
    {configs.map(c => <option value={c.id}>{c.name}</option>)}
  </select>
  
  {/* 环境配置 */}
  <input name="environmentUrl" placeholder="环境 URL" />
  <input name="adminUsername" placeholder="管理员用户名" />
  <input name="adminPassword" type="password" placeholder="管理员密码" />
  
  {/* 文件上传 */}
  <input type="file" multiple name="files" />
  
  <button type="submit">创建项目</button>
</form>
```

#### CloudCLI UI 实现代码

```javascript
// 自动发现项目
async function discoverProjects() {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  const projectDirs = await fs.readdir(claudeProjectsDir);
  
  const projects = [];
  
  for (const dir of projectDirs) {
    // 从 .jsonl 文件提取项目路径
    const actualPath = await extractProjectDirectory(dir);
    
    projects.push({
      name: path.basename(actualPath),
      fullPath: actualPath,
      sessions: await getSessions(dir)
    });
  }
  
  return projects;
}

// 手动添加项目
async function addProjectManually(projectPath, displayName) {
  const config = await loadProjectConfig();
  const projectName = projectPath.replace(/[\\/:\s~_]/g, '-');
  
  config[projectName] = {
    manuallyAdded: true,
    originalPath: projectPath,
    displayName: displayName || path.basename(projectPath)
  };
  
  await saveProjectConfig(config);
  
  return { name: projectName, path: projectPath };
}

// 前端界面
<button onClick={() => {
  const path = prompt('输入项目路径：');
  addProjectManually(path);
}}>
  添加项目
</button>
```

**关键差异**：
- AI4WEB：需要用户填写详细信息，适合企业级项目管理
- CloudCLI：自动发现 + 简单添加，适合个人快速使用

---

### 2. 启动评估

| 维度 | AI4WEB | CloudCLI UI | 差异分析 |
|------|--------|-------------|---------|
| **评估类型** | SDK 集成评估 | Claude/Cursor/Codex/Gemini 多 Agent | ⭐⭐⭐ 功能差异 |
| **工作流支持** | ✅ 自定义工作流 | ❌ 无工作流概念 | ⭐⭐⭐ 架构差异 |
| **配置绑定** | ✅ 关联 OpencodeConfig | ✅ 使用 CLI 配置 | ⭐⭐ 配置差异 |
| **进度跟踪** | ✅ SSE 实时推送 | ✅ WebSocket 实时推送 | ⭐ 实现差异 |
| **状态管理** | 数据库 EvaluationSession | .jsonl 文件追加 | ⭐⭐⭐ 存储差异 |
| **日志记录** | SessionMessage 表 | .jsonl 文件流式写入 | ⭐⭐⭐ 存储差异 |

#### AI4WEB 实现代码

```typescript
// POST /api/projects/[id]/start
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const projectId = params.id;
  
  // 1. 创建评估会话
  const evaluation = await prisma.evaluationSession.create({
    data: {
      projectId,
      status: 'running',
      startedAt: new Date(),
      workflowId: body.workflowId,
    }
  });
  
  // 2. 更新项目状态
  await prisma.project.update({
    where: { id: projectId },
    data: { status: 'running' }
  });
  
  // 3. 启动评估流程（SSE 流式输出）
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      try {
        // 调用 AI4WEB SDK
        for await (const chunk of evaluationStream) {
          // 写入消息到数据库
          await prisma.sessionMessage.create({
            data: {
              evaluationSessionId: evaluation.id,
              role: 'assistant',
              content: chunk.content,
              metadata: JSON.stringify(chunk.metadata)
            }
          });
          
          // 推送 SSE 事件
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
          );
        }
        
        // 更新会话状态
        await prisma.evaluationSession.update({
          where: { id: evaluation.id },
          data: { status: 'completed', completedAt: new Date() }
        });
        
        controller.close();
      } catch (error) {
        // 错误处理
        await prisma.evaluationSession.update({
          where: { id: evaluation.id },
          data: { status: 'failed', errorMessage: error.message }
        });
        
        controller.error(error);
      }
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
```

**前端界面**：
```typescript
// src/app/dashboard/code/page.tsx
const handleStartEvaluation = async (projectId: string) => {
  const eventSource = new EventSource(`/api/projects/${projectId}/start`);
  
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'progress') {
      updateProgress(data.progress);
    } else if (data.type === 'message') {
      appendMessage(data.content);
    } else if (data.type === 'complete') {
      eventSource.close();
      showSuccess('评估完成');
    }
  };
  
  eventSource.onerror = (error) => {
    eventSource.close();
    showError('评估失败');
  };
};

return (
  <button onClick={() => handleStartEvaluation(project.id)}>
    启动评估
  </button>
);
```

#### CloudCLI UI 实现代码

```javascript
// POST /api/agent/chat
router.post('/chat', async (req, res) => {
  const { message, sessionId, provider } = req.body;
  
  // WebSocket 连接
  const ws = getWebSocketConnection(sessionId);
  
  try {
    // 根据不同 Agent 调用不同 SDK
    const sdkOptions = {
      prompt: message,
      options: {
        cwd: req.projectPath,
        sessionId: sessionId,
        resume: sessionId ? true : false
      }
    };
    
    // 流式调用
    const queryInstance = query(sdkOptions);
    
    for await (const chunk of queryInstance) {
      // 写入 .jsonl 文件（追加模式）
      await fs.appendFile(
        getSessionFilePath(sessionId),
        JSON.stringify(chunk) + '\n'
      );
      
      // 推送 WebSocket 消息
      ws.send(JSON.stringify({
        type: 'message',
        sessionId,
        content: chunk
      }));
    }
    
    ws.send(JSON.stringify({ type: 'complete', sessionId }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', error: error.message }));
  }
});

// 前端界面
const handleSendMessage = async (message: string) => {
  const ws = new WebSocket(`ws://localhost:3000/api/agent/chat`);
  
  ws.onopen = () => {
    ws.send(JSON.stringify({
      message,
      sessionId: currentSessionId,
      provider: selectedProvider // claude | cursor | codex | gemini
    }));
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'message') {
      appendMessage(data.content);
    } else if (data.type === 'complete') {
      showSuccess('评估完成');
    }
  };
};
```

**关键差异**：
- AI4WEB：结构化工作流，数据库记录完整状态
- CloudCLI：多 Agent 选择，文件追加日志

---

### 3. 查看详情

| 维度 | AI4WEB | CloudCLI UI | 差异分析 |
|------|--------|-------------|---------|
| **数据来源** | 数据库查询（结构化） | .jsonl 文件解析 | ⭐⭐⭐ 存储差异 |
| **查询能力** | ✅ 强大（过滤、聚合、关联） | ❌ 弱（全文件扫描） | ⭐⭐⭐ 能力差异 |
| **关联数据** | ✅ 项目、配置、文件、工作流 | ❌ 仅会话消息 | ⭐⭐⭐ 关系差异 |
| **性能** | ✅ 索引优化，毫秒级 | ⚠️ 文件大小影响 | ⭐⭐ 性能差异 |
| **分页** | ✅ 数据库分页 | ⚠️ 需要读取全部文件 | ⭐⭐ 性能差异 |
| **搜索** | ✅ 全文搜索、标签过滤 | ❌ 需要手动实现 | ⭐⭐⭐ 功能差异 |

#### AI4WEB 实现代码

```typescript
// GET /api/projects/[id]
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      files: {
        orderBy: { uploadedAt: 'desc' }
      },
      evaluations: {
        orderBy: { startedAt: 'desc' },
        take: 10,
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 100
          }
        }
      },
      config: true,
      structures: true,
      codeKnowledge: true,
      vulnerabilities: true
    }
  });
  
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  
  return NextResponse.json({ project });
}

// 前端界面
const ProjectDetail = ({ projectId }: { projectId: string }) => {
  const [project, setProject] = useState(null);
  
  useEffect(() => {
    fetch(`/api/projects/${projectId}`)
      .then(res => res.json())
      .then(data => setProject(data.project));
  }, [projectId]);
  
  return (
    <div>
      <h1>{project?.name}</h1>
      <p>{project?.description}</p>
      
      {/* 环境配置 */}
      <section>
        <h2>环境配置</h2>
        <div>URL: {project?.environmentUrl}</div>
        <div>管理员: {project?.adminUsername}</div>
      </section>
      
      {/* 上传文件 */}
      <section>
        <h2>上传文件</h2>
        {project?.files.map(file => (
          <div key={file.id}>
            <span>{file.fileName}</span>
            <span>{formatFileSize(file.fileSize)}</span>
          </div>
        ))}
      </section>
      
      {/* 评估历史 */}
      <section>
        <h2>评估历史</h2>
        {project?.evaluations.map(evaluation => (
          <div key={evaluation.id}>
            <div>状态: {evaluation.status}</div>
            <div>开始: {formatDate(evaluation.startedAt)}</div>
          </div>
        ))}
      </section>
      
      {/* 代码知识 */}
      <section>
        <h2>代码知识</h2>
        {project?.codeKnowledge.map(knowledge => (
          <div key={knowledge.id}>{knowledge.content}</div>
        ))}
      </section>
    </div>
  );
};
```

#### CloudCLI UI 实现代码

```javascript
// GET /api/sessions/:sessionId/messages
router.get('/:sessionId/messages', async (req, res) => {
  const { sessionId } = req.params;
  const { limit, offset } = req.query;
  
  const filePath = getSessionFilePath(sessionId);
  const messages = [];
  
  // 流式读取 .jsonl 文件
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream });
  
  let lineCount = 0;
  for await (const line of rl) {
    if (limit && lineCount >= offset && lineCount < offset + limit) {
      messages.push(JSON.parse(line));
    }
    lineCount++;
  }
  
  res.json({
    messages,
    total: lineCount,
    hasMore: limit ? (offset + limit < lineCount) : false
  });
});

// 前端界面
const SessionDetail = ({ sessionId }: { sessionId: string }) => {
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 50;
  
  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/messages?limit=${limit}&offset=${page * limit}`)
      .then(res => res.json())
      .then(data => {
        setMessages(data.messages);
        setTotal(data.total);
      });
  }, [sessionId, page]);
  
  return (
    <div>
      <h1>会话详情</h1>
      <div>消息总数: {total}</div>
      
      {messages.map((msg, idx) => (
        <div key={idx}>
          <div>{msg.role}: {msg.content}</div>
          <div>{formatTime(msg.timestamp)}</div>
        </div>
      ))}
      
      {/* 分页 */}
      <button onClick={() => setPage(p => p - 1)} disabled={page === 0}>
        上一页
      </button>
      <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total}>
        下一页
      </button>
    </div>
  );
};
```

**关键差异**：
- AI4WEB：结构化数据，支持复杂查询和关联
- CloudCLI：文件解析，性能受文件大小影响

---

### 4. 历史评估

| 维度 | AI4WEB | CloudCLI UI | 差异分析 |
|------|--------|-------------|---------|
| **存储方式** | 数据表 EvaluationSession | .jsonl 文件列表 | ⭐⭐⭐ 存储差异 |
| **元数据** | ✅ 完整（状态、时间、错误信息） | ⚠️ 有限（从文件名/内容推断） | ⭐⭐ 元数据差异 |
| **分页** | ✅ 高效数据库分页 | ⚠️ 需要读取所有文件 | ⭐⭐⭐ 性能差异 |
| **过滤** | ✅ 状态、时间、工作流过滤 | ❌ 无过滤能力 | ⭐⭐⭐ 功能差异 |
| **排序** | ✅ 数据库索引排序 | ⚠️ 文件系统排序（慢） | ⭐⭐ 性能差异 |
| **统计** | ✅ SQL 聚合查询 | ❌ 需要手动计算 | ⭐⭐⭐ 能力差异 |

#### AI4WEB 实现代码

```typescript
// GET /api/projects/[id]/evaluations
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { status, startDate, endDate, limit = 20, offset = 0 } = parseQuery(request.url);
  
  // 构建过滤条件
  const where: any = { projectId: params.id };
  
  if (status) {
    where.status = status;
  }
  
  if (startDate || endDate) {
    where.startedAt = {};
    if (startDate) where.startedAt.gte = new Date(startDate);
    if (endDate) where.startedAt.lte = new Date(endDate);
  }
  
  // 查询总数
  const total = await prisma.evaluationSession.count({ where });
  
  // 分页查询
  const evaluations = await prisma.evaluationSession.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: limit,
    skip: offset,
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 1 // 只取第一条消息作为摘要
      },
      nodeExecutions: {
        orderBy: { startedAt: 'asc' }
      }
    }
  });
  
  // 统计信息
  const stats = await prisma.evaluationSession.aggregate({
    where: { projectId: params.id },
    _count: { _all: true },
    _avg: {
      // 计算平均执行时间等
    }
  });
  
  return NextResponse.json({
    evaluations,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    },
    stats
  });
}

// 前端界面
const EvaluationHistory = ({ projectId }: { projectId: string }) => {
  const [evaluations, setEvaluations] = useState([]);
  const [filters, setFilters] = useState({
    status: '',
    startDate: '',
    endDate: ''
  });
  const [page, setPage] = useState(0);
  
  useEffect(() => {
    const params = new URLSearchParams({
      ...filters,
      limit: '20',
      offset: (page * 20).toString()
    });
    
    fetch(`/api/projects/${projectId}/evaluations?${params}`)
      .then(res => res.json())
      .then(data => setEvaluations(data.evaluations));
  }, [projectId, filters, page]);
  
  return (
    <div>
      <h1>评估历史</h1>
      
      {/* 过滤器 */}
      <div>
        <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})}>
          <option value="">全部状态</option>
          <option value="running">运行中</option>
          <option value="completed">已完成</option>
          <option value="failed">失败</option>
        </select>
        
        <input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} />
        <input type="date" value={filters.endDate} onChange={e => setFilters({...filters, endDate: e.target.value})} />
      </div>
      
      {/* 列表 */}
      {evaluations.map(evaluation => (
        <div key={evaluation.id}>
          <div>状态: {evaluation.status}</div>
          <div>开始: {formatDate(evaluation.startedAt)}</div>
          <div>结束: {evaluation.completedAt ? formatDate(evaluation.completedAt) : '-'}</div>
          {evaluation.errorMessage && <div style={{color: 'red'}}>错误: {evaluation.errorMessage}</div>}
        </div>
      ))}
      
      {/* 分页 */}
      <button onClick={() => setPage(p => p - 1)} disabled={page === 0}>上一页</button>
      <button onClick={() => setPage(p => p + 1)}>下一页</button>
    </div>
  );
};
```

#### CloudCLI UI 实现代码

```javascript
// GET /api/projects/:name/sessions
router.get('/:name/sessions', async (req, res) => {
  const { name } = req.params;
  const { limit = 10, offset = 0 } = req.query;
  
  const projectDir = path.join(os.homedir(), '.claude', 'projects', name);
  const files = await fs.readdir(projectDir);
  
  // 过滤 .jsonl 文件
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
  
  // 按修改时间排序（需要读取所有文件元数据）
  const filesWithStats = await Promise.all(
    jsonlFiles.map(async file => {
      const filePath = path.join(projectDir, file);
      const stats = await fs.stat(filePath);
      return { file, mtime: stats.mtime };
    })
  );
  
  filesWithStats.sort((a, b) => b.mtime - a.mtime);
  
  // 分页
  const total = filesWithStats.length;
  const paginatedFiles = filesWithStats.slice(offset, offset + limit);
  
  // 解析会话信息
  const sessions = [];
  for (const { file, mtime } of paginatedFiles) {
    const filePath = path.join(projectDir, file);
    const sessionId = file.replace('.jsonl', '');
    
    // 读取第一行获取摘要
    const firstLine = await readFirstLine(filePath);
    const firstEntry = JSON.parse(firstLine);
    
    sessions.push({
      id: sessionId,
      title: firstEntry.message?.content?.substring(0, 50) || 'New Session',
      created_at: stats.birthtime,
      updated_at: mtime,
      messageCount: await countLines(filePath)
    });
  }
  
  res.json({
    sessions,
    total,
    hasMore: offset + limit < total
  });
});

// 前端界面
const SessionHistory = ({ projectName }: { projectName: string }) => {
  const [sessions, setSessions] = useState([]);
  const [page, setPage] = useState(0);
  
  useEffect(() => {
    fetch(`/api/projects/${projectName}/sessions?limit=10&offset=${page * 10}`)
      .then(res => res.json())
      .then(data => setSessions(data.sessions));
  }, [projectName, page]);
  
  return (
    <div>
      <h1>会话历史</h1>
      
      {sessions.map(session => (
        <div key={session.id}>
          <div>{session.title}</div>
          <div>消息数: {session.messageCount}</div>
          <div>更新: {formatTime(session.updated_at)}</div>
        </div>
      ))}
      
      <button onClick={() => setPage(p => p - 1)} disabled={page === 0}>上一页</button>
      <button onClick={() => setPage(p => p + 1)}>下一页</button>
    </div>
  );
};
```

**关键差异**：
- AI4WEB：数据库支持复杂查询、过滤、统计
- CloudCLI：文件系统限制，功能有限

---

## 📊 总体对比总结

### 功能完整度对比

| 功能 | AI4WEB | CloudCLI UI | 完整度评分 |
|------|--------|-------------|-----------|
| **新建项目** | ✅ 完整表单、环境配置、文件上传 | ⚠️ 自动发现或手动添加路径 | AI4WEB: 95% / CloudCLI: 60% |
| **启动评估** | ✅ 工作流支持、SSE 流式输出 | ✅ 多 Agent 支持、WebSocket | AI4WEB: 85% / CloudCLI: 90% |
| **查看详情** | ✅ 结构化数据、关联查询 | ⚠️ 文件解析、功能有限 | AI4WEB: 95% / CloudCLI: 50% |
| **历史评估** | ✅ 过滤、统计、高效分页 | ⚠️ 基础列表、无过滤 | AI4WEB: 95% / CloudCLI: 40% |

### 架构差异影响

| 维度 | AI4WEB 数据库方案 | CloudCLI 文件方案 | 影响 |
|------|------------------|------------------|------|
| **查询能力** | ✅ SQL 索引、聚合、关联 | ❌ 全文件扫描、手动解析 | ⭐⭐⭐ 功能差异 |
| **性能** | ✅ 毫秒级响应、稳定 | ⚠️ 受文件大小影响 | ⭐⭐ 性能差异 |
| **扩展性** | ✅ 支持多租户、复杂查询 | ❌ 单用户、功能受限 | ⭐⭐⭐ 架构差异 |
| **部署成本** | ⚠️ 需要数据库、迁移 | ✅ 零配置、文件即存储 | ⭐⭐ 成本差异 |

### 适用场景

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| **企业级 SaaS 平台** | AI4WEB | 多租户、权限控制、复杂查询 |
| **小团队内部工具** | AI4WEB（简化版） | SQLite 即可，无需 PostgreSQL |
| **个人开发工具** | CloudCLI UI | 零配置、快速上手 |
| **多 Agent 切换** | CloudCLI UI | 原生支持多 Agent |

---

## 💡 针对 AI4WEB 的优化建议

### 小团队简化方案（SQLite 即可）

```typescript
// 简化的数据模型
model Project {
  id          String   @id @default(cuid())
  name        String
  description String?
  projectPath String?
  
  // 简化环境配置
  environmentUrl  String?
  adminUsername   String?
  adminPassword   String?
  
  evaluations Evaluation[]
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([name])
  @@index([updatedAt])
}

model Evaluation {
  id        String   @id @default(cuid())
  projectId String
  
  status    String   @default("running")
  startedAt DateTime @default(now())
  completedAt DateTime?
  errorMessage String?
  
  messages Message[]
  
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@index([projectId])
  @@index([status])
  @@index([startedAt])
}

model Message {
  id              String   @id @default(cuid())
  evaluationId    String
  
  role            String
  content         String
  metadata        String?  // JSON
  
  createdAt       DateTime @default(now())
  
  evaluation Evaluation @relation(fields: [evaluationId], references: [id], onDelete: Cascade)
  
  @@index([evaluationId])
  @@index([createdAt])
}
```

**关键优化**：
- ✅ 使用 SQLite（better-sqlite3）
- ✅ 启用 WAL 模式提升并发
- ✅ 合理建立索引
- ✅ 定期备份数据库文件

### 实施建议

**第 1 阶段（核心功能）**：
- ✅ 新建项目：简化表单，保留必要字段
- ✅ 启动评估：基础工作流 + SSE 流式输出
- ✅ 查看详情：项目信息 + 最近评估
- ✅ 历史评估：列表展示 + 基础过滤

**第 2 阶段（优化提升）**：
- ✅ 增强过滤和搜索能力
- ✅ 添加统计和报表
- ✅ 优化大文件上传
- ✅ 增加导出功能

**不建议的功能**（小团队无需）：
- ❌ PostgreSQL（SQLite 足够）
- ❌ 复杂的工作流引擎
- ❌ 多租户权限系统
- ❌ 分布式存储
