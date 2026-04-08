# 审计日志完善实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完善审计日志系统，增加审计日志查询API、日志导出功能、敏感操作追踪和安全审计报告。

**Architecture:** 扩展现有AuditLog模型，添加审计日志中间件自动记录、审计日志查询服务、导出服务和安全审计报告生成器。

**Tech Stack:** Next.js API Routes, Prisma ORM, SQLite, CSV/JSON导出

---

## 现状分析

当前审计日志系统：
- **AuditLog模型** 已存在（prisma/schema.prisma 第200-214行）
- **已有审计日志记录** 在15个API路由中已实现
- **字段**：userId, action, resource, details, ipAddress, userAgent, createdAt

**需要完善的功能**：
1. 审计日志查询API（分页、过滤、搜索）
2. 审计日志导出（CSV、JSON格式）
3. 审计日志中间件（自动记录所有API请求）
4. 敏感操作追踪（密码修改、权限变更等）
5. 安全审计报告（登录统计、异常检测）
6. 审计日志清理策略（自动归档旧日志）

---

## 文件结构

```
src/lib/
├── audit/
│   ├── logger.ts              # 审计日志服务
│   ├── middleware.ts          # 审计日志中间件
│   ├── exporter.ts            # 审计日志导出器
│   └── reporter.ts            # 安全审计报告生成器

src/app/api/
├── admin/audit-logs/
│   ├── route.ts               # 审计日志查询API
│   ├── export/route.ts        # 审计日志导出API
│   └── report/route.ts        # 安全审计报告API
└── admin/audit-logs/[id]/
    └── route.ts               # 单条审计日志详情

src/types/
└── audit.ts                   # 审计日志类型定义
```

---

### Task 1: 审计日志类型定义

**Files:**
- Create: `src/types/audit.ts`

- [ ] **Step 1: 创建审计日志类型定义**

