# AI4WEB 平台代码重复与重构分析报告

## 概述

本报告基于对代码库的全面分析，识别出**4大类重复代码问题**，影响**169个API路由文件**和**11个前端页面组件**。主要问题是：
1. 相同功能在多处重复编码
2. 实现细节不一致（错误消息、响应格式、导入路径）
3. 业务变化时需要修改多个文件

---

## 一、认证/权限层重复 (严重程度: ★★★★★)

### 问题统计
| 模式 | 重复次数 | 主要差异 |
|------|---------|---------|
| Token验证代码块 | **222次** | 错误消息不一致（'未授权' vs 'Unauthorized'） |
| 权限检查代码块 | **207次** | 导入路径不一致（auth.ts vs permissions.ts） |
| 角色检查 | **10处** | 两种不同实现方式 |
| 审计日志写入 | **30+处** | 同步 vs 异步写入不一致 |

### 典型重复代码

```typescript
// 每个 API 路由重复 8-10 行认证代码（出现 222 次！）
const authHeader = request.headers.get('authorization');
if (!authHeader) {
  return NextResponse.json({ error: '未授权' }, { status: 401 });
}
const token = authHeader.replace('Bearer ', '');
const payload = verifyToken(token);
if (!payload) {
  return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
}

// 权限检查重复（出现 207 次）
if (!hasPermission(payload.permissions, PERMISSIONS.XXX_READ)) {
  return NextResponse.json({ error: '禁止访问' }, { status: 403 });
}
```

### 发现的差异

| 差异类型 | 示例 | 文件数 |
|---------|------|--------|
| 导入路径不一致 | `import { hasPermission } from '@/lib/auth'` vs `from '@/lib/permissions'` | 68 vs 9 |
| 错误消息不一致 | '未授权' / 'Unauthorized' / '无权限' | 50+ |
| 角色检查方式 | `payload.roles.includes('admin')` vs `userRoles.includes('admin')` | 10 |
| 审计日志写入 | `await prisma.auditLog.create()` vs `.create().catch()` | 15 vs 15 |

### 重构建议

**创建 `src/lib/api-auth.ts` 统一认证中间件:**

```typescript
// src/lib/api-auth.ts
import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { AuditLogger } from '@/lib/audit/logger';

export interface AuthResult {
  success: true;
  payload: JWTPayload;
}

export interface AuthError {
  success: false;
  response: NextResponse;
}

/**
 * 统一认证检查 - 替代每个 API 的重复认证代码
 */
export async function authenticateRequest(
  request: Request,
  options?: {
    requiredPermission?: string;
    skipAuditLog?: boolean;
  }
): Promise<AuthResult | AuthError> {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader) {
    if (!options?.skipAuditLog) {
      await AuditLogger.logPermissionDenied(undefined, 'any', request);
    }
    return {
      success: false,
      response: NextResponse.json({ error: '未授权' }, { status: 401 }),
    };
  }

  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);

  if (!payload) {
    return {
      success: false,
      response: NextResponse.json({ error: '无效的令牌' }, { status: 401 }),
    };
  }

  if (options?.requiredPermission) {
    if (!hasPermission(payload.permissions, options.requiredPermission)) {
      await AuditLogger.logPermissionDenied(payload.userId, options.requiredPermission, request);
      return {
        success: false,
        response: NextResponse.json({ error: '禁止访问' }, { status: 403 }),
      };
    }
  }

  return { success: true, payload };
}

/**
 * 简化版 - 用于快速替换
 */
export async function withAuth(
  request: Request,
  permission?: string
): Promise<JWTPayload | NextResponse> {
  const result = await authenticateRequest(request, { requiredPermission: permission });
  if (result.success) {
    return result.payload;
  }
  return result.response;
}
```

**迁移示例:**

```typescript
// 之前 (每个文件 15+ 行)
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }
    if (!hasPermission(payload.permissions, PERMISSIONS.USER_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }
    // 业务逻辑...
  } catch (error) { ... }
}

// 之后 (3 行)
export async function GET(request: Request) {
  const payload = await withAuth(request, PERMISSIONS.USER_READ);
  if (payload instanceof NextResponse) return payload; // 认证失败
  
  try {
    // 业务逻辑...
  } catch (error) { ... }
}
```

