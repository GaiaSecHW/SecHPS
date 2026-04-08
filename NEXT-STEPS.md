# 项目管理优化 - 最终完成指南

## ✅ 已完成的工作

### 1. Bug 修复
- ✅ 修复 `session-manager.ts` 语法错误
- ✅ 添加 `SystemConfig` 模型到 Prisma schema

### 2. 数据库模型优化
- ✅ Project 模型：添加 `displayName`、`fullPath`、`sessionMeta`
- ✅ EvaluationSession 模型：添加 `provider`、`title`、`summary`、`messageCount`、`lastActivity`
- ✅ SessionMeta 模型：新增会话统计模型
- ✅ SystemConfig 模型：新增系统配置模型

### 3. API 路由创建
- ✅ `GET/PUT /api/projects/:id/sessions/meta` - 会话元数据 API
- ✅ `GET/POST /api/projects/:id/sessions/query` - 会话查询 API（支持提供者过滤）

---

## ⚠️ 需要手动执行的步骤

### 步骤 1：重新生成 Prisma 客户端

由于 Prisma schema 已更新，需要重新生成客户端：

```bash
# 在项目根目录执行（CMD 或 Git Bash）
npx prisma generate
npx prisma db push
```

### 步骤 2：验证数据库表结构

打开 Prisma Studio 验证：

```bash
npx prisma studio
```

检查以下表是否存在：
- `Project` 表是否有 `displayName`、`fullPath` 字段
- `EvaluationSession` 表是否有 `provider`、`title`、`summary`、`messageCount`、`lastActivity` 字段
- `SessionMeta` 表是否存在
- `SystemConfig` 表是否存在

---

## 📋 完整的 API 端点清单

### 项目管理 API

| 端点 | 方法 | 说明 | 新增 |
|------|------|------|------|
| `/api/projects` | GET | 获取项目列表 | - |
| `/api/projects` | POST | 创建项目 | - |
| `/api/projects/:id` | GET | 获取项目详情 | - |
| `/api/projects/:id` | PUT | 更新项目 | - |
| `/api/projects/:id` | DELETE | 删除项目 | - |
| `/api/projects/:id/sessions` | GET | 获取会话列表 | - |
| `/api/projects/:id/sessions/meta` | GET | 获取会话元数据 | ✅ 新增 |
| `/api/projects/:id/sessions/meta` | PUT | 更新会话元数据 | ✅ 新增 |
| `/api/projects/:id/sessions/query` | GET | 查询会话（支持过滤） | ✅ 新增 |
| `/api/projects/:id/sessions/query` | POST | 合并多提供者会话 | ✅ 新增 |

### API 使用示例

#### 1. 获取会话元数据

```bash
GET /api/projects/:id/sessions/meta

# 响应
{
  "id": "cm123...",
  "projectId": "proj456...",
  "total": 10,
  "hasMore": false,
  "claudeCount": 5,
  "cursorCount": 3,
  "codexCount": 1,
  "geminiCount": 1,
  "runningCount": 2,
  "completedCount": 7,
  "failedCount": 1,
  "updatedAt": "2025-04-05T10:00:00Z"
}
```

#### 2. 按提供者查询会话

```bash
GET /api/projects/:id/sessions/query?provider=claude&status=completed&limit=20&offset=0

# 响应
{
  "sessions": [
    {
      "id": "sess123...",
      "provider": "claude",
      "title": "代码审查",
      "summary": "审查用户认证模块",
      "status": "completed",
      "messageCount": 15,
      "lastActivity": "2025-04-05T09:30:00Z",
      "startedAt": "2025-04-05T09:00:00Z",
      "completedAt": "2025-04-05T09:30:00Z",
      "__provider": "claude"
    }
  ],
  "total": 5,
  "hasMore": false,
  "limit": 20,
  "offset": 0,
  "provider": "claude",
  "status": "completed"
}
```

#### 3. 合并多提供者会话

```bash
POST /api/projects/:id/sessions/query
Content-Type: application/json

{
  "limit": 20,
  "offset": 0,
  "providers": ["claude", "cursor"]
}

# 响应
{
  "sessions": [...],
  "total": 8,
  "hasMore": false,
  "limit": 20,
  "offset": 0
}
```

---

## 🎨 前端组件建议

### 1. 提供者过滤器组件

