# AI4WEB 测试平台 - 代理开发指南

## 项目概述

这是一个基于 Next.js 16 + React 19 + TypeScript 的 AI4WEB AI 编程助手测试平台，采用 App Router 架构，使用 Prisma ORM 和 SQLite 数据库。

## 构建和开发命令

```bash
# 开发服务器
npm run dev

# 生产构建
npm run build

# 生产运行
npm start

# 代码检查
npm run lint

# 数据库相关
npm run db:generate     # 生成 Prisma 客户端
npm run db:push         # 推送 schema 到数据库
npm run db:seed         # 运行数据库种子
```

## 代码风格指南

### 导入顺序和约定

```typescript
// 1. React 相关导入
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// 2. 第三方库导入
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// 3. 内部导入（使用 @ 别名）
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS, ROLES } from '@/types/permissions';
```

### TypeScript 类型定义

- 使用 `@/types/` 目录存放类型定义
- 权限常量定义在 `@/types/permissions.ts`
- Prisma 生成的类型通过 `@prisma/client` 导入

```typescript
// 从 Prisma 导入类型
import type { User, Role, Permission } from '@prisma/client';

// 使用权限常量
import { PERMISSIONS, ROLES } from '@/types/permissions';
```

### 命名约定

- **组件**: PascalCase (如 `UserTable`, `CreateUserModal`)
- **函数**: camelCase (如 `fetchUsers`, `handleSubmit`)
- **常量**: UPPER_SNAKE_CASE (如 `PERMISSIONS`, `ROLES`)
- **接口/类型**: PascalCase (如 `JWTPayload`, `UserResponse`)
- **文件**: kebab-case (如 `user-table.tsx`, `auth-utils.ts`)

### 错误处理

#### API 路由错误处理

```typescript
export async function POST(request: Request) {
  try {
    // 1. 验证输入
    const body = await request.json();
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // 2. 验证 Token（如果需要认证）
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 3. 检查权限
    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.USER_READ)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. 业务逻辑
    // ...

    return NextResponse.json({ data: result }, { status: 200 });
  } catch (error) {
    console.error('Operation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

#### 客户端错误处理

```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError('');
  setLoading(true);

  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const data = await response.json();
      setError(data.error || 'Operation failed');
      setLoading(false);
      return;
    }

    onSuccess();
  } catch (err) {
    setError('Network error. Please try again.');
    setLoading(false);
  }
};
```

### 组件模式

#### 客户端组件

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MyComponent() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  // ...

  return <div>{/* JSX */}</div>
}
```

#### 加载状态

```typescript
if (loading) {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}
```

### 样式约定（Tailwind CSS）

- 使用 Tailwind CSS 进行所有样式
- 颜色使用项目定义的 primary 色系
- 响应式设计使用 Tailwind 断点

```typescript
// 按钮样式
<button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
  Submit
</button>

// 输入框样式
<input
  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
/>

// 错误提示
{error && (
  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
    {error}
  </div>
)}
```

### 认证和授权

#### JWT Token 管理

```typescript
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 验证 Token
const token = authHeader.replace('Bearer ', '');
const payload = verifyToken(token);

// 检查权限
if (!hasPermission(payload.permissions, PERMISSIONS.USER_READ)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

#### 客户端认证

```typescript
// 保存 Token
localStorage.setItem('token', data.token);
localStorage.setItem('user', JSON.stringify(data.user));

// 使用 Token
const token = localStorage.getItem('token');
const response = await fetch('/api/endpoint', {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

### API 路由结构

```
src/app/api/
├── auth/
│   ├── login/route.ts
│   └── register/route.ts
├── users/
│   ├── route.ts
│   └── [id]/route.ts
├── roles/route.ts
├── permissions/route.ts
├── sessions/route.ts
└── config/route.ts
```

### 数据库操作

```typescript
import { prisma } from '@/lib/prisma';

// 查询
const user = await prisma.user.findUnique({
  where: { email },
  include: {
    userRoles: {
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    },
  },
});

// 创建
const newUser = await prisma.user.create({
  data: {
    email,
    username,
    passwordHash,
  },
});

// 更新
const updatedUser = await prisma.user.update({
  where: { id },
  data: { name, avatar },
});

// 删除
await prisma.user.delete({
  where: { id },
});
```

### 审计日志

```typescript
// 记录审计日志
await prisma.auditLog.create({
  data: {
    userId: user.id,
    action: 'user_create',
    resource: userId,
    details: JSON.stringify({ email, username }),
  },
});
```

## 重要注意事项

1. **严格类型**: 虽然项目 `strict: false`，但新代码应使用严格类型
2. **权限检查**: 所有需要权限的 API 端点必须检查权限
3. **错误处理**: 所有 API 调用必须处理错误情况
4. **认证保护**: Dashboard 下的所有页面都通过 layout.tsx 进行认证保护
5. **Prisma 使用**: 始终使用 `@/lib/prisma` 导入的 prisma 实例
6. **环境变量**: 敏感信息使用 `process.env` 从环境变量读取
7. **客户端组件**: 使用 hooks 或浏览器 API 的组件必须添加 `'use client'` 指令

## 测试

项目目前没有配置测试框架。如需添加测试，建议使用 Jest + React Testing Library。

## 常用权限常量

```typescript
// 会话权限
PERMISSIONS.SESSION_CREATE
PERMISSIONS.SESSION_READ
PERMISSIONS.SESSION_UPDATE
PERMISSIONS.SESSION_DELETE

// 用户权限
PERMISSIONS.USER_CREATE
PERMISSIONS.USER_READ
PERMISSIONS.USER_UPDATE
PERMISSIONS.USER_DELETE

// 配置权限
PERMISSIONS.CONFIG_READ
PERMISSIONS.CONFIG_UPDATE
PERMISSIONS.CONFIG_DELETE

// 搜索权限
PERMISSIONS.SEARCH_FILE
PERMISSIONS.SEARCH_SYMBOL
PERMISSIONS.SEARCH_TEXT
```