```typescript
// src/types/audit.ts

// 审计操作类型
export type AuditAction =
  // 认证相关
  | 'login'
  | 'logout'
  | 'login_failed'
  | 'password_change'
  | 'password_reset'
  | 'token_refresh'
  
  // 用户管理
  | 'user_create'
  | 'user_update'
  | 'user_delete'
  | 'user_assign_role'
  | 'user_activate'
  | 'user_deactivate'
  
  // 角色权限
  | 'role_create'
  | 'role_update'
  | 'role_delete'
  | 'role_assign_permission'
  
  // 工作流
  | 'workflow_create'
  | 'workflow_update'
  | 'workflow_delete'
  | 'workflow_execute'
  | 'workflow_share'
  | 'workflow_unshare'
  | 'workflow_data_update'
  
  // 执行记录
  | 'execution_cancel'
  | 'execution_delete'
  | 'execution_view'
  
  // 配置管理
  | 'config_create'
  | 'config_update'
  | 'config_delete'
  | 'cache_clear'
  
  // 告警规则
  | 'alert_rule_create'
  | 'alert_rule_update'
  | 'alert_rule_delete'
  | 'alert_acknowledge'
  | 'alert_resolve'
  
  // 通知渠道
  | 'notification_channel_create'
  | 'notification_channel_update'
  | 'notification_channel_delete'
  
  // 安全相关
  | 'permission_denied'
  | 'suspicious_activity'
  | 'api_key_create'
  | 'api_key_delete'
  
  // 数据导出
  | 'data_export'
  | 'report_generate';

// 操作类别
export type AuditCategory = 
  | 'authentication'
  | 'user_management'
  | 'role_management'
  | 'workflow'
  | 'execution'
  | 'configuration'
  | 'security'
  | 'data_export';

// 审计日志详情接口
export interface AuditLogDetails {
  // 通用字段
  action: AuditAction;
  category: AuditCategory;
  resource?: string;
  resourceId?: string;
  
  // 变更详情
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  
  // 请求信息
  ip?: string;
  userAgent?: string;
  
  // 结果
  success: boolean;
  errorMessage?: string;
  
  // 额外数据
  metadata?: Record<string, unknown>;
}

// 审计日志查询参数
export interface AuditLogQueryParams {
  page?: number;
  limit?: number;
  userId?: string;
  action?: AuditAction | AuditAction[];
  category?: AuditCategory;
  resource?: string;
  startDate?: Date | string;
  endDate?: Date | string;
  success?: boolean;
  ipAddress?: string;
  search?: string;
}

// 审计日志响应
export interface AuditLogResponse {
  id: string;
  userId: string | null;
  action: string;
  resource: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  user?: {
    id: string;
    username: string;
    email: string;
  };
}

// 安全审计报告
export interface SecurityAuditReport {
  reportDate: Date;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalEvents: number;
    uniqueUsers: number;
    failedLogins: number;
    successfulLogins: number;
    suspiciousActivities: number;
    permissionDenied: number;
    sensitiveOperations: number;
  };
  topUsers: Array<{
    userId: string;
    username: string;
    eventCount: number;
  }>;
  topActions: Array<{
    action: string;
    count: number;
  }>;
  failedLoginAttempts: Array<{
    ipAddress: string;
    count: number;
    lastAttempt: Date;
  }>;
  suspiciousPatterns: Array<{
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    count: number;
    details: Record<string, unknown>;
  }>;
  recommendations: string[];
}

// 导出格式
export type ExportFormat = 'json' | 'csv';

// 操作类别映射
export const ACTION_CATEGORIES: Record<AuditAction, AuditCategory> = {
  // 认证
  login: 'authentication',
  logout: 'authentication',
  login_failed: 'authentication',
  password_change: 'authentication',
  password_reset: 'authentication',
  token_refresh: 'authentication',
  
  // 用户管理
  user_create: 'user_management',
  user_update: 'user_management',
  user_delete: 'user_management',
  user_assign_role: 'user_management',
  user_activate: 'user_management',
  user_deactivate: 'user_management',
  
  // 角色管理
  role_create: 'role_management',
  role_update: 'role_management',
  role_delete: 'role_management',
  role_assign_permission: 'role_management',
  
  // 工作流
  workflow_create: 'workflow',
  workflow_update: 'workflow',
  workflow_delete: 'workflow',
  workflow_execute: 'workflow',
  workflow_share: 'workflow',
  workflow_unshare: 'workflow',
  workflow_data_update: 'workflow',
  
  // 执行
  execution_cancel: 'execution',
  execution_delete: 'execution',
  execution_view: 'execution',
  
  // 配置
  config_create: 'configuration',
  config_update: 'configuration',
  config_delete: 'configuration',
  cache_clear: 'configuration',
  
  // 告警
  alert_rule_create: 'configuration',
  alert_rule_update: 'configuration',
  alert_rule_delete: 'configuration',
  alert_acknowledge: 'configuration',
  alert_resolve: 'configuration',
  
  // 通知
  notification_channel_create: 'configuration',
  notification_channel_update: 'configuration',
  notification_channel_delete: 'configuration',
  
  // 安全
  permission_denied: 'security',
  suspicious_activity: 'security',
  api_key_create: 'security',
  api_key_delete: 'security',
  
  // 数据导出
  data_export: 'data_export',
  report_generate: 'data_export',
};

// 敏感操作列表
export const SENSITIVE_ACTIONS: AuditAction[] = [
  'password_change',
  'user_delete',
  'role_assign_permission',
  'workflow_share',
  'config_update',
  'config_delete',
  'cache_clear',
  'alert_rule_delete',
  'notification_channel_delete',
  'api_key_create',
  'api_key_delete',
];
```

- [ ] **Step 2: 提交类型定义**

```bash
git add src/types/audit.ts
git commit -m "feat: 添加审计日志类型定义

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 审计日志服务

**Files:**
- Create: `src/lib/audit/logger.ts`

- [ ] **Step 1: 创建审计日志服务**

```typescript
// src/lib/audit/logger.ts

import { prisma } from '@/lib/prisma';
import type { AuditAction, AuditLogDetails, AuditCategory, ACTION_CATEGORIES } from '@/types/audit';
import { ACTION_CATEGORIES as actionCategories, SENSITIVE_ACTIONS } from '@/types/audit';

