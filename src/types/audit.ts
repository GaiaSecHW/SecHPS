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
