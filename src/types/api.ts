/**
 * API 响应类型定义
 * 
 * 统一的 API 响应格式，用于类型安全的 API 开发
 */

import { NextResponse } from 'next/server';

/**
 * 标准错误响应格式 A（推荐）
 * 用于大多数 API 端点
 */
export interface ApiErrorResponse {
  error: string;
  code?: string;
}

/**
 * 嵌套错误响应格式 B（向后兼容）
 * 用于部分旧 API 端点
 */
export interface ApiNestedErrorResponse {
  details: {
    error: string;
  };
}

/**
 * 成功响应包装器
 */
export interface ApiSuccessResponse<T> {
  data: T;
  message?: string;
}

/**
 * 分页响应
 */
export interface ApiPaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * API 响应类型联合
 */
export type ApiResponse<T = unknown> = 
  | ApiSuccessResponse<T>
  | ApiErrorResponse
  | ApiNestedErrorResponse;

/**
 * HTTP 状态码常量
 */
export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * 错误代码常量
 */
export const ErrorCode = {
  // 认证相关
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  
  // 权限相关
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // 资源相关
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  
  // 请求相关
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // 服务相关
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

/**
 * 错误代码类型
 */
export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * 类型守卫：检查是否为错误响应
 */
export function isErrorResponse(response: unknown): response is ApiErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    typeof (response as ApiErrorResponse).error === 'string'
  );
}

/**
 * 类型守卫：检查是否为嵌套错误响应
 */
export function isNestedErrorResponse(response: unknown): response is ApiNestedErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'details' in response &&
    typeof (response as ApiNestedErrorResponse).details === 'object' &&
    (response as ApiNestedErrorResponse).details !== null &&
    'error' in ((response as ApiNestedErrorResponse).details)
  );
}

/**
 * 从响应中提取错误消息（兼容两种格式）
 */
export function getErrorMessage(response: unknown, fallback = '操作失败'): string {
  if (isErrorResponse(response)) {
    return response.error;
  }
  if (isNestedErrorResponse(response)) {
    return response.details.error;
  }
  return fallback;
}

/**
 * API 路由处理器返回类型
 */
export type ApiRouteResponse = Promise<NextResponse>;
