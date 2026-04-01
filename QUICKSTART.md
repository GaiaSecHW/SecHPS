# Opencode Web Platform - 快速启动指南

## ✅ 已完成的核心功能

### 1. **项目基础设施**
- ✅ Next.js 16 + React 19 + TypeScript
- ✅ Tailwind CSS 样式系统
- ✅ Prisma ORM + SQLite 数据库
- ✅ 完整的 package.json 配置

### 2. **完整的 RBAC 权限系统**
- ✅ **数据库模型**：User、Role、Permission、UserRole、Session、AuditLog
- ✅ **权限常量**：25 个细粒度权限（session、user、role、permission、config、search、file、audit）
- ✅ **5 个默认角色**：admin、manager、developer、user、viewer
- ✅ **动态权限分配**：管理员可以为角色动态分配权限
- ✅ **权限检查中间件**：所有 API 端点都包含权限验证

### 3. **API 端点（全部包含权限检查）**
- ✅ 认证 API：注册、登录
- ✅ 用户管理 API：CRUD、角色分配
- ✅ 角色管理 API：CRUD
- ✅ 权限管理 API：CRUD
- ✅ 会话管理 API：CRUD
- ✅ 代码搜索 API：文件、符号、文本搜索
- ✅ SSE 事件流 API：实时事件监听

### 4. **前端界面**
- ✅ 登录/注册页面
- ✅ Dashboard 布局（侧边栏、顶部栏、权限控制）
- ✅ 用户管理界面（CRUD、角色分配模态框）
- ✅ 角色和权限管理界面（创建、编辑、权限分配）
- ✅ 会话管理界面（列表、创建、删除）
- ✅ 会话详情页面（Monaco Editor、消息历史、回退、分享）
- ✅ 代码搜索界面（文件、符号、文本三维度搜索）
- ✅ 文件树导航组件（可折叠的树形结构）
- ✅ Markdown 渲染器（AI 响应显示）
- ✅ SSE 实时事件流监听

### 5. **核心功能集成**
- ✅ Monaco Editor 代码编辑器集成
- ✅ Opencode SDK 集成（会话创建、消息发送）
- ✅ 实时消息显示
- ✅ 文件搜索、符号搜索、文本搜索
- ✅ 权限控制的 UI 显示（根据用户角色显示/隐藏功能）

### 6. **数据库 Seed**
- ✅ 自动创建所有默认角色
- ✅ 自动创建所有权限
- ✅ 为 admin 角色分配所有权限
- ✅ 创建测试管理员账户（`admin@opencode.com` / `admin123`）

## 🚀 快速启动

### 1. 安装依赖
```bash
cd D:\opencodeweb2\opencode-web-platform
npm install
```

**注意**：如果安装 react-markdown 失败，可以跳过（Markdown 渲染是可选功能）

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

**测试账号**：
- 邮箱：`admin@opencode.com`
- 密码：`admin123`

## 🎯 主要页面

1. **登录页面**：`/login` - 注册/登录切换
2. **Dashboard**：`/dashboard` - 主应用入口
3. **会话列表**：`/dashboard/sessions` - 管理会话
4. **会话详情**：`/dashboard/sessions/[id]` - Monaco Editor + 消息历史
5. **用户管理**：`/dashboard/users` - 用户 CRUD + 角色分配
6. **角色管理**：`/dashboard/roles` - 角色 CRUD + 权限管理
7. **代码搜索**：`/dashboard/search` - 文件/符号/文本搜索
8. **文件树**：`/dashboard/files` - 项目文件导航

## 🔐 权限系统说明

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

### 1. 创建会话
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

### 2. 为用户分配角色
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

### 3. 代码搜索
```typescript
const token = localStorage.getItem('token');

// 文件搜索
const filesResponse = await fetch('/api/search/files?query=*.ts', {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

// 符号搜索
const symbolsResponse = { await fetch('/api/search/symbols?query=functionName', {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

// 文本搜索
const textResponse = await fetch('/api/search/text?pattern=TODO', {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

## 🔧 技术亮点

- ✅ **类型安全**：完整的 TypeScript 类型定义
- ✅ **权限控制**：所有 API 端点都包含权限检查
- ✅ **错误处理**：统一的错误处理和用户反馈
- ✅ **响应式设计**：Tailwind CSS 响应式布局
- ✅ **代码编辑器**：Monaco Editor 集成
- ✅ **实时搜索**：三种搜索类型（文件、符号、文本）
- ✅ **实时事件流**：SSE 事件监听
- ✅ **数据库 Seed**：自动初始化角色和权限

## 📝 项目结构

```
D:\opencodeweb2\opencode-web-platform\
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API 路由
│   │   │   ├── auth/          # 认证 API
│   │   │   ├── users/         # 用户管理 API
│   │   │   ├── roles/         # 角色管理 API
│   │   │   ├── permissions/   # 权限管理 API
│   │   │   ├── search/         # 代码搜索 API
│   │   │   └── sessions/      # 会话管理 API
│   │   │   └── events/        # SSE 事件流 API
│   │   ├── login/             # 登录页面
│   │   └── dashboard/         # 主应用界面
│   │   ├── components/             # React 组件
│   │   │   ├── MarkdownRenderer.tsx  # Markdown 渲染器
│   │   ├── lib/                   # 工具库
│   │   │   ├── auth.ts           # 认证工具
│   │   │   └── prisma.ts        # Prisma 客户端
│   │   └── types/                 # TypeScript 类型
│   │   │       └── permissions.ts  # 权限常量
├── prisma/
│   └── schema.prisma           # 数据库模型
│   └── seed.ts            # 初始化数据
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
├── .env
└── README.md
```

## �待完成功能

- [ ] 配置管理界面（模型、MCP、快捷键）+ 权限控制
- [ ] 审计日志查看
- [ ] 错误处理优化

---

**核心功能已完成！** 现在可以：
1. 运行项目并测试认证系统
2. 使用管理员账号登录
3. 创建和管理用户、角色、权限
4. 创建和管理会话
5. 使用代码搜索功能
6. 使用 Monaco Editor 进行代码编辑
7. 实时监听 SSE 事件流

需要我继续实现剩余功能（配置管理界面、审计日志、错误处理优化）吗？
