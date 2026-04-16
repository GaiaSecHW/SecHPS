/**
 * 统一的日志工具
 * 确保所有日志都包含操作人信息
 */

import { JWTPayload } from '@/lib/auth';

// 日志级别
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

// 日志上下文
interface LogContext {
  userId?: string;
  userEmail?: string;
  username?: string;
  roles?: string[];
  resource?: string;
  action?: string;
  details?: any;
}

// 格式化用户信息
function formatUserInfo(payload?: JWTPayload): string {
  if (!payload) return '[未认证]';
  const username = payload.email || payload.userId;
  const roles = payload.roles?.join(',') || '无角色';
  return `[用户:${username} 角色:${roles}]`;
}

// 格式化时间戳
function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// 核心日志函数
function log(level: LogLevel, module: string, message: string, context?: LogContext) {
  const timestamp = formatTimestamp();
  const userInfo = context?.userId 
    ? `[用户:${context.userId} ${context.username || ''}]`
    : '';
  const resource = context?.resource ? `[资源:${context.resource}]` : '';
  const details = context?.details ? JSON.stringify(context.details) : '';
  
  const logMessage = `[${timestamp}] [${module}] ${userInfo} ${resource} ${message} ${details}`;
  
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
}

// 从 JWT payload 构建日志上下文
function buildContext(payload: JWTPayload, resource?: string, action?: string, details?: any): LogContext {
  return {
    userId: payload.userId,
    userEmail: payload.email,
    username: payload.email, // 使用 email 作为用户名标识
    roles: payload.roles,
    resource,
    action,
    details,
  };
}

// 导出的日志函数
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
};

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
  AUDIT: 'AUDIT',
  AGENT: 'AGENT',
  FILE: 'FILE',
  CODE: 'CODE',
};