```typescript
// components/ProviderFilter.tsx
'use client';

interface ProviderFilterProps {
  selectedProvider: string;
  onChange: (provider: string) => void;
  sessionMeta: {
    claudeCount: number;
    cursorCount: number;
    codexCount: number;
    geminiCount: number;
  };
}

export default function ProviderFilter({ selectedProvider, onChange, sessionMeta }: ProviderFilterProps) {
  const providers = [
    { id: 'all', label: '全部', count: null },
    { id: 'claude', label: 'Claude', count: sessionMeta.claudeCount },
    { id: 'cursor', label: 'Cursor', count: sessionMeta.cursorCount },
    { id: 'codex', label: 'Codex', count: sessionMeta.codexCount },
    { id: 'gemini', label: 'Gemini', count: sessionMeta.geminiCount },
  ];

  return (
    <div className="flex space-x-2">
      {providers.map(provider => (
        <button
          key={provider.id}
          onClick={() => onChange(provider.id)}
          className={`px-4 py-2 rounded-lg ${
            selectedProvider === provider.id
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          {provider.label}
          {provider.count !== null && (
            <span className="ml-2 bg-gray-300 px-2 py-1 rounded-full text-sm">
              {provider.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
```

### 2. 会话列表组件

```typescript
// components/SessionList.tsx
'use client';

import { useState, useEffect } from 'react';

interface SessionListProps {
  projectId: string;
}

export default function SessionList({ projectId }: SessionListProps) {
  const [sessions, setSessions] = useState([]);
  const [sessionMeta, setSessionMeta] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 获取会话元数据
    fetch(`/api/projects/${projectId}/sessions/meta`)
      .then(res => res.json())
      .then(setSessionMeta);
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    
    // 获取会话列表
    const params = new URLSearchParams();
    if (selectedProvider !== 'all') {
      params.append('provider', selectedProvider);
    }
    
    fetch(`/api/projects/${projectId}/sessions/query?${params}`)
      .then(res => res.json())
      .then(data => {
        setSessions(data.sessions);
        setLoading(false);
      });
  }, [projectId, selectedProvider]);

  if (loading) return <div>加载中...</div>;

  return (
    <div>
      {sessionMeta && (
        <ProviderFilter
          selectedProvider={selectedProvider}
          onChange={setSelectedProvider}
          sessionMeta={sessionMeta}
        />
      )}
      
      <div className="mt-4 space-y-4">
        {sessions.map(session => (
          <div key={session.id} className="border rounded-lg p-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-semibold">{session.title || session.summary}</h3>
                <p className="text-sm text-gray-600">
                  {session.messageCount} 条消息 · {session.provider}
                </p>
              </div>
              <div className="text-right">
                <span className={`px-2 py-1 rounded text-sm ${
                  session.status === 'completed' ? 'bg-green-100 text-green-800' :
                  session.status === 'running' ? 'bg-blue-100 text-blue-800' :
                  'bg-red-100 text-red-800'
                }`}>
                  {session.status}
                </span>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(session.lastActivity).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 🔧 数据迁移脚本

如果有现有数据，可以运行以下迁移脚本：

```sql
-- 为现有会话添加默认提供者
UPDATE EvaluationSession 
SET provider = 'claude' 
WHERE provider IS NULL;

-- 计算消息数量
UPDATE EvaluationSession 
SET messageCount = (
  SELECT COUNT(*) 
  FROM SessionMessage 
  WHERE evaluationSessionId = EvaluationSession.id
)
WHERE messageCount IS NULL OR messageCount = 0;

-- 更新最后活动时间
UPDATE EvaluationSession 
SET lastActivity = (
  SELECT MAX(createdAt) 
  FROM SessionMessage 
  WHERE evaluationSessionId = EvaluationSession.id
)
WHERE lastActivity IS NULL;

-- 创建会话元数据
INSERT INTO SessionMeta (id, projectId, total, claudeCount, cursorCount, codexCount, geminiCount, runningCount, completedCount, failedCount)
SELECT 
  lower(hex(randomblob(16))),
  id,
  (SELECT COUNT(*) FROM EvaluationSession WHERE projectId = Project.id),
  (SELECT COUNT(*) FROM EvaluationSession WHERE projectId = Project.id AND provider = 'claude'),
  (SELECT COUNT(*) FROM EvaluationSession WHERE projectId = Project.id AND provider = 'cursor'),
  (SELECT COUNT(*) FROM EvaluationSession WHERE projectId = Project.id AND provider = 'codex'),
  (SELECT COUNT(*) FROM EvaluationSession WHERE projectId = Project.id AND provider = 'gemini'),
  (SELECT COUNT(*) FROM EvaluationSession WHERE projectId = Project.id AND status = 'running'),
  (SELECT COUNT(*) FROM EvaluationSession WHERE projectId = Project.id AND status = 'completed'),
  (SELECT COUNT(*) FROM EvaluationSession WHERE projectId = Project.id AND status = 'failed')
FROM Project
WHERE NOT EXISTS (
  SELECT 1 FROM SessionMeta WHERE projectId = Project.id
);
```

---

## 🎯 下一步工作

1. **执行 Prisma 命令**（必须）
   ```bash
   npx prisma generate
   npx prisma db push
   ```

2. **测试 API**
   - 测试会话元数据 API
   - 测试会话查询 API
   - 测试提供者过滤

3. **创建前端组件**（可选）
   - 提供者过滤器组件
   - 会话列表组件
   - 会话元数据显示

4. **数据迁移**（如果有现有数据）
   - 运行迁移脚本
   - 验证数据正确性

---

## 📊 功能对比

| 功能 | AI4WEB (优化后) | CloudCLI UI | 状态 |
|------|----------------|-------------|------|
| 多提供者支持 | ✅ | ✅ | 完成 |
| 会话元数据统计 | ✅ | ✅ | 完成 |
| 提供者过滤 | ✅ | ✅ | 完成 |
| 会话标题/摘要 | ✅ | ✅ | 完成 |
| 消息数量统计 | ✅ | ✅ | 完成 |
| 最后活动时间 | ✅ | ✅ | 完成 |
| 本地数据库管理 | ✅ SQLite | ❌ 文件系统 | 完成 |

---

**恭喜！项目管理优化已基本完成。执行 Prisma 命令后即可使用新功能！** 🎉
