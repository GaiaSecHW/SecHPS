/**
 * 统一的日志工具
 * 确保所有日志都包含操作人信息
 * 按天输出到日志文件 + 控制台
 */

import { JWTPayload } from '@/lib/auth';

const isServer = typeof window === 'undefined';

let logDirReady = false;
let LOG_DIR = '';

function dateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

async function writeToFile(level: string, message: string) {
  if (!isServer) return;
  try {
    // webpackIgnore: prevent webpack from bundling Node.js built-ins
    const { appendFile } = await import(/* webpackIgnore: true */ 'fs/promises');
    const { existsSync } = await import(/* webpackIgnore: true */ 'fs');
    const { join } = await import(/* webpackIgnore: true */ 'path');
    if (!LOG_DIR) LOG_DIR = process.env.LOG_DIR || join(process.cwd(), 'logs');
    if (!logDirReady) {
      if (!existsSync(LOG_DIR)) {
        const { mkdir } = await import(/* webpackIgnore: true */ 'fs/promises');
        await mkdir(LOG_DIR, { recursive: true });
      }
      logDirReady = true;
    }
    await appendFile(join(LOG_DIR, `log-${dateStr()}.log`), `${message}\n`);
  } catch {}
}

// ========== 日志归档调度器（服务端专用，由 instrumentation.ts 调用）==========
// 实现在 src/lib/log-archiver.ts，此处仅作类型占位，避免客户端引用

export function startLogArchiveScheduler() {
  // 实际实现在 log-archiver.ts，由 instrumentation.ts 直接调用
  // 此函数保留是为了向后兼容，不做任何事
}

// 日志级别
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

// 日志上下文
interface LogContext {
  userId?: string;
  username?: string;  // 用户名（注册名）
  roles?: string[];
  resource?: string;
  action?: string;
  details?: any;
  // 目标用户 - 用于记录谁在使用谁的资源
  targetUserId?: string;
  targetUsername?: string;  // 目标用户名
  // 其他常用字段
  deletedCount?: number;
  count?: number;
  [key: string]: any;  // 允许其他任意字段
}

// 常用模块名称常量
export const LOG_MODULES = {
  AUTH: 'AUTH',
  PROJECT: 'PROJECT',
  MODEL: 'MODEL',
  WORKFLOW: 'WORKFLOW',
  EVALUATION: 'EVALUATION',
  VULNERABILITY: 'VULNERABILITY',
  USER: 'USER',
  ROLE: 'ROLE',
  PERMISSION: 'PERMISSION',
  CONFIG: 'CONFIG',
  SESSION: 'SESSION',
  TOKEN: 'TOKEN',
  MCP: 'MCP',
  PLUGIN: 'PLUGIN',
  SKILL: 'SKILL',
  SKILL_EVOLUTION: 'SKILL_EVOLUTION',
  AUDIT: 'AUDIT',
  AGENT: 'AGENT',
  FILE: 'FILE',
  CODE: 'CODE',
  FSM: 'FSM',
  REPORT: 'REPORT',
  CODESWARM: 'CODESWARM',
  GITEA: 'GITEA',
  STREAM: 'STREAM',
  MINIO: 'MINIO',
  PROVIDER: 'PROVIDER',
  TOOL: 'TOOL',
  MONITOR: 'MONITOR',
  WEBSOCKET: 'WEBSOCKET',
};

// 格式化用户信息
function formatUserInfo(payload?: JWTPayload): string {
  if (!payload) return '[未认证]';
  const username = payload.email || payload.userId;
  const roles = payload.roles?.join(',') || '无角色';
  return `[用户:${username} 角色:${roles}]`;
}

// 格式化时间戳
function formatTimestamp(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).replace(/\//g, '-');
}