---

## 二、API 响应层重复 (严重程度: ★★★★★)

### 问题统计

| 模式 | 重复次数 | 主要差异 |
|------|---------|---------|
| try-catch 错误处理 | **169次** | console.error vs logger，是否返回 details |
| 成功响应格式 | **50+种** | `{ data }` vs `{ data, message }` vs `{ message }` |
| 错误响应格式 | **30+种** | 不同错误消息文本 |
| 分页参数解析 | **15+次** | 相同的 URL searchParams 解析代码 |
| 验证函数定义 | **2处完全重复** | validateJsonField 在 config/route.ts 和 config/[id]/route.ts |

### 响应格式不一致汇总

| 状态码 | 文件A | 文件B | 文件C |
|--------|-------|-------|-------|
| 401 | `{ error: '未授权' }` | `{ error: 'Unauthorized' }` | `{ error: '无权限' }` |
| 403 | `{ error: '禁止访问' }` | `{ error: '无权限查看会话' }` | `{ error: '权限不足' }` |
| 404 | `{ error: '未找到用户' }` | `{ error: '项目不存在' }` | `{ error: '评估会话不存在' }` |
| 500 | `{ error: '服务器内部错误' }` | `{ error: '服务器内部错误', details: ... }` | - |

### 验证函数重复

```typescript
// 完全相同的函数在两个文件中重复定义
// config/route.ts 和 config/[id]/route.ts

function validateJsonField(value: string | null | undefined, fieldName: string) {
  if (!value) return { valid: true };
  try {
    JSON.parse(value);
    return { valid: true };
  } catch {
    return { valid: false, error: `${fieldName} 格式无效，必须是合法的 JSON` };
  }
}

function validateJsonObject(value: unknown, fieldName: string) {
  if (value === undefined || value === null) return { valid: true };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: `${fieldName} 格式无效，必须是 JSON 对象` };
  }
  return { valid: true };
}
```

### 重构建议

**创建 `src/lib/api-response.ts` 统一响应格式:**

```typescript
// src/lib/api-response.ts
import { NextResponse } from 'next/server';

// 统一错误消息常量
export const API_ERRORS = {
  UNAUTHORIZED: '未授权',
  INVALID_TOKEN: '无效的令牌',
  FORBIDDEN: '禁止访问',
  NOT_FOUND: '资源不存在',
  INTERNAL_ERROR: '服务器内部错误',
  MISSING_FIELDS: '缺少必填字段',
  INVALID_INPUT: '输入格式无效',
} as const;

// 统一响应函数
export function successResponse(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

export function createdResponse(data: any, message?: string) {
  return NextResponse.json(
    { message: message || '创建成功', ...data },
    { status: 201 }
  );
}

export function errorResponse(
  error: string,
  status: number,
  details?: string
) {
  const response: any = { error };
  if (details) response.details = details;
  return NextResponse.json(response, { status });
}

// 快捷方法
export const apiResponses = {
  unauthorized: () => errorResponse(API_ERRORS.UNAUTHORIZED, 401),
  invalidToken: () => errorResponse(API_ERRORS.INVALID_TOKEN, 401),
  forbidden: (message?: string) => errorResponse(message || API_ERRORS.FORBIDDEN, 403),
  notFound: (resource?: string) => errorResponse(resource || API_ERRORS.NOT_FOUND, 404),
  internalError: (details?: string) => errorResponse(API_ERRORS.INTERNAL_ERROR, 500, details),
  badRequest: (message: string) => errorResponse(message, 400),
};
```

**创建 `src/lib/api-validation.ts` 统一验证工具:**