interface CreateAuditLogParams {
  userId?: string | null;
  action: AuditAction;
  resource?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

interface RequestInfo {
  ip?: string;
  userAgent?: string;
}

/**
 * 审计日志服务
 * 提供统一的审计日志记录接口
 */
export class AuditLogger {
  /**
   * 记录审计日志
   */
  static async log(params: CreateAuditLogParams): Promise<void> {
    try {
      const category = actionCategories[params.action];
      
      const details: Record<string, unknown> = {
        action: params.action,
        category,
        success: params.success ?? true,
        ...(params.details || {}),
      };

      if (params.errorMessage) {
        details.errorMessage = params.errorMessage;
        details.success = false;
      }

      if (params.metadata) {
        details.metadata = params.metadata;
      }

      await prisma.auditLog.create({
        data: {
          userId: params.userId || null,
          action: params.action,
          resource: params.resource || null,
          details: JSON.stringify(details),
          ipAddress: params.ipAddress || null,
          userAgent: params.userAgent || null,
        },
      });
    } catch (error) {
      // 审计日志记录失败不应该影响主流程
      console.error('Failed to create audit log:', error);
    }
  }

  /**
   * 从请求中提取信息并记录审计日志
   */
  static async logFromRequest(
    request: Request,
    params: Omit<CreateAuditLogParams, 'ipAddress' | 'userAgent'>
  ): Promise<void> {
    const requestInfo = extractRequestInfo(request);
    
    await AuditLogger.log({
      ...params,
      ipAddress: requestInfo.ip,
      userAgent: requestInfo.userAgent,
    });
  }

  /**
   * 记录认证事件
   */
  static async logAuth(
    action: 'login' | 'logout' | 'login_failed' | 'password_change' | 'password_reset',
    userId: string | undefined,
    request: Request,
    options?: { success?: boolean; errorMessage?: string; metadata?: Record<string, unknown> }
  ): Promise<void> {
    await AuditLogger.logFromRequest(request, {
      userId,
      action,
      success: options?.success,
      errorMessage: options?.errorMessage,
      metadata: options?.metadata,
    });
  }

  /**
   * 记录用户管理事件
   */
  static async logUserManagement(
    action: 'user_create' | 'user_update' | 'user_delete' | 'user_assign_role' | 'user_activate' | 'user_deactivate',
    operatorId: string,
    targetUserId: string,
    request: Request,
    options?: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ): Promise<void> {
    await AuditLogger.logFromRequest(request, {
      userId: operatorId,
      action,
      resource: targetUserId,
      details: {
        targetUserId,
        before: options?.before,
        after: options?.after,
      },
    });
  }

  /**
   * 记录工作流事件
   */
  static async logWorkflow(
    action: 'workflow_create' | 'workflow_update' | 'workflow_delete' | 'workflow_execute' | 'workflow_share' | 'workflow_unshare' | 'workflow_data_update',
    userId: string,
    workflowId: string,
    request: Request,
    options?: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ): Promise<void> {
    await AuditLogger.logFromRequest(request, {
      userId,
      action,
      resource: workflowId,
      details: {
        workflowId,
        before: options?.before,
        after: options?.after,
      },
    });
  }

  /**
   * 记录配置变更
   */
  static async logConfig(
    action: 'config_create' | 'config_update' | 'config_delete' | 'cache_clear',
    userId: string,
    resource: string,
    request: Request,
    options?: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ): Promise<void> {
    await AuditLogger.logFromRequest(request, {
      userId,
      action,
      resource,
      details: {
        before: options?.before,
        after: options?.after,
      },
    });
  }

  /**
   * 记录权限拒绝事件
   */
  static async logPermissionDenied(
    userId: string | undefined,
    requiredPermission: string,
    request: Request
  ): Promise<void> {
    await AuditLogger.logFromRequest(request, {
      userId,
      action: 'permission_denied',
      details: {
        requiredPermission,
        success: false,
      },
    });
  }

  /**
   * 记录数据导出事件
   */
  static async logDataExport(
    userId: string,
    exportType: string,
    request: Request,
    options?: { format?: string; recordCount?: number }
  ): Promise<void> {
    await AuditLogger.logFromRequest(request, {
      userId,
      action: 'data_export',
      details: {
        exportType,
        format: options?.format,
        recordCount: options?.recordCount,
      },
    });
  }

  /**
   * 检查是否为敏感操作
   */
  static isSensitiveAction(action: AuditAction): boolean {
    return SENSITIVE_ACTIONS.includes(action);
  }

