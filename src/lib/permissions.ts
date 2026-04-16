/**
 * 客户端安全的权限检查工具函数
 * 
 * 这些函数不依赖任何服务端环境变量，可以安全地在客户端组件中使用
 */

/**
 * 检查用户是否拥有指定权限
 */
export function hasPermission(userPermissions: string[] | undefined | null, requiredPermission: string): boolean {
  if (!userPermissions || !Array.isArray(userPermissions)) {
    return false;
  }
  return userPermissions.includes(requiredPermission);
}

/**
 * 检查用户是否拥有任意一个权限
 */
export function hasAnyPermission(userPermissions: string[] | undefined | null, requiredPermissions: string[]): boolean {
  if (!userPermissions || !Array.isArray(userPermissions)) {
    return false;
  }
  return requiredPermissions.some(perm => userPermissions.includes(perm));
}

/**
 * 检查用户是否拥有所有权限
 */
export function hasAllPermissions(userPermissions: string[] | undefined | null, requiredPermissions: string[]): boolean {
  if (!userPermissions || !Array.isArray(userPermissions)) {
    return false;
  }
  return requiredPermissions.every(perm => userPermissions.includes(perm));
}

/**
 * 检查用户是否拥有指定角色
 */
export function hasRole(userRoles: string[] | undefined | null, requiredRole: string): boolean {
  if (!userRoles || !Array.isArray(userRoles)) {
    return false;
  }
  return userRoles.includes(requiredRole);
}

/**
 * 检查用户是否拥有任意一个角色
 */
export function hasAnyRole(userRoles: string[] | undefined | null, requiredRoles: string[]): boolean {
  if (!userRoles || !Array.isArray(userRoles)) {
    return false;
  }
  return requiredRoles.some(role => userRoles.includes(role));
}

/**
 * 从 JWT token 解析用户权限（仅用于 UI 显示）
 *
 * ⚠️ 安全警告：
 * - 此函数使用 atob 解码，不验证签名
 * - 仅用于前端 UI 显示，不用于权限判断
 * - 所有权限判断必须在服务端进行
 * - 服务端 API 使用 verifyToken() 验证签名
 */
export function parseTokenPermissions(token: string): string[] {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.permissions || [];
  } catch {
    return [];
  }
}

/**
 * 从 JWT token 解析用户角色（仅用于 UI 显示）
 *
 * ⚠️ 安全警告：
 * - 此函数使用 atob 解码，不验证签名
 * - 仅用于前端 UI 显示，不用于权限判断
 * - 所有权限判断必须在服务端进行
 * - 服务端 API 使用 verifyToken() 验证签名
 */
export function parseTokenRoles(token: string): string[] {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.roles || [];
  } catch {
    return [];
  }
}