```typescript
// src/lib/api-validation.ts
export function validateRequired(
  fields: Record<string, any>,
  fieldNames: string[]
): { valid: boolean; error?: string } {
  const missing = fieldNames.filter(name => !fields[name]);
  if (missing.length > 0) {
    return { valid: false, error: `缺少必填字段: ${missing.join(', ')}` };
  }
  return { valid: true };
}

export function validateJsonField(
  value: string | null | undefined,
  fieldName: string
): { valid: boolean; error?: string } {
  if (!value) return { valid: true };
  try {
    JSON.parse(value);
    return { valid: true };
  } catch {
    return { valid: false, error: `${fieldName} 格式无效，必须是合法的 JSON` };
  }
}

export function validateJsonObject(
  value: unknown,
  fieldName: string
): { valid: boolean; error?: string } {
  if (value === undefined || value === null) return { valid: true };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: `${fieldName} 格式无效，必须是 JSON 对象` };
  }
  return { valid: true };
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) return { valid: false, error: '密码至少需要8个字符' };
  if (!/[a-z]/.test(password)) return { valid: false, error: '密码需要包含小写字母' };
  if (!/[A-Z]/.test(password)) return { valid: false, error: '密码需要包含大写字母' };
  if (!/[0-9]/.test(password)) return { valid: false, error: '密码需要包含数字' };
  return { valid: true };
}
```

---

## 三、数据库查询层重复 (严重程度: ★★★★)

### 问题统计

| 查询模式 | 重复次数 | 位置 |
|---------|---------|------|
| User + Roles + Permissions | **3处** | auth.ts, users/route.ts, users/[id]/route.ts |
| User 存在性检查 | **5处** | login, register, users POST |
| Role 批量查询 | **4处** | register, users, users/[id]/roles |
| EvaluationSession + Project | **4处** | sessions/[id], evaluations/[id] |
| Project + Files + Evaluations | **3处** | projects/route.ts, projects/[id]/route.ts |
| 审计日志创建 | **30+处** | 应使用 AuditLogger |

### 关键问题：缓存未被利用

`getUserWithPermissions()` 已在 `auth.ts` 中实现并带缓存（5分钟TTL），但多数 API 直接查询：

```typescript
// 已有缓存实现（但未被使用）
// src/lib/auth.ts
export async function getUserWithPermissions(userId: string) {
  return getOrSet(
    cacheKeys.userPermissions(userId),
    () => prisma.user.findUnique({
      include: { userRoles: { include: { role: { include: { permissions: true } } } } }
    }),
    300 // 5分钟缓存
  );
}

// 但 users/route.ts 直接查询（无缓存）
const [users, total] = await Promise.all([
  prisma.user.findMany({
    include: {
      userRoles: { include: { role: { include: { permissions: true } } } },
      opencodeConfig: true,
    },
  }),
]);
```

### 重构建议

**创建 `src/lib/db-queries.ts` 统一查询服务:**

```typescript
// src/lib/db-queries.ts
import { prisma } from '@/lib/prisma';
import { getUserWithPermissions } from '@/lib/auth';

// User 查询
export async function findUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username } });
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export async function findUserById(userId: string) {
  return getUserWithPermissions(userId); // 使用缓存版本
}

// Role 查询
export async function findRoleByName(name: string) {
  return prisma.role.findUnique({ where: { name } });
}

export async function findRolesByIds(ids: string[]) {
  return prisma.role.findMany({ where: { id: { in: ids } } });
}

export async function findDefaultRole() {
  return findRoleByName('user');
}

// Project 查询
export const PROJECT_INCLUDE = {
  files: { orderBy: { uploadedAt: 'desc' } },
  evaluations: { orderBy: { startedAt: 'desc' }, take: 1 },
};

export async function findProjectById(id: string) {
  return prisma.project.findUnique({
    where: { id },
    include: PROJECT_INCLUDE,
  });
}

export async function findProjectsByUserId(userId: string, status?: string) {
  return prisma.project.findMany({
    where: { userId, ...(status && { status }) },
    include: PROJECT_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}

// Evaluation 查询
export async function findEvaluationById(id: string) {
  return prisma.evaluationSession.findUnique({
    where: { id },
    include: { project: { select: { id: true, name: true, userId: true } } },
  });
}

export async function findEvaluationBySessionId(sessionId: string) {
  return prisma.evaluationSession.findFirst({
    where: { opencodeSessionId: sessionId },
    include: { project: { select: { projectPath: true, userId: true } } },
  });
}

// Config 查询
export async function findUserConfigs(userId: string) {
  return prisma.opencodeConfig.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findActiveConfig() {
  return prisma.opencodeConfig.findFirst({
    where: { isActive: true },
  });
}
```