  /**
   * 获取操作的类别
   */
  static getActionCategory(action: AuditAction): AuditCategory {
    return actionCategories[action];
  }
}

/**
 * 从请求中提取IP和User-Agent
 */
export function extractRequestInfo(request: Request): RequestInfo {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 
             request.headers.get('x-real-ip') || 
             undefined;
  
  return {
    ip,
    userAgent: request.headers.get('user-agent') || undefined,
  };
}

// 导出便捷函数
export const auditLog = AuditLogger.log;
export const auditLogFromRequest = AuditLogger.logFromRequest;
export const auditLogAuth = AuditLogger.logAuth;
export const auditLogUserManagement = AuditLogger.logUserManagement;
export const auditLogWorkflow = AuditLogger.logWorkflow;
export const auditLogConfig = AuditLogger.logConfig;
export const auditLogPermissionDenied = AuditLogger.logPermissionDenied;
export const auditLogDataExport = AuditLogger.logDataExport;
```

- [ ] **Step 2: 提交审计日志服务**

```bash
git add src/lib/audit/logger.ts
git commit -m "feat: 实现审计日志服务

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: 审计日志查询API

**Files:**
- Create: `src/app/api/admin/audit-logs/route.ts`

- [ ] **Step 1: 创建审计日志查询API**

```typescript
// src/app/api/admin/audit-logs/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { buildDateRangeFilter, combineWhereClauses } from '@/lib/query-optimizer';
import type { AuditLogQueryParams } from '@/types/audit';

// GET /api/admin/audit-logs - 查询审计日志
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

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const userId = searchParams.get('userId') || undefined;
    const action = searchParams.get('action')?.split(',') || undefined;
    const resource = searchParams.get('resource') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const ipAddress = searchParams.get('ipAddress') || undefined;
    const search = searchParams.get('search') || undefined;

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    const where = combineWhereClauses(
      userId ? { userId } : undefined,
      action ? { action: { in: action } } : undefined,
      resource ? { resource: { contains: resource } } : undefined,
      ipAddress ? { ipAddress: { contains: ipAddress } } : undefined,
      { createdAt: buildDateRangeFilter(startDate, endDate) }
    );

    // 搜索条件（搜索details JSON）
    const searchWhere = search
      ? {
          OR: [
            { action: { contains: search } },
            { resource: { contains: search } },
            { details: { contains: search } },
          ],
        }
      : {};

    const finalWhere = {
      ...where,
      ...searchWhere,
    };

    // 查询总数和数据
    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where: finalWhere }),
      prisma.auditLog.findMany({
        where: finalWhere,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          // 通过userId关联查询用户信息
          // Note: Prisma schema中AuditLog没有直接的user关系，需要手动关联
        },
      }),
    ]);

    // 获取相关用户信息
    const userIds = [...new Set(logs.map((log) => log.userId).filter(Boolean))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, username: true, email: true, name: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // 组装响应数据
    const logsWithUsers = logs.map((log) => ({
      id: log.id,
      userId: log.userId,
      action: log.action,
      resource: log.resource,
      details: log.details ? JSON.parse(log.details) : null,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt,
      user: log.userId ? userMap.get(log.userId) : null,
    }));

    return NextResponse.json(createPaginatedResponse(logsWithUsers, total, pageNum, pageLimit));
  } catch (error) {
    console.error('Get audit logs error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 提交查询API**

```bash
git add src/app/api/admin/audit-logs/route.ts
git commit -m "feat: 添加审计日志查询API

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: 审计日志详情API

**Files:**
- Create: `src/app/api/admin/audit-logs/[id]/route.ts`

- [ ] **Step 1: 创建单条审计日志详情API**

```typescript
// src/app/api/admin/audit-logs/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/admin/audit-logs/[id] - 获取单条审计日志详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const log = await prisma.auditLog.findUnique({
      where: { id },
    });

    if (!log) {
      return NextResponse.json({ error: '审计日志不存在' }, { status: 404 });
    }

    // 获取用户信息
    let user = null;
    if (log.userId) {
      user = await prisma.user.findUnique({
        where: { id: log.userId },
        select: { id: true, username: true, email: true, name: true, avatar: true },
      });
    }

    // 解析details
    const details = log.details ? JSON.parse(log.details) : null;

    // 如果是敏感操作，检查权限
    const sensitiveActions = [
      'password_change',
      'user_delete',
      'config_update',
      'config_delete',
    ];

    if (sensitiveActions.includes(log.action)) {
      // 敏感操作需要更高权限
      if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
        return NextResponse.json({ error: '禁止访问敏感审计日志' }, { status: 403 });
      }
    }

    return NextResponse.json({
      log: {
        id: log.id,
        userId: log.userId,
        action: log.action,
        resource: log.resource,
        details,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt,
        user,
      },
    });
  } catch (error) {
    console.error('Get audit log detail error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 提交详情API**

```bash
git add src/app/api/admin/audit-logs/[id]/route.ts
git commit -m "feat: 添加审计日志详情API

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: 审计日志导出功能

**Files:**
- Create: `src/lib/audit/exporter.ts`
- Create: `src/app/api/admin/audit-logs/export/route.ts`

- [ ] **Step 1: 创建审计日志导出器**

```typescript
// src/lib/audit/exporter.ts

import { prisma } from '@/lib/prisma';
import type { AuditAction } from '@/types/audit';

export interface ExportOptions {
  format: 'json' | 'csv';
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  actions?: AuditAction[];
  limit?: number;
}

/**
 * 导出审计日志为JSON格式
 */
export async function exportToJson(options: ExportOptions): Promise<string> {
  const logs = await fetchLogs(options);

  const exportData = logs.map((log) => ({
    id: log.id,
    userId: log.userId,
    action: log.action,
    resource: log.resource,
    details: log.details ? JSON.parse(log.details) : null,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    createdAt: log.createdAt.toISOString(),
  }));

  return JSON.stringify(exportData, null, 2);
}

/**
 * 导出审计日志为CSV格式
 */
export async function exportToCsv(options: ExportOptions): Promise<string> {
  const logs = await fetchLogs(options);

  // CSV 头部
  const headers = [
    'ID',
    'User ID',
    'Action',
    'Resource',
    'IP Address',
    'User Agent',
    'Details',
    'Created At',
  ];

  // CSV 行
  const rows = logs.map((log) => [
    log.id,
    log.userId || '',
    log.action,
    log.resource || '',
    log.ipAddress || '',
    `"${(log.userAgent || '').replace(/"/g, '""')}"`,
    `"${(log.details || '').replace(/"/g, '""')}"`,
    log.createdAt.toISOString(),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * 获取审计日志数据
 */