// 核心日志函数
function log(level: LogLevel, module: string, message: string, context?: LogContext) {
  const timestamp = formatTimestamp();
  const userInfo = context?.userId 
    ? `[操作人:${context.username || context.userId}]`
    : '';
  const targetUser = context?.targetUserId || context?.targetUsername
    ? `[目标用户:${context.targetUsername || context.targetUserId}]`
    : '';
  const resource = context?.resource ? `[资源:${context.resource}]` : '';
  const details = context?.details ? JSON.stringify(context.details) : '';
  
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] [${module}] ${userInfo} ${targetUser} ${resource} ${message} ${details}`;

  // 输出到控制台
  switch (level) {
    case 'info':
      console.log(logMessage);
      break;
    case 'warn':
      console.warn(logMessage);
      break;
    case 'error':
      console.error(logMessage);
      break;
    case 'debug':
      if (process.env.NODE_ENV === 'development') {
        console.log(logMessage);
      }
      break;
  }

  // 写入日志文件（非 debug，或开发环境下 debug 也写）
  if (level !== 'debug' || process.env.NODE_ENV === 'development') {
    writeToFile(level, logMessage);
  }
}

// 从 JWT payload 构建日志上下文
function buildContext(payload: JWTPayload, resource?: string, action?: string, details?: any): LogContext {
  return {
    userId: payload.userId,
    username: payload.username,  // 使用用户名
    roles: payload.roles,
    resource,
    action,
    details,
  };
}

// 构建跨用户操作日志上下文（谁在使用谁的资源）
function buildCrossUserContext(
  payload: JWTPayload, 
  targetUserId?: string, 
  targetUsername?: string,
  resource?: string, 
  action?: string, 
  details?: any
): LogContext {
  return {
    userId: payload.userId,
    username: payload.username,
    roles: payload.roles,
    targetUserId,
    targetUsername,
    resource,
    action,
    details,
  };
}

// ========== 审计专用日志方法（定义在前，供 logger 对象引用）==========

/**
 * 权限拒绝日志 - 记录用户尝试访问无权限资源
 */
function logPermissionDenied(
  module: string,
  payload: JWTPayload,
  permission: string,
  resource?: string,
  details?: any
) {
  log('warn', module, `权限拒绝: 缺少 ${permission}`, buildContext(payload, resource, 'permission_denied', { requiredPermission: permission, ...details }));
}

/**
 * 登录成功日志
 */
function logLoginSuccess(userId: string, username: string, details?: any) {
  log('info', LOG_MODULES.AUTH, '登录成功', { userId, username, details: { ...details, action: 'login_success' } });
}

/**
 * 登录失败日志（有用户信息）
 */
function logLoginFailed(username: string, reason: string, details?: any) {
  log('warn', LOG_MODULES.AUTH, `登录失败: ${reason}`, { username, details: { reason, ...details, action: 'login_failed' } });
}

/**
 * 登录失败日志（无用户信息）
 */
function logLoginFailedNoUser(username: string, reason: string, details?: any) {
  log('warn', LOG_MODULES.AUTH, `登录失败: ${reason}`, { username, details: { reason, username, ...details, action: 'login_failed' } });
}

/**
 * 获取数据日志 - 记录读取操作
 */
function logRead(
  module: string,
  payload: JWTPayload,
  resourceType: string,
  resourceId?: string,
  details?: any
) {
  log('info', module, `读取 ${resourceType}`, buildContext(payload, resourceId || resourceType, 'read', { resourceType, ...details }));
}

/**
 * 获取他人数据日志 - 管理员读取其他用户的数据
 */
function logReadOther(
  module: string,
  payload: JWTPayload,
  targetUserId: string,
  targetUsername?: string,
  resourceType?: string,
  resourceId?: string,
  details?: any
) {
  log('info', module, `读取他人资源 ${resourceType || ''}`, buildCrossUserContext(payload, targetUserId, targetUsername, resourceId, 'read_other', { resourceType, ...details }));
}

/**
 * 列表查询日志 - 记录批量查询操作
 */
function logList(
  module: string,
  payload: JWTPayload,
  resourceType: string,
  filters?: Record<string, any>,
  count?: number
) {
  log('info', module, `查询 ${resourceType} 列表`, buildContext(payload, resourceType, 'list', { filters, count }));
}

/**
 * 操作失败日志（带权限信息）
 */
function logOperationFailed(
  module: string,
  payload: JWTPayload,
  operation: string,
  error: string,
  resource?: string,
  details?: any
) {
  log('error', module, `${operation} 失败: ${error}`, buildContext(payload, resource, 'operation_failed', { operation, error, ...details }));
}

/**
 * Token刷新日志
 */
function logTokenRefresh(payload: JWTPayload, details?: any) {
  log('info', LOG_MODULES.AUTH, 'Token刷新', buildContext(payload, undefined, 'token_refresh', details));
}

/**
 * Token刷新失败日志
 */
function logTokenRefreshFailed(reason: string, details?: any) {
  log('warn', LOG_MODULES.AUTH, `Token刷新失败: ${reason}`, { details: { reason, ...details, action: 'token_refresh_failed' } });
}

/**
 * 注销日志
 */
function logLogout(payload: JWTPayload, details?: any) {
  log('info', LOG_MODULES.AUTH, '用户注销', buildContext(payload, undefined, 'logout', details));
}

// ========== 导出的日志对象 ==========

export const logger = {
  info: (module: string, message: string, context?: LogContext) => 
    log('info', module, message, context),
  
  warn: (module: string, message: string, context?: LogContext) => 
    log('warn', module, message, context),
  
  error: (module: string, message: string, context?: LogContext) => 
    log('error', module, message, context),
  
  debug: (module: string, message: string, context?: LogContext) => 
    log('debug', module, message, context),
  
  // 操作日志 - 创建
  create: (module: string, payload: JWTPayload, resource: string, details?: any) => 
    log('info', module, '创建成功', buildContext(payload, resource, 'create', details)),
  
  // 操作日志 - 更新
  update: (module: string, payload: JWTPayload, resource: string, details?: any) => 
    log('info', module, '更新成功', buildContext(payload, resource, 'update', details)),
  
  // 操作日志 - 删除
  delete: (module: string, payload: JWTPayload, resource: string, details?: any) => 
    log('info', module, '删除成功', buildContext(payload, resource, 'delete', details)),
  
  // 操作日志 - 访问
  access: (module: string, payload: JWTPayload, resource: string, details?: any) => 
    log('info', module, '访问资源', buildContext(payload, resource, 'access', details)),
  
  // 错误日志 - 操作失败
  errorWithUser: (module: string, payload: JWTPayload, error: string, resource?: string, details?: any) => 
    log('error', module, `操作失败: ${error}`, buildContext(payload, resource, 'error', details)),
  
  // 无用户信息的错误日志
  errorNoUser: (module: string, message: string, details?: any) => 
    log('error', module, message, { details }),
  
  // 无用户信息的一般日志
  logNoUser: (module: string, message: string, details?: any) => 
    log('info', module, message, { details }),
  
  // ========== 跨用户操作日志（谁在使用谁的资源）==========
  
  // 跨用户访问 - 操作人访问目标用户的资源
  accessOther: (
    module: string, 
    payload: JWTPayload, 
    targetUserId: string, 
    resource: string, 
    targetUsername?: string,
    details?: any
  ) => log('info', module, '访问他人资源', buildCrossUserContext(payload, targetUserId, targetUsername, resource, 'access_other', details)),
  
  // 跨用户更新 - 操作人更新目标用户的资源
  updateOther: (
    module: string, 
    payload: JWTPayload, 
    targetUserId: string, 
    resource: string, 
    targetUsername?: string,
    details?: any
  ) => log('info', module, '更新他人资源', buildCrossUserContext(payload, targetUserId, targetUsername, resource, 'update_other', details)),
  
  // 跨用户删除 - 操作人删除目标用户的资源
  deleteOther: (
    module: string, 
    payload: JWTPayload, 
    targetUserId: string, 
    resource: string, 
    targetUsername?: string,
    details?: any
  ) => log('info', module, '删除他人资源', buildCrossUserContext(payload, targetUserId, targetUsername, resource, 'delete_other', details)),
  
  // 跨用户操作失败
  errorOther: (
    module: string, 
    payload: JWTPayload, 
    targetUserId: string, 
    error: string, 
    targetUsername?: string,
    resource?: string, 
    details?: any
  ) => log('error', module, `操作他人资源失败: ${error}`, buildCrossUserContext(payload, targetUserId, targetUsername, resource, 'error_other', details)),
  
  // 自带目标用户上下文的通用日志
  withTarget: (
    level: LogLevel,
    module: string, 
    message: string, 
    payload: JWTPayload, 
    targetUserId?: string, 
    targetUsername?: string,
    resource?: string, 
    details?: any
  ) => log(level, module, message, buildCrossUserContext(payload, targetUserId, targetUsername, resource, undefined, details)),
  
  // ========== 审计专用日志方法 ==========
  
  // 权限拒绝日志
  permissionDenied: logPermissionDenied,
  
  // 登录成功日志
  loginSuccess: logLoginSuccess,
  
  // 登录失败日志（有用户信息）
  loginFailed: logLoginFailed,
  
  // 登录失败日志（无用户信息）
  loginFailedNoUser: logLoginFailedNoUser,
  
  // 读取数据日志
  read: logRead,
  
  // 读取他人数据日志
  readOther: logReadOther,
  
  // 列表查询日志
  list: logList,
  
  // 操作失败日志
  operationFailed: logOperationFailed,
  
  // Token刷新日志
  tokenRefresh: logTokenRefresh,
  
  // Token刷新失败日志
  tokenRefreshFailed: logTokenRefreshFailed,
  
  // 注销日志
  logout: logLogout,
};