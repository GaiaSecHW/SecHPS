# Bug 修复与项目管理优化方案

## 🐛 Bug 修复完成

### 1. session-manager.ts 语法错误 ✅

**问题**：第 330 行多余的引号
```typescript
// 错误代码
const summary = typeof entry.message?.content' === 'string'

// 已修复
const summary = typeof entry.message?.content === 'string'
```

### 2. Prisma schema 缺少 SystemConfig 模型 ✅

**问题**：start/route.ts 引用了不存在的 `prisma.systemConfig`

**修复**：已在 `prisma/schema.prisma` 添加 SystemConfig 模型：
```prisma
model SystemConfig {
  id          String   @id @default(cuid())
  key         String   @unique
  value       String   // JSON: 配置值
  description String?
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([key])
}
```

### 3. 需要执行的命令

```bash
# 生成 Prisma 客户端
npx prisma generate

# 推送 schema 变更到数据库
npx prisma db push

# 如果需要，运行数据库种子
npm run db:seed
```

---

## 📊 CloudCLI UI 项目对象结构分析

基于对 CloudCLI UI 的深入研究，以下是完整的项目对象结构：

### 核心对象定义

```typescript
// Project 对象（项目）
interface Project {
  name: string;                      // 项目唯一标识名
  displayName: string;               // 显示名称
  fullPath: string;                  // 完整路径
  path?: string;                     // 相对路径（可选）
  
  // 多提供者会话数组
  sessions?: ProjectSession[];       // Claude 会话
  cursorSessions?: ProjectSession[]; // Cursor 会话
  codexSessions?: ProjectSession[];  // Codex 会话
  geminiSessions?: ProjectSession[]; // Gemini 会话
  
  // 会话元数据
  sessionMeta?: ProjectSessionMeta;
  
  // TaskMaster 信息
  taskmaster?: ProjectTaskmasterInfo;
  
  // 扩展字段
  [key: string]: unknown;
}

// ProjectSession 对象（会话）
interface ProjectSession {
  id: string;                        // 会话唯一标识
  title?: string;                    // 会话标题
  summary?: string;                  // 会话摘要
  name?: string;                     // 会话名
  createdAt?: string;                // 创建时间
  created_at?: string;               // 创建时间（兼容字段）
  updated_at?: string;               // 更新时间
  lastActivity?: string;             // 最近活动时间
  messageCount?: number;             // 消息数量
  
  // 提供者标识
  __provider?: SessionProvider;      // 'claude' | 'cursor' | 'codex' | 'gemini'
  __projectName?: string;            // 所属项目名
  
  [key: string]: unknown;
}

// ProjectSessionMeta（会话元数据）
interface ProjectSessionMeta {
  total?: number;        // 会话总数
  hasMore?: boolean;     // 是否还有更多
  [key: string]: unknown;
}

// ProjectTaskmasterInfo（TaskMaster 信息）
interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;          // 是否启用
  status?: string;                  // 任务状态
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// SessionProvider（提供者枚举）
type SessionProvider = 'claude' | 'cursor' | 'codex' | 'gemini';
```

### 关联方式

```typescript
// 合并多提供者会话
function getProjectSessions(project: Project): ProjectSession[] {
  return [
    ...(project.sessions || []),
    ...(project.cursorSessions || []),
    ...(project.codexSessions || []),
    ...(project.geminiSessions || []),
  ];
}

// 通过 __provider 字段区分来源
// 通过 __projectName 字段回填项目关联
```

---

## 💡 SQLite 本地项目管理最佳实践

基于业界最佳实践研究（Kanboard、Unison、Mindwtr、pnpm 等）：

### 推荐的数据库设计