async function fetchLogs(options: ExportOptions) {
  const where: Record<string, unknown> = {};

  if (options.userId) {
    where.userId = options.userId;
  }

  if (options.actions && options.actions.length > 0) {
    where.action = { in: options.actions };
  }

  if (options.startDate || options.endDate) {
    where.createdAt = {};
    if (options.startDate) {
      where.createdAt.gte = options.startDate;
    }
    if (options.endDate) {
      where.createdAt.lte = options.endDate;
    }
  }

  const limit = options.limit || 10000;

  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * 生成导出文件名
 */
export function generateExportFilename(format: 'json' | 'csv'): string {
  const date = new Date().toISOString().split('T')[0];
  return `audit-logs-${date}.${format}`;
}
```

- [ ] **Step 2: 创建导出API**

```typescript
// src/app/api/admin/audit-logs/export/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { exportToJson, exportToCsv, generateExportFilename } from '@/lib/audit/exporter';
import { auditLogDataExport, extractRequestInfo } from '@/lib/audit/logger';
import type { AuditAction } from '@/types/audit';

// GET /api/admin/audit-logs/export - 导出审计日志
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

    // 导出需要更高权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || 'json') as 'json' | 'csv';
    const startDate = searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined;
    const endDate = searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined;
    const userId = searchParams.get('userId') || undefined;
    const actions = searchParams.get('actions')?.split(',') as AuditAction[] | undefined;
    const limit = parseInt(searchParams.get('limit') || '10000');

    // 验证格式
    if (format !== 'json' && format !== 'csv') {
      return NextResponse.json({ error: '无效的导出格式' }, { status: 400 });
    }

    // 导出数据
    const data = format === 'json'
      ? await exportToJson({ format, startDate, endDate, userId, actions, limit })
      : await exportToCsv({ format, startDate, endDate, userId, actions, limit });

    // 记录导出操作
    await auditLogDataExport(payload.userId, 'audit_logs', request, {
      format,
      recordCount: format === 'json' 
        ? JSON.parse(data).length 
        : data.split('\n').length - 1, // 减去头部
    });

    // 设置响应头
    const filename = generateExportFilename(format);
    const contentType = format === 'json' 
      ? 'application/json' 
      : 'text/csv';

    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Export audit logs error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 提交导出功能**

```bash
git add src/lib/audit/exporter.ts src/app/api/admin/audit-logs/export/route.ts
git commit -m "feat: 实现审计日志导出功能（JSON/CSV格式）

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: 安全审计报告

**Files:**
- Create: `src/lib/audit/reporter.ts`
- Create: `src/app/api/admin/audit-logs/report/route.ts`

- [ ] **Step 1: 创建安全审计报告生成器**

```typescript
// src/lib/audit/reporter.ts

import { prisma } from '@/lib/prisma';
import type { SecurityAuditReport } from '@/types/audit';

export interface ReportOptions {
  startDate: Date;
  endDate: Date;
}

/**
 * 生成安全审计报告
 */
export async function generateSecurityReport(options: ReportOptions): Promise<SecurityAuditReport> {
  const { startDate, endDate } = options;

  // 获取时间范围内的所有审计日志
  const logs = await prisma.auditLog.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  // 获取用户信息
  const userIds = [...new Set(logs.map((log) => log.userId).filter(Boolean))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds as string[] } },
    select: { id: true, username: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // 计算摘要统计
  const summary = calculateSummary(logs);

  // 计算活跃用户
  const topUsers = calculateTopUsers(logs, userMap);

  // 计算热门操作
  const topActions = calculateTopActions(logs);

  // 检测失败登录尝试
  const failedLoginAttempts = detectFailedLogins(logs);

  // 检测可疑模式
  const suspiciousPatterns = detectSuspiciousPatterns(logs);

  // 生成建议
  const recommendations = generateRecommendations(summary, suspiciousPatterns);

  return {
    reportDate: new Date(),
    period: {
      start: startDate,
      end: endDate,
    },
    summary,
    topUsers,
    topActions,
    failedLoginAttempts,
    suspiciousPatterns,
    recommendations,
  };
}

/**
 * 计算摘要统计
 */
function calculateSummary(logs: { userId: string | null; action: string }[]) {
  const uniqueUsers = new Set(logs.map((log) => log.userId).filter(Boolean));
  
  const failedLogins = logs.filter((log) => log.action === 'login_failed').length;
  const successfulLogins = logs.filter((log) => log.action === 'login').length;
  const suspiciousActivities = logs.filter((log) => log.action === 'suspicious_activity').length;
  const permissionDenied = logs.filter((log) => log.action === 'permission_denied').length;
  
  const sensitiveActions = [
    'password_change',
    'user_delete',
    'role_assign_permission',
    'config_delete',
    'cache_clear',
  ];
  const sensitiveOperations = logs.filter((log) => sensitiveActions.includes(log.action)).length;

  return {
    totalEvents: logs.length,
    uniqueUsers: uniqueUsers.size,
    failedLogins,
    successfulLogins,
    suspiciousActivities,
    permissionDenied,
    sensitiveOperations,
  };
}

/**
 * 计算活跃用户Top 10
 */
function calculateTopUsers(
  logs: { userId: string | null }[],
  userMap: Map<string, { id: string; username: string; email: string }>
) {
  const userCounts = new Map<string, number>();

  for (const log of logs) {
    if (log.userId) {
      userCounts.set(log.userId, (userCounts.get(log.userId) || 0) + 1);
    }
  }

  return Array.from(userCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([userId, count]) => {
      const user = userMap.get(userId);
      return {
        userId,
        username: user?.username || 'Unknown',
        eventCount: count,
      };
    });
}

/**
 * 计算热门操作Top 10
 */
function calculateTopActions(logs: { action: string }[]) {
  const actionCounts = new Map<string, number>();

  for (const log of logs) {
    actionCounts.set(log.action, (actionCounts.get(log.action) || 0) + 1);
  }

  return Array.from(actionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([action, count]) => ({ action, count }));
}

/**
 * 检测失败登录尝试
 */
function detectFailedLogins(logs: { action: string; ipAddress: string | null; createdAt: Date }[]) {
  const failedLogins = logs.filter((log) => log.action === 'login_failed' && log.ipAddress);

  const ipCounts = new Map<string, { count: number; lastAttempt: Date }>();

  for (const log of failedLogins) {
    if (!log.ipAddress) continue;

    const existing = ipCounts.get(log.ipAddress);
    if (existing) {
      existing.count++;
      if (log.createdAt > existing.lastAttempt) {
        existing.lastAttempt = log.createdAt;
      }
    } else {
      ipCounts.set(log.ipAddress, { count: 1, lastAttempt: log.createdAt });
    }
  }

  return Array.from(ipCounts.entries())
    .filter(([, data]) => data.count >= 3) // 至少3次失败
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([ipAddress, data]) => ({
      ipAddress,
      count: data.count,
      lastAttempt: data.lastAttempt,
    }));
}

