# AI4WEB 测试平台

一个功能完整的 **AI4WEB AI 编程助手测试平台**，支持多用户、角色权限管理（RBAC）、会话管理、代码搜索等功能。

## 🚀 功能特性

### 核心功能
- ✅ **用户认证系统** - 注册、登录、JWT Token 管理
- ✅ **RBAC 权限系统** - 角色和权限的动态分配
- ✅ **会话管理** - 创建、编辑、回退、分享会话
- ✅ **代码搜索** - 文件、符号、文本三维度搜索
- ✅ **实时事件流** - SSE 事件监听
- ✅ **配置管理** - AI4WEB 服务器配置、模型选择

### 权限管理
- **角色系统**：admin、manager、developer、user、viewer
- **权限粒度**：按模块（session、user、config、search、file）和操作（create、read、update、delete）细分
- **动态分配**：管理员可以为角色动态分配权限
- **用户-角色关联**：多对多关系，支持用户拥有多个角色

### 技术栈
- **前端**：Next.js 16 + React 19 + TypeScript
- **样式**：Tailwind CSS
- **数据库**：Prisma ORM + SQLite
- **认证**：JWT + bcrypt bcryptjs
- **SDK 集成**：@ai4web/sdk
- **UI 组件**：Lucide React Icons

## 📁 项目结构

```
ai4web-test-platform/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API 路由
│   │   │   ├── auth/          # 认证 API
│   │   │   ├── users/         # 用户管理 API
│   │   │   ├── roles/         # 角色管理 API
│   │   │   ├── permissions/   # 权限管理 API
│   │   │   └── sessions/      # 会话管理 API
│   │   ├── login/             # 登录页面
│   │   └── dashboard/         # 主应用界面
│   ├── components/             # React 组件
│   ├── lib/                   # 工具库
│   │   ├── auth.ts           # 认证工具
│   │   └── prisma.ts        # Prisma 客户端
│   └── types/                 # TypeScript 类型
│       └── permissions.ts    # 权限常量
├── prisma/
│   └── schema.prisma           # 数据库模型
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.ts
```

## 🛠️ 安装和运行

### 1. 安装依赖
```bash
cd ai4web-test-platform
npm install
```

### 2. 配置环境变量
创建 `.env` 文件：
```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-secret-key-change-in-production"
NODE_ENV="development"
```

### 3. 初始化数据库
```bash
npx prisma migrate dev --name init
npx prisma db seed
```

### 4. 运行开发服务器
```bash
npm run dev
```

访问：http://localhost:3000

## 🔐 API 端点

### 认证
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录

### 用户管理
- `GET /api/users` - 获取所有用户（需要 user:read 权限）
- `GET /api/users/[id]` - 获取单个用户
- `PATCH /api/users/[id]` - 更新用户信息
- `DELETE /api/users/[id]` - 删除用户
- `POST /api/users/[id]/roles` - 为用户分配角色

### 角色管理
- `GET /api/roles` - 获取所有角色
- `POST /api/roles` - 创建角色

### 权限管理
- `GET /api/permissions` - 获取所有权限
- `POST /api/permissions` - 创建权限

### 配置管理
- `GET /api/config` - 获取当前用户的配置列表（需要 config:read 权限）
- `POST /api/config` - 创建新配置（需要 config:update 权限）
- `PATCH /api/config/[id]` - 更新配置（需要 config:update 权限）
- `DELETE /api/config/[id]` - 删除配置（需要 config:delete 权限）

### 会话管理
- `GET /api/sessions` - 获取当前用户的会话列表
- `POST /api/sessions` - 创建新会话
- `GET /api/sessions/[id]` - 获取会话详情
- `DELETE /api/sessions/[id]` - 删除会话

## 🔒 权限系统

### 默认角色
1. **admin** - 拥有所有权限
2. **manager** - 管理用户、会话、配置、搜索
3. **developer** - 创建和编辑会话、搜索代码
4. **user** - 基本会话操作和搜索
5. **viewer** - 只读权限

### 权限列表
- **会话权限**：session:create, session:read, session:update, session:delete, session:share, session:revert
- **用户权限**：user:create, user:read, user:update, user:delete, user:assign_role
- **角色权限**：role:create, role:read, role:update, role:delete, role:assign_permission
- **权限权限**：permission:create, permission:read, permission:update, permission:delete
- **配置权限**：config:read, config:update, config:delete
- **搜索权限**：search:file, search:symbol, search:text
- **文件权限**：file:read, file:write
- **审计权限**：audit:read

## 📝 使用示例

### 1. 注册和登录
```typescript
// 注册
await fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    username: 'johndoe',
    password: 'password123',
    name: 'John Doe',
  }),
});

// 登录
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123',
  }),
});

const { token, user } = await response.json();
localStorage.setItem('token', token);
```

### 2. 创建会话
```typescript
const token = localStorage.getItem('token');

const response = await fetch('/api/sessions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    configId: 'config-id', // 可选
    title: 'My Coding Session',
  }),
});

const { session } = await response.json();
```

### 3. 创建配置
```typescript
const token = localStorage.getItem('token');

const response = await fetch('/api/config', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    name: 'My AI4WEB Server',
    baseURL: 'http://localhost:54321',
    description: 'Local development server',
    isActive: true,
    mcpServers: [
      {
        name: 'filesystem',
        type: 'local',
        command: 'npx @modelcontextprotocol/server-filesystem /path/to/project'
      }
    ],
    keybinds: {
      'save': 'Ctrl+S',
      'search': 'Ctrl+K',
      'run': 'F5'
    },
    modelPreferences: {
      'openai': {
        model: 'gpt-4',
        temperature: 0.7
      }
    }
  }),
});

const { config } = await response.json();
```

### 4. 为用户分配角色
```typescript
const token = localStorage.getItem('token');

await fetch('/api/users/user-id/roles', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    roleIds: ['role-id-1', 'role-id-2'],
  }),
});
```

## 🔐 数据库模型

### User
- id, email, username, passwordHash, name, avatar, isActive
- 关系：userRoles, sessions, opencodeConfig

### Role
- id, name, description, isSystem
- 关系：userRoles, permissions

### Permission
- id, name, module, action, resource
- 关系：roles

### UserRole
- userId, roleId（多对多关联）

### Session
- userId, configId, opencodeSessionId, title, isShared, shareUrl
- 关系：user, config, messages

### OpencodeConfig
- userId, name, baseURL, description, isActive, mcpServers, keybinds, modelPreferences
- 关系：user, sessions
- 说明：mcpServers, keybinds, modelPreferences 字段存储 JSON 字符串

### AuditLog
- userId, action, resource, details, ipAddress, userAgent

## 🚧 部署

### 构建
```bash
npm run build
```

### 生产环境配置
```env
DATABASE_URL="postgresql://user:password@localhost:5432/ai4web"
JWT_SECRET="your-production-secret-key"
NODE_ENV="production"
```

### 运行
```bash
npm start
```

## 📚 待完成功能

- [ ] Monaco Editor 集成
- [ ] 文件树导航组件
- [ ] Markdown 渲染
- [ ] 实时事件流（SSE）
- [x] 用户管理界面
- [x] 角色和权限管理界面
- [ ] 代码搜索界面
- [x] 配置管理界面
- [ ] 审计日志查看
- [ ] 错误处理优化

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