```sql
-- 启用外键约束
PRAGMA foreign_keys = ON;

-- 项目表
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  full_path TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  
  -- 环境配置
  environment_url TEXT,
  admin_username TEXT,
  admin_password TEXT,
  
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,
  
  -- 索引
  UNIQUE(name)
);

CREATE INDEX idx_projects_name ON projects(name);
CREATE INDEX idx_projects_status ON projects(status);

-- 会话表（支持多提供者）
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',  -- 'claude' | 'cursor' | 'codex' | 'gemini'
  
  title TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  
  started_at TEXT DEFAULT (datetime('now')),
  last_activity TEXT,
  completed_at TEXT,
  message_count INTEGER DEFAULT 0,
  
  -- 关联
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_provider ON sessions(provider);
CREATE INDEX idx_sessions_status ON sessions(status);

-- 会话消息表
CREATE TABLE session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,  -- 'user' | 'assistant'
  content TEXT NOT NULL,
  metadata TEXT,  -- JSON
  
  created_at TEXT DEFAULT (datetime('now')),
  
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_session ON session_messages(session_id);

-- 项目配置表（键值对）
CREATE TABLE project_config (
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,  -- JSON
  
  PRIMARY KEY (project_id, key),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 系统配置表
CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value TEXT,  -- JSON
  description TEXT,
  
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 审计日志表
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  user_id TEXT,
  details TEXT,  -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);

-- Schema 版本管理
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);
```

### Prisma Schema 对应

```prisma
model Project {
  id              String   @id @default(cuid())
  name            String   @unique
  displayName     String?
  fullPath        String
  description     String?
  status          String   @default("active")
  
  // 环境配置
  environmentUrl  String?
  adminUsername   String?
  adminPassword   String?
  
  // 关系
  sessions        Session[]
  config          ProjectConfig[]
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([name])
  @@index([status])
}

model Session {
  id            String   @id @default(cuid())
  projectId     String
  provider      String   @default("claude")  // claude | cursor | codex | gemini
  
  title         String?
  summary       String?
  status        String   @default("active")
  
  startedAt     DateTime @default(now())
  lastActivity  DateTime?
  completedAt   DateTime?
  messageCount  Int      @default(0)
  
  // 关系
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  messages      SessionMessage[]
  
  @@index([projectId])
  @@index([provider])
  @@index([status])
}

model SessionMessage {
  id            String   @id @default(cuid())
  sessionId     String
  role          String   // user | assistant
  content       String
  metadata      String?  // JSON
  
  createdAt     DateTime @default(now())
  
  session       Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  
  @@index([sessionId])
}

model ProjectConfig {
  projectId     String
  key           String
  value         String?  // JSON
  
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@id([projectId, key])
}

model SystemConfig {
  key           String   @id
  value         String?  // JSON
  description   String?
  
  updatedAt     DateTime @updatedAt
}
```

---

## 🎯 针对 AI4WEB 的优化建议

### 1. 数据库优化

**当前问题**：
- ✅ 使用 SQLite（适合小团队）
- ⚠️ 缺少提供者字段区分
- ⚠️ 缺少会话元数据

**优化方案**：
```prisma
model Project {
  // ... 现有字段
  
  // 添加会话元数据
  sessionMeta     SessionMeta?
  
  // 添加多提供者支持
  claudeSessions  Session[]  @relation("ClaudeSessions")
  cursorSessions  Session[]  @relation("CursorSessions")
  codexSessions   Session[]  @relation("CodexSessions")
  geminiSessions  Session[]  @relation("GeminiSessions")
}

model Session {
  // ... 现有字段
  
  // 添加提供者字段
  provider        String    @default("claude")
  
  // 添加统计字段
  messageCount    Int       @default(0)
  lastActivity    DateTime?
  
  @@index([provider])
}

model SessionMeta {
  id          String   @id @default(cuid())
  projectId   String   @unique
  total       Int      @default(0)
  hasMore     Boolean  @default(false)
  
  // 按提供者统计
  claudeCount   Int @default(0)
  cursorCount   Int @default(0)
  codexCount    Int @default(0)
  geminiCount   Int @default(0)
  
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

### 2. API 优化

**参考 CloudCLI UI 的 API 设计**：

```typescript
// GET /api/projects/:id/sessions
router.get('/:id/sessions', async (req, res) => {
  const { id } = req.params;
  const { provider, limit = 10, offset = 0 } = req.query;
  
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      sessionMeta: true,
      sessions: provider === 'claude' || !provider ? {
        orderBy: { lastActivity: 'desc' },
        take: limit,
        skip: offset,
      } : false,
      cursorSessions: provider === 'cursor' ? {
        orderBy: { lastActivity: 'desc' },
        take: limit,
        skip: offset,
      } : false,
      // ... 其他提供者
    }
  });
  
  res.json(project);
});

