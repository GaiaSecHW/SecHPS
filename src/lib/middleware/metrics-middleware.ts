// src/lib/middleware/metrics-middleware.ts

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { recordMetric, recordTiming, incrementMetric } from '@/lib/metrics/collector';

/**
 * 请求指标中间件
 * 收集API请求的响应时间、状态码等指标
 */
export function withMetrics(
  handler: (request: NextRequest) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    const startTime = Date.now();
    const path = request.nextUrl.pathname;
    const method = request.method;

    try {
      const response = await handler(request);
      const duration = Date.now() - startTime;

      // 记录响应时间
      recordTiming(
        `api:${path}`,
        'api_response_time',
        duration,
        {
          method,
          status: response.status.toString(),
          path: normalizePath(path),
        }
      );

      // 记录请求计数
      incrementMetric(
        `api:${path}`,
        'api_request_count',
        1,
        {
          method,
          status: response.status.toString(),
          path: normalizePath(path),
        }
      );

      // 记录错误
      if (response.status >= 400) {
        incrementMetric(
          `api:${path}`,
          'api_error_count',
          1,
          {
            method,
            status: response.status.toString(),
            path: normalizePath(path),
          }
        );
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      // 记录异常
      recordTiming(
        `api:${path}`,
        'api_response_time',
        duration,
        {
          method,
          status: '500',
          path: normalizePath(path),
          error: 'true',
        }
      );

      incrementMetric(
        `api:${path}`,
        'api_error_count',
        1,
        {
          method,
          status: '500',
          path: normalizePath(path),
          error: 'unhandled',
        }
      );

      throw error;
    }
  };
}

/**
 * 规范化路径（移除动态参数ID）
 */
function normalizePath(path: string): string {
  return path
    .replace(/\/[a-f0-9]{25,}(?=\/|$)/gi, '/:id') // CUID
    .replace(/\/[a-f0-9-]{36}(?=\/|$)/gi, '/:id') // UUID
    .replace(/\/\d+(?=\/|$)/g, '/:id'); // 数字ID
}

/**
 * 创建响应时间头
 */
export function addTimingHeaders(
  response: NextResponse,
  startTime: number
): NextResponse {
  const duration = Date.now() - startTime;
  response.headers.set('X-Response-Time', `${duration}ms`);
  return response;
}
