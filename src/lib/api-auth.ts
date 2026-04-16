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
 * 将认证失败结果转换为 NextResponse
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