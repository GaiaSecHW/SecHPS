/**
 * ID 生成工具函数
 * 
 * 统一的 ID 生成逻辑，确保格式一致性
 * 格式: {prefix}-{timestamp}-{random}
 * 
 * @example
 * generateId('user') // 'user-1703123456789-abc123def'
 * generateId('audit') // 'audit-1703123456789-xyz789ghi'
 */

/**
 * 生成唯一 ID
 * 
 * @param prefix - ID 前缀，如 'user', 'audit', 'skill' 等
 * @returns 格式为 '{prefix}-{timestamp}-{random}' 的唯一 ID
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * 常用 ID 前缀常量
 */
export const ID_PREFIXES = {
  USER: 'user',
  USER_ROLE: 'userrole',
  ROLE: 'role',
  PERMISSION: 'perm',
  AUDIT: 'audit',
  SESSION: 'session',
  PROJECT: 'project',
  WORKFLOW: 'workflow',
  SKILL: 'skill',
  SKILL_EXEC: 'sklexec',
  EVALUATION: 'eval',
  VULNERABILITY: 'vuln',
  MODEL: 'model',
  CONFIG: 'config',
  PLUGIN: 'plugin',
  MCP_SERVER: 'mcp',
  ALERT_RULE: 'alert-rule',
  NOTIFICATION: 'notif',
  MERGE: 'merge',
  ANALYSIS: 'analysis',
  GROUP: 'group',
  CATEGORY: 'cat',
  TOKEN_USAGE: 'token',
} as const;

/**
 * 使用预定义前缀生成 ID
 * 
 * @param prefixKey - ID_PREFIXES 中的键
 * @returns 格式为 '{prefix}-{timestamp}-{random}' 的唯一 ID
 * 
 * @example
 * generateIdWithPrefix('USER') // 'user-1703123456789-abc123def'
 */
export function generateIdWithPrefix(prefixKey: keyof typeof ID_PREFIXES): string {
  return generateId(ID_PREFIXES[prefixKey]);
}

/**
 * 生成带索引的唯一 ID
 * 
 * @param prefix - ID 前缀
 * @param index - 索引值
 * @returns 格式为 '{prefix}-{timestamp}-{index}-{random}' 的唯一 ID
 */
export function generateIndexedId(prefix: string, index: number): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `${prefix}-${timestamp}-${index}-${random}`;
}