/**
 * 检测可疑模式
 */
function detectSuspiciousPatterns(logs: { action: string; userId: string | null; ipAddress: string | null; createdAt: Date; details: string | null }[]): SecurityAuditReport['suspiciousPatterns'] {
  const patterns: SecurityAuditReport['suspiciousPatterns'] = [];

  // 1. 检测短时间内大量权限拒绝
  const permissionDenied = logs.filter((log) => log.action === 'permission_denied');
  if (permissionDenied.length >= 5) {
    patterns.push({
      type: 'multiple_permission_denied',
      description: '检测到多次权限拒绝事件',
      severity: 'high',
      count: permissionDenied.length,
      details: { events: permissionDenied.slice(0, 5) },
    });
  }

  // 2. 检测来自同一IP的大量失败登录
  const failedByIp = new Map<string, number>();
  for (const log of logs) {
    if (log.action === 'login_failed' && log.ipAddress) {
      failedByIp.set(log.ipAddress, (failedByIp.get(log.ipAddress) || 0) + 1);
    }
  }

  for (const [ip, count] of failedByIp) {
    if (count >= 5) {
      patterns.push({
        type: 'brute_force_attempt',
        description: `IP ${ip} 有 ${count} 次失败登录尝试，可能存在暴力破解`,
        severity: 'high',
        count,
        details: { ipAddress: ip },
      });
    }
  }

  // 3. 检测非工作时间敏感操作
  const sensitiveActions = ['user_delete', 'config_delete', 'role_assign_permission'];
  const sensitiveOps = logs.filter((log) => sensitiveActions.includes(log.action));
  const offHoursOps = sensitiveOps.filter((log) => {
    const hour = log.createdAt.getHours();
    return hour < 6 || hour > 22; // 非工作时间（22:00-6:00）
  });

  if (offHoursOps.length > 0) {
    patterns.push({
      type: 'off_hours_sensitive_operations',
      description: '检测到非工作时间敏感操作',
      severity: 'medium',
      count: offHoursOps.length,
      details: { events: offHoursOps.slice(0, 5) },
    });
  }

  // 4. 检测同一用户多IP登录
  const userIps = new Map<string, Set<string>>();
  for (const log of logs) {
    if (log.action === 'login' && log.userId && log.ipAddress) {
      if (!userIps.has(log.userId)) {
        userIps.set(log.userId, new Set());
      }
      userIps.get(log.userId)!.add(log.ipAddress);
    }
  }

  for (const [userId, ips] of userIps) {
    if (ips.size >= 3) {
      patterns.push({
        type: 'multiple_ip_login',
        description: `用户 ${userId} 从 ${ips.size} 个不同IP登录`,
        severity: 'low',
        count: ips.size,
        details: { userId, ipAddresses: Array.from(ips) },
      });
    }
  }

  return patterns;
}