---

## 四、前端组件层重复 (严重程度: ★★★★)

### 问题统计

| 组件模式 | 重复次数 | 文件位置 |
|---------|---------|---------|
| Loading Spinner | **11个页面** | 所有 dashboard 页面 |
| Error Alert | **11个页面** | 所有 dashboard 页面 |
| Modal 结构 | **15+个** | users, roles, sessions, models, workflows... |
| Pagination | **5个页面** | users, roles, skills, mcp-servers, plugins |
| Search Input | **6个页面** | users, roles, skills, mcp-servers, plugins, workflows |
| Status Badge | **6个页面** | users, sessions, skills, models, mcp-servers |
| Empty State | **7个页面** | users, roles, sessions, skills, mcp-servers, plugins |
| Page Header | **11个页面** | 所有 dashboard 页面 |
| Form Field | **所有表单** | 所有 modal 表单 |
| API Fetch Hook | **11个页面** | 相同的 fetch + loading/error 状态 |

### 重复代码示例

```tsx
// Loading Spinner - 11个文件完全相同
<div className="flex items-center justify-center h-64">
  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
</div>

// Error Alert - 11个文件完全相同
{error && (
  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
    {error}
  </div>
)}

// Modal 结构 - 15+个模态框相同结构
<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
  <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
    <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <button onClick={onClose}>×</button>
    </div>
    <div className="p-6">{/* Content */}</div>
    <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200">
      <button onClick={onClose}>取消</button>
      <button onClick={onSubmit}>保存</button>
    </div>
  </div>
</div>
```

### 重构建议

**创建 `src/components/ui/` 组件库:**

```
src/components/ui/
├── LoadingSpinner.tsx    # 加载动画
├── Alert.tsx             # 提示组件（error/success/warning/info）
├── Modal.tsx             # 模态框基础组件
├── ConfirmDialog.tsx     # 确认对话框
├── Button.tsx            # 统一按钮
├── FormField.tsx         # 表单字段（label + input）
├── SearchInput.tsx       # 搜索输入框
├── DataTable.tsx         # 数据表格
├── Pagination.tsx        # 分页组件
├── StatusBadge.tsx       # 状态徽章
├── EmptyState.tsx        # 空状态展示
├── PageHeader.tsx        # 页面头部
├── StatsCard.tsx         # 统计卡片
├── Card.tsx              # 卡片容器
└── hooks/
    ├── useApiFetch.ts    # API 请求 Hook
    ├── useFormState.ts   # 表单状态 Hook
    └── usePagination.ts  # 分页状态 Hook
```

**组件实现示例:**

```tsx
// LoadingSpinner.tsx
export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeMap = { sm: 'h-8 w-8', md: 'h-12 w-12', lg: 'h-16 w-16' };
  return (
    <div className="flex items-center justify-center h-64">
      <div className={`animate-spin rounded-full ${sizeMap[size]} border-b-2 border-t-2 border-blue-500`} />
    </div>
  );
}

// Alert.tsx
export function Alert({ type, message, icon }: { type: 'error' | 'success' | 'warning' | 'info'; message: string; icon?: React.ReactNode }) {
  const colorMap = {
    error: 'bg-red-50 border-red-200 text-red-700',
    success: 'bg-green-50 border-green-200 text-green-700',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    info: 'bg-blue-50 border-blue-200 text-blue-700',
  };
  return (
    <div className={`${colorMap[type]} border px-4 py-3 rounded flex items-center gap-2`}>
      {icon}
      {message}
    </div>
  );
}

// Modal.tsx
export function Modal({ title, isOpen, onClose, size = 'md', children, footer }: ModalProps) {
  if (!isOpen) return null;
  const sizeMap = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={`bg-white rounded-lg shadow-xl ${sizeMap[size]} w-full mx-4`}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">×</button>
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200">{footer}</div>}
      </div>
    </div>
  );
}

// useApiFetch.ts
export function useApiFetch<T>(url: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || '请求失败');
        return;
      }
      setData(await res.json());
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  }, [url]);

  return { data, loading, error, fetch, setData };
}
```

