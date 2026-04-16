/**
 * API 响应助手
 * 
 * 提供标准化的 API 响应函数，确保响应格式一致
 */

import { NextResponse } from 'next/server';

// 默认错误消息（与现有代码保持一致）
const DEFAULT_MESSAGES = {
  UNAUTHORIZED: '未授权',
  INVALID_TOKEN: '无效的令牌',
  FORBIDDEN: '禁止访问',
  BAD_REQUEST: '请求参数错误',
  NOT_FOUND: '资源不存在',
  SERVER_ERROR: '服务器内部错误',
};

/**
 * 401 未授权响应
 * 
 * @param message - 可选的自定义错误消息，默认为 '未授权'
 * @returns NextResponse
 */
export function unauthorized(message?: string): NextResponse {
  return NextResponse.json(
    { error: message || DEFAULT_MESSAGES.UNAUTHORIZED },
    { status: 401 }
  );
}

/**
 * 401 无效令牌响应
 * 
 * @param message - 可选的自定义错误消息，默认为 '无效的令牌'
 * @returns NextResponse
 */
export function invalidToken(message?: string): NextResponse {
  return NextResponse.json(
    { error: message || DEFAULT_MESSAGES.INVALID_TOKEN },
    { status: 401 }
  );
}

/**
 * 403 禁止访问响应
 * 
 * @param message - 可选的自定义错误消息，默认为 '禁止访问'
 * @returns NextResponse
 */
export function forbidden(message?: string): NextResponse {
  return NextResponse.json(
    { error: message || DEFAULT_MESSAGES.FORBIDDEN },
    { status: 403 }
  );
}

/**
 * 404 资源不存在响应
 * 
 * @param resource - 资源名称（可选）
 * @param message - 可选的自定义错误消息
 * @returns NextResponse
 * 
 * @example
 * notFound('用户') // { error: '用户不存在' }
 * notFound() // { error: '资源不存在' }
 */
export function notFound(resource?: string, message?: string): NextResponse {
  const errorMessage = message || (resource ? `${resource}不存在` : DEFAULT_MESSAGES.NOT_FOUND);
  return NextResponse.json(
    { error: errorMessage },
    { status: 404 }
  );
}

/**
 * 400 请求参数错误响应
 * 
 * @param message - 错误消息（必需）
 * @returns NextResponse
 */
export function badRequest(message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: 400 }
  );
}

/**
 * 500 服务器内部错误响应
 * 
 * @param message - 可选的自定义错误消息，默认为 '服务器内部错误'
 * @param details - 可选的错误详情（仅用于日志，不返回给客户端）
 * @returns NextResponse
 */
export function serverError(message?: string, details?: unknown): NextResponse {
  // 如果提供了 details，记录到日志但不返回给客户端
  if (details) {
    console.error('[API Error]', details);
  }
  
  return NextResponse.json(
    { error: message || DEFAULT_MESSAGES.SERVER_ERROR },
    { status: 500 }
  );
}

/**
 * 成功响应
 * 
 * @param data - 响应数据
 * @param status - HTTP 状态码，默认为 200
 * @returns NextResponse
 * 
 * @example
 * success({ user }) // { user }
 * success({ message: '创建成功' }, 201) // { message: '创建成功' } with status 201
 */
export function success<T>(data: T, status: number = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * 创建成功响应（201）
 * 
 * @param data - 响应数据
 * @returns NextResponse
 */
export function created<T>(data: T): NextResponse {
  return success(data, 201);
}

/**
 * 无内容响应（204）
 * 用于删除成功等场景
 * 
 * @returns NextResponse
 */
export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}