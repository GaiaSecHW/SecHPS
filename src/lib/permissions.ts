/**
 * 客户端安全的权限检查工具函数
 * 
 * 这些函数不依赖任何服务端环境变量，可以安全地在客户端组件中使用
 */

/**
 * 检查用户是否拥有指定权限
 */
export function hasPermission(userPermissions: string[], requiredPermission: string): boolean {
  return userPermissions.includes(requiredPermission);
}

/**
 * 检查用户是否拥有任意一个权限
 */
export function hasAnyPermission(userPermissions: string[], requiredPermissions: string[]): boolean {
  return requiredPermissions.some(perm => userPermissions.includes(perm));
}

/**
 * 检查用户是否拥有所有权限
 */
export function hasAllPermissions(userPermissions: string[], requiredPermissions: string[]): boolean {
  return requiredPermissions.every(perm => userPermissions.includes(perm));
}

/**
 * 检查用户是否拥有指定角色
 */
export function hasRole(userRoles: string[], requiredRole: string): boolean {
  return userRoles.includes(requiredRole);
}

/**
 * 检查用户是否拥有任意一个角色
 */
export function hasAnyRole(userRoles: string[], requiredRoles: string[]): boolean {
  return requiredRoles.some(role => userRoles.includes(role));
}

/**
 * 从 JWT token 解析用户权限
 * 注意：这只是一个简单的解码，不验证签名
 * 真正的权限验证应该在服务端进行
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
 * 从 JWT token 解析用户角色
 */
export function parseTokenRoles(token: string): string[] {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.roles || [];
  } catch {
    return [];
  }
}
