/**
 * API 认证中间件工具
 * 
 * 统一封装 Token 验证和权限检查，减少 API 路由中的重复代码
 */

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import type { JWTPayload } from '@/lib/auth';

/**
 * 认证结果类型
 */
export type AuthResult =
  | { success: true; payload: JWTPayload }
  | { success: false; error: string; statusCode: number };

/**
 * 认证请求选项
 */
export interface AuthenticateOptions {
  /** 可选：需要检查的权限 */
  requiredPermission?: string;
}

/**
 * 认证请求并可选地检查权限
 * 
 * @param request - Next.js Request 对象
 * @param options - 认证选项
 * @returns 认证结果，成功时包含 payload，失败时包含错误信息和状态码
 * 
 * @example
 * // 仅验证 Token
 * const auth = await authenticateRequest(request);
 * if (!auth.success) {
 *   return authErrorResponse(auth);
 * }
 * 
 * @example
 * // 验证 Token 并检查权限
 * const auth = await authenticateRequest(request, { requiredPermission: PERMISSIONS.USER_READ });
 * if (!auth.success) {
 *   return authErrorResponse(auth);
 * }
 */
export function authenticateRequest(
  request: Request,
  options?: AuthenticateOptions
): AuthResult {
  // 1. 检查 Authorization header
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return {
      success: false,
      error: '未授权',
      statusCode: 401,
    };
  }

  // 2. 提取并验证 Token
  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);

  if (!payload) {
    return {
      success: false,
      error: '无效的令牌',
      statusCode: 401,
    };
  }

  // 3. 可选：检查权限
  if (options?.requiredPermission) {
    if (!hasPermission(payload.permissions, options.requiredPermission)) {
      return {
        success: false,
        error: '禁止访问',
        statusCode: 403,
      };
    }
  }

  // 4. 认证成功
  return {
    success: true,
    payload,
  };
}

/**
 * 将认证失败结果转换为 NextResponse（格式 A: { error: 'message' }）
 * 
 * @param authResult - 失败的认证结果
 * @returns NextResponse 错误响应
 * 
 * @example
 * const auth = authenticateRequest(request);
 * if (!auth.success) {
 *   return authErrorResponse(auth);
 * }
 */
export function authErrorResponse(authResult: { success: false; error: string; statusCode: number }): NextResponse {
  return NextResponse.json(
    { error: authResult.error },
    { status: authResult.statusCode }
  );
}

/**
 * 将认证失败结果转换为 NextResponse（格式 B: { details: { error: 'message' } }）
 * 用于保持与现有 API 的向后兼容
 * 
 * @param authResult - 失败的认证结果
 * @returns NextResponse 错误响应
 * 
 * @example
 * const auth = authenticateRequest(request);
 * if (!auth.success) {
 *   return authErrorResponseNested(auth);
 * }
 */
export function authErrorResponseNested(authResult: { success: false; error: string; statusCode: number }): NextResponse {
  return NextResponse.json(
    { details: { error: authResult.error } },
    { status: authResult.statusCode }
  );
}

/**
 * 检查用户是否是管理员
 * 
 * @param payload - JWT payload
 * @returns 是否是管理员
 * 
 * @example
 * const auth = authenticateRequest(request);
 * if (!auth.success) return authErrorResponse(auth);
 * 
 * if (isAdmin(auth.payload)) {
 *   // 管理员可以查看所有数据
 * } else {
 *   // 普通用户只能查看自己的数据
 * }
 */
export function isAdmin(payload: JWTPayload): boolean {
  return Array.isArray(payload.roles) && payload.roles.includes('admin');
}

/**
 * 检查用户是否拥有指定角色
 * 
 * @param payload - JWT payload
 * @param role - 角色名称
 * @returns 是否拥有该角色
 */
export function hasRole(payload: JWTPayload, role: string): boolean {
  return Array.isArray(payload.roles) && payload.roles.includes(role);
}

/**
 * 获取用户 ID
 * 类型安全的获取用户 ID，避免重复的类型检查
 * 
 * @param payload - JWT payload
 * @returns 用户 ID
 */
export function getUserId(payload: JWTPayload): string {
  return payload.userId;
}

/**
 * 认证结果扩展类型（包含便捷方法）
 */
export interface AuthSuccessResult {
  success: true;
  payload: JWTPayload;
  /** 检查是否是管理员 */
  isAdmin: boolean;
  /** 获取用户 ID */
  userId: string;
}

/**
 * 增强版认证请求（返回更多便捷属性）
 * 
 * @param request - Next.js Request 对象
 * @param options - 认证选项
 * @returns 认证结果
 */
export function authenticateRequestEnhanced(
  request: Request,
  options?: AuthenticateOptions
): AuthResult | AuthSuccessResult {
  const result = authenticateRequest(request, options);
  
  if (result.success) {
    return {
      ...result,
      isAdmin: isAdmin(result.payload),
      userId: result.payload.userId,
    };
  }
  
  return result;
}