/**
 * 生成安全建议
 */
function generateRecommendations(
  summary: SecurityAuditReport['summary'],
  patterns: SecurityAuditReport['suspiciousPatterns']
): string[] {
  const recommendations: string[] = [];

  // 基于失败登录率
  const loginRate = summary.successfulLogins + summary.failedLogins > 0
    ? summary.failedLogins / (summary.successfulLogins + summary.failedLogins)
    : 0;

  if (loginRate > 0.3) {
    recommendations.push('失败登录率较高，建议加强密码策略或启用多因素认证');
  }

  // 基于可疑模式
  const highSeverityPatterns = patterns.filter((p) => p.severity === 'high');
  if (highSeverityPatterns.length > 0) {
    recommendations.push('发现高危安全事件，建议立即调查并采取相应措施');
  }

  const bruteForcePatterns = patterns.filter((p) => p.type === 'brute_force_attempt');
  if (bruteForcePatterns.length > 0) {
    recommendations.push('检测到暴力破解尝试，建议启用IP锁定或验证码保护');
  }

  // 基于权限拒绝
  if (summary.permissionDenied > 10) {
    recommendations.push('权限拒绝事件较多，建议审查用户角色分配');
  }

  // 基于敏感操作
  if (summary.sensitiveOperations > 0) {
    recommendations.push(`期间发生了 ${summary.sensitiveOperations} 次敏感操作，建议审核操作记录`);
  }

  // 默认建议
  if (recommendations.length === 0) {
    recommendations.push('系统运行正常，建议定期检查审计日志');
  }

  return recommendations;
}
```

- [ ] **Step 2: 创建安全报告API**

```typescript
// src/app/api/admin/audit-logs/report/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { generateSecurityReport } from '@/lib/audit/reporter';
import { auditLog } from '@/lib/audit/logger';

