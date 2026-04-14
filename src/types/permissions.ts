// 权限常量定义
export const PERMISSIONS = {
  // 会话权限
  SESSION_CREATE: 'session:create',
  SESSION_READ: 'session:read',
  SESSION_UPDATE: 'session:update',
  SESSION_DELETE: 'session:delete',
  SESSION_SHARE: 'session:share',
  SESSION_REVERT: 'session:revert',

  // 用户管理权限
  USER_CREATE: 'user:create',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_ASSIGN_ROLE: 'user:assign_role',

  // 角色管理权限
  ROLE_CREATE: 'role:create',
  ROLE_READ: 'role:read',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',
  ROLE_ASSIGN_PERMISSION: 'role:assign_permission',

  // 权限管理权限
  PERMISSION_CREATE: 'permission:create',
  PERMISSION_READ: 'permission:read',
  PERMISSION_UPDATE: 'permission:update',
  PERMISSION_DELETE: 'permission:delete',

  // 配置管理权限
  CONFIG_READ: 'config:read',
  CONFIG_UPDATE: 'config:update',
  CONFIG_DELETE: 'config:delete',

  // 搜索权限
  SEARCH_FILE: 'search:file',
  SEARCH_SYMBOL: 'search:symbol',
  SEARCH_TEXT: 'search:text',

  // 文件操作权限
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',

  // 审计日志权限
  AUDIT_READ: 'audit:read',

  // 工作流权限
  WORKFLOW_CREATE: 'workflow:create',
  WORKFLOW_READ: 'workflow:read',
  WORKFLOW_UPDATE: 'workflow:update',
  WORKFLOW_DELETE: 'workflow:delete',
  WORKFLOW_SHARE: 'workflow:share',
  WORKFLOW_EXECUTE: 'workflow:execute',
  WORKFLOW_EXPORT: 'workflow:export',
  WORKFLOW_IMPORT: 'workflow:import',

  // 插件权限
  PLUGIN_CREATE: 'plugin:create',
  PLUGIN_READ: 'plugin:read',
  PLUGIN_UPDATE: 'plugin:update',
  PLUGIN_DELETE: 'plugin:delete',
  PLUGIN_TOGGLE: 'plugin:toggle',
  PLUGIN_EXECUTE: 'plugin:execute',

  // Agent权限
  AGENT_CHAT: 'agent:chat',
  AGENT_EXECUTE: 'agent:execute',
  AGENT_READ: 'agent:read',

  // 自主进化权限
  AUTONOMOUS_EVOLUTION_READ: 'autonomous_evolution:read',
  AUTONOMOUS_EVOLUTION_CREATE: 'autonomous_evolution:create',
  AUTONOMOUS_EVOLUTION_UPDATE: 'autonomous_evolution:update',
  AUTONOMOUS_EVOLUTION_DELETE: 'autonomous_evolution:delete',
  AUTONOMOUS_EVOLUTION_EXTRACT: 'autonomous_evolution:extract',
  AUTONOMOUS_EVOLUTION_INJECT: 'autonomous_evolution:inject',

  // 代码分析权限
  CODE_ANALYZE: 'code:analyze',
  CODE_READ: 'code:read',

  // 模型管理权限
  MODEL_CREATE: 'model:create',
  MODEL_READ: 'model:read',
  MODEL_UPDATE: 'model:update',
  MODEL_DELETE: 'model:delete',
  MODEL_TEST: 'model:test',

  // 通知管理权限
  NOTIFICATION_CREATE: 'notification:create',
  NOTIFICATION_READ: 'notification:read',
  NOTIFICATION_UPDATE: 'notification:update',
  NOTIFICATION_DELETE: 'notification:delete',

  // 技能权限
  SKILL_CREATE: 'skill:create',
  SKILL_READ: 'skill:read',
  SKILL_UPDATE: 'skill:update',
  SKILL_DELETE: 'skill:delete',
  SKILL_EXECUTE: 'skill:execute',

  // 漏洞权限
  VULNERABILITY_CREATE: 'vulnerability:create',
  VULNERABILITY_READ: 'vulnerability:read',
  VULNERABILITY_UPDATE: 'vulnerability:update',
  VULNERABILITY_DELETE: 'vulnerability:delete',

  // 评估权限
  EVALUATION_CREATE: 'evaluation:create',
  EVALUATION_READ: 'evaluation:read',
  EVALUATION_UPDATE: 'evaluation:update',
  EVALUATION_DELETE: 'evaluation:delete',

  // 项目权限
  PROJECT_CREATE: 'project:create',
  PROJECT_READ: 'project:read',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// 角色常量
export const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  VIEWER: 'viewer',
  DEVELOPER: 'developer',
  MANAGER: 'manager',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

// 默认角色权限映射
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [ROLES.ADMIN]: Object.values(PERMISSIONS), // 管理员拥有所有权限

  [ROLES.MANAGER]: [
    PERMISSIONS.SESSION_CREATE,
    PERMISSIONS.SESSION_READ,
    PERMISSIONS.SESSION_UPDATE,
    PERMISSIONS.SESSION_DELETE,
    PERMISSIONS.SESSION_SHARE,
    PERMISSIONS.SESSION_REVERT,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.ROLE_READ,
    PERMISSIONS.CONFIG_READ,
    PERMISSIONS.CONFIG_UPDATE,
    PERMISSIONS.SEARCH_FILE,
    PERMISSIONS.SEARCH_SYMBOL,
    PERMISSIONS.SEARCH_TEXT,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_WRITE,
    PERMISSIONS.AUDIT_READ,
    // 工作流权限
    PERMISSIONS.WORKFLOW_CREATE,
    PERMISSIONS.WORKFLOW_READ,
    PERMISSIONS.WORKFLOW_UPDATE,
    PERMISSIONS.WORKFLOW_DELETE,
    PERMISSIONS.WORKFLOW_SHARE,
    PERMISSIONS.WORKFLOW_EXECUTE,
    PERMISSIONS.WORKFLOW_EXPORT,
    PERMISSIONS.WORKFLOW_IMPORT,
    // 插件权限
    PERMISSIONS.PLUGIN_READ,
    PERMISSIONS.PLUGIN_CREATE,
    PERMISSIONS.PLUGIN_UPDATE,
    PERMISSIONS.PLUGIN_DELETE,
    PERMISSIONS.PLUGIN_TOGGLE,
  ],

  [ROLES.DEVELOPER]: [
    PERMISSIONS.SESSION_CREATE,
    PERMISSIONS.SESSION_READ,
    PERMISSIONS.SESSION_UPDATE,
    PERMISSIONS.SESSION_SHARE,
    PERMISSIONS.SEARCH_FILE,
    PERMISSIONS.SEARCH_SYMBOL,
    PERMISSIONS.SEARCH_TEXT,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.CONFIG_READ,
    // 工作流权限
    PERMISSIONS.WORKFLOW_CREATE,
    PERMISSIONS.WORKFLOW_READ,
    PERMISSIONS.WORKFLOW_UPDATE,
    PERMISSIONS.WORKFLOW_EXECUTE,
    PERMISSIONS.WORKFLOW_EXPORT,
    PERMISSIONS.WORKFLOW_IMPORT,
  ],

  [ROLES.USER]: [
    PERMISSIONS.SESSION_CREATE,
    PERMISSIONS.SESSION_READ,
    PERMISSIONS.SESSION_UPDATE,
    PERMISSIONS.SEARCH_FILE,
    PERMISSIONS.SEARCH_SYMBOL,
    PERMISSIONS.SEARCH_TEXT,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.CONFIG_READ,
    // 工作流权限
    PERMISSIONS.WORKFLOW_CREATE,
    PERMISSIONS.WORKFLOW_READ,
    PERMISSIONS.WORKFLOW_EXECUTE,
  ],

  [ROLES.VIEWER]: [
    PERMISSIONS.SESSION_READ,
    PERMISSIONS.SEARCH_FILE,
    PERMISSIONS.SEARCH_SYMBOL,
    PERMISSIONS.SEARCH_TEXT,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.CONFIG_READ,
    // 工作流权限
    PERMISSIONS.WORKFLOW_READ,
  ],
};