// 合并多提供者会话
function getProjectSessions(project: any, provider?: string): Session[] {
  if (provider) {
    return project[`${provider}Sessions`] || [];
  }
  
  return [
    ...(project.sessions || []),
    ...(project.cursorSessions || []),
    ...(project.codexSessions || []),
    ...(project.geminiSessions || []),
  ].sort((a, b) => b.lastActivity - a.lastActivity);
}
```

### 3. 前端优化

**参考 CloudCLI UI 的组件设计**：

```typescript
// 会话列表组件
const SessionList = ({ project }: { project: Project }) => {
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  
  const sessions = useMemo(() => {
    return getProjectSessions(project, selectedProvider === 'all' ? undefined : selectedProvider);
  }, [project, selectedProvider]);
  
  return (
    <div>
      {/* 提供者过滤器 */}
      <div>
        <button onClick={() => setSelectedProvider('all')}>全部</button>
        <button onClick={() => setSelectedProvider('claude')}>Claude</button>
        <button onClick={() => setSelectedProvider('cursor')}>Cursor</button>
        <button onClick={() => setSelectedProvider('codex')}>Codex</button>
        <button onClick={() => setSelectedProvider('gemini')}>Gemini</button>
      </div>
      
      {/* 会话列表 */}
      {sessions.map(session => (
        <SessionItem 
          key={session.id} 
          session={session}
          provider={session.__provider}
        />
      ))}
      
      {/* 分页 */}
      {project.sessionMeta?.hasMore && (
        <button onClick={loadMore}>加载更多</button>
      )}
    </div>
  );
};

// 会话项组件
const SessionItem = ({ session, provider }: { session: Session; provider: string }) => (
  <div>
    <div>{session.title || session.summary}</div>
    <div>{session.messageCount} 条消息</div>
    <div>提供者: {provider}</div>
    <div>最后活动: {formatTime(session.lastActivity)}</div>
  </div>
);
```

---

## 📋 实施清单

### 阶段 1：Bug 修复（已完成 ✅）
- [x] 修复 session-manager.ts 语法错误
- [x] 添加 SystemConfig 模型到 Prisma schema
- [ ] 运行 `npx prisma generate`
- [ ] 运行 `npx prisma db push`

### 阶段 2：数据库优化（1 周）
- [ ] 添加 provider 字段到 Session 模型
- [ ] 添加 SessionMeta 模型
- [ ] 添加 lastActivity 和 messageCount 字段
- [ ] 创建数据库迁移脚本

### 阶段 3：API 优化（1 周）
- [ ] 实现多提供者会话查询 API
- [ ] 实现会话元数据统计 API
- [ ] 实现分页和过滤功能
- [ ] 添加审计日志

### 阶段 4：前端优化（1 周）
- [ ] 实现提供者过滤器
- [ ] 实现会话列表分页
- [ ] 优化会话显示组件
- [ ] 添加会话元数据显示

---

## 🎓 参考资源

### 业界最佳实践
- **Kanboard**：SQLite 项目管理示例
- **Unison**：项目表设计（WITHOUT ROWID）
- **Mindwtr**：SQLite 本地应用模式
- **pnpm**：SQLite 索引存储实践

### GitHub 证据链接
- Unison 项目表设计：https://github.com/unisonweb/unison/blob/trunk/codebase2/codebase-sqlite/sql/005-project-tables.sql
- Semaphore 集成设计：https://github.com/semaphoreui/semaphore/blob/develop/db/sql/migrations/v2.9.60.sql
- Claude-MPM 会话设计：https://github.com/bobmatnyc/claude-mpm/issues/306
- Mindwtr 数据库模式：https://github.com/dongdongbh/Mindwtr/wiki/Database-Schema

---

**总结**：已完成 Bug 修复，提供了完整的数据库优化方案和实施清单。按照此方案实施，AI4WEB 将具备与 CloudCLI UI 相当的项目管理能力，同时保持本地数据库的轻量级优势。