---

## 五、审计日志使用不一致 (严重程度: ★★★)

### 问题

已有完善的 `AuditLogger` 类 (`src/lib/audit/logger.ts`)，但：

| 使用方式 | 文件数 | 问题 |
|---------|-------|------|
| 使用 AuditLogger | **3处** | 仅 login, audit-logs/export, config/import |
| 直接 prisma.auditLog.create | **30+处** | 缺少 IP/User-Agent，同步/异步不一致 |

### 重构建议

推广 `AuditLogger` 类的使用，替换所有直接 `prisma.auditLog.create` 调用：

```typescript
// 替换所有类似代码
await prisma.auditLog.create({
  data: { userId, action: 'user_create', resource: user.id, details: JSON.stringify({...}) }
}).catch(err => console.error('记录审计日志失败:', err));

// 使用 AuditLogger
await AuditLogger.logUserManagement('user_create', payload.userId, user.id, request, {
  after: { email, username }
});
```

---

## 六、重构优先级与执行计划

### 阶段一：基础抽象层（预计减少 500+ 行重复）

| 优先级 | 任务 | 文件 | 预估工作量 |
|--------|------|------|-----------|
| P0 | 创建 `api-auth.ts` 认证中间件 | 新文件 | 2小时 |
| P0 | 创建 `api-response.ts` 响应格式 | 新文件 | 1小时 |
| P0 | 创建 `api-validation.ts` 验证工具 | 新文件 | 1小时 |
| P1 | 创建 `db-queries.ts` 查询服务 | 新文件 | 2小时 |

### 阶段二：API 路由迁移（预计减少 2000+ 行重复）

| 优先级 | 任务 | 文件数 | 预估工作量 |
|--------|------|--------|-----------|
| P0 | 认证中间件迁移 | 50+ | 4小时 |
| P1 | 响应格式统一 | 50+ | 2小时 |
| P1 | 审计日志迁移 | 30+ | 2小时 |
| P2 | 数据库查询迁移 | 20+ | 2小时 |

### 阶段三：前端组件库（预计减少 1000+ 行重复）

| 优先级 | 任务 | 组件数 | 预估工作量 |
|--------|------|--------|-----------|
| P1 | 基础组件（Spinner, Alert, Modal） | 5 | 3小时 |
| P1 | 数据组件（Table, Pagination, Badge） | 4 | 2小时 |
| P1 | Hooks（useApiFetch, useFormState） | 3 | 2小时 |
| P2 | 页面迁移 | 11 | 4小时 |

---

## 七、预估收益

| 收益项 | 当前状态 | 重构后 |
|--------|---------|--------|
| 代码行数 | ~3000+ 行重复 | 减少 80% |
| API 认证代码 | 每个文件 15+ 行 | 每个文件 3 行 |
| 错误消息一致性 | 30+ 种变体 | 8 种标准消息 |
| 审计日志质量 | 缺少 IP/User-Agent | 完整记录 |
| 新增 API 开发 | 15 分钟复制粘贴 | 5 分钟调用函数 |
| Bug 修复范围 | 多文件修改 | 单文件修改 |

---

## 八、风险与注意事项

1. **渐进式迁移**: 不要一次性修改所有文件，优先迁移高频修改的 API
2. **测试覆盖**: 每迁移一批文件，需验证功能正确性
3. **向后兼容**: 新工具函数应兼容现有响应格式，避免前端适配
4. **文档更新**: 更新 AGENTS.md 开发指南，说明新的编码规范

---

## 九、立即可行的快速改进

无需大规模重构的改进：

1. **删除重复验证函数**: 移除 `config/[id]/route.ts` 中的 `validateJsonField`，导入 `config/route.ts` 的版本
2. **统一导入路径**: 所有 API 统一从 `@/lib/auth` 导入 `verifyToken` 和 `hasPermission`
3. **推广 AuditLogger**: 新代码强制使用 AuditLogger，逐步迁移旧代码

---

*报告生成时间: 2026-04-16*
*分析范围: 169 API路由 + 11 前端页面 + 50+ lib/service文件*