// GET /api/admin/audit-logs/report - 生成安全审计报告
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

    // 报告需要更高权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');

    // 默认最近7天
    const endDate = endDateStr ? new Date(endDateStr) : new Date();
    const startDate = startDateStr 
      ? new Date(startDateStr) 
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 验证日期范围
    if (startDate >= endDate) {
      return NextResponse.json({ error: '开始日期必须早于结束日期' }, { status: 400 });
    }

    // 限制日期范围（最多90天）
    const maxDays = 90;
    const daysDiff = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
    if (daysDiff > maxDays) {
      return NextResponse.json({ error: '日期范围不能超过90天' }, { status: 400 });
    }

    const report = await generateSecurityReport({ startDate, endDate });

    // 记录报告生成
    await auditLog({
      userId: payload.userId,
      action: 'report_generate',
      resource: 'security_audit_report',
      details: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalEvents: report.summary.totalEvents,
      },
    });

    return NextResponse.json({ report });
  } catch (error) {
    console.error('Generate security report error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 提交安全报告功能**

```bash
git add src/lib/audit/reporter.ts src/app/api/admin/audit-logs/report/route.ts
git commit -m "feat: 实现安全审计报告生成功能

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: 更新现有API使用审计日志服务

**Files:**
- Modify: `src/app/api/auth/login/route.ts`

- [ ] **Step 1: 更新登录API使用审计日志服务**

在 `src/app/api/auth/login/route.ts` 中，将现有的 `prisma.auditLog.create` 调用替换为使用审计日志服务：

```typescript
// 在文件顶部添加导入
import { auditLogAuth } from '@/lib/audit/logger';

// 替换现有的审计日志记录
// 旧代码：
// await prisma.auditLog.create({
//   data: {
//     userId: user.id,
//     action: 'login',
//     details: JSON.stringify({ method: 'username_password' }),
//   },
// });

// 新代码：
await auditLogAuth('login', user.id, request, {
  metadata: { method: 'username_password' },
});
```

- [ ] **Step 2: 提交登录API更新**

```bash
git add src/app/api/auth/login/route.ts
git commit -m "refactor: 登录API使用审计日志服务

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: 构建验证

**Files:**
- None (测试验证)

- [ ] **Step 1: 运行构建验证无错误**

```bash
npm run build
```

- [ ] **Step 2: 测试审计日志查询API**

```bash
curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/admin/audit-logs?page=1&limit=10"
```

预期: 返回分页的审计日志列表

- [ ] **Step 3: 测试安全审计报告API**

```bash
curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/admin/audit-logs/report"
```

预期: 返回安全审计报告JSON

---

## 总结

本计划完善了审计日志系统，实现了：
1. **审计日志类型定义** - 完整的操作类型和类别定义
2. **审计日志服务** - 统一的日志记录接口，支持从请求中提取信息
3. **审计日志查询API** - 分页、过滤、搜索功能
4. **审计日志详情API** - 单条日志详情查看
5. **审计日志导出** - JSON和CSV格式导出
6. **安全审计报告** - 自动分析异常行为，生成安全建议
