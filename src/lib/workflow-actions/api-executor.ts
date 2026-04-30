// src/lib/workflow-actions/api-executor.ts

import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, ApiCallConfig, replaceVariables } from './index';

/**
 * 执行 API 调用
 */
export async function executeApiCall(
  config: ApiCallConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    // 替换 URL 中的变量
    const url = replaceVariables(config.url, context.variables);
    logs.push(`[API] ${config.method} ${url}`);

    // 构建请求头
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    // 处理认证
    if (config.auth) {
      switch (config.auth.type) {
        case 'bearer':
          if (config.auth.token) {
            headers['Authorization'] = `Bearer ${config.auth.token}`;
          }
          break;
        case 'basic':
          if (config.auth.username && config.auth.password) {
            const credentials = Buffer.from(
              `${config.auth.username}:${config.auth.password}`
            ).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
          }
          break;
        case 'api-key':
          if (config.auth.key && config.auth.header) {
            headers[config.auth.header] = config.auth.key;
          }
          break;
      }
    }

    // 构建请求选项
    const requestOptions: RequestInit = {
      method: config.method,
      headers,
      signal: config.timeout
        ? AbortSignal.timeout(config.timeout)
        : AbortSignal.timeout(7200000), // 默认2小时
    };

    // 添加请求体
    if (config.body && ['POST', 'PUT', 'PATCH'].includes(config.method)) {
      const body = typeof config.body === 'string'
        ? replaceVariables(config.body, context.variables)
        : JSON.stringify(config.body);
      requestOptions.body = body as string;
      logs.push(`[API] Request body: ${body}`);
    }

    // 执行请求
    const response = await fetch(url, requestOptions);
    logs.push(`[API] Response status: ${response.status}`);

    // 解析响应
    const contentType = response.headers.get('content-type') || '';
    let output: unknown;

    if (contentType.includes('application/json')) {
      output = await response.json();
    } else {
      output = await response.text();
    }

    if (!response.ok) {
      return {
        success: false,
        output,
        error: `HTTP ${response.status}: ${response.statusText}`,
        duration: Date.now() - startTime,
        logs,
      };
    }

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[API] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.error('[workflow-actions/api-executor] API调用失败:', error instanceof Error ? error.message : String(error));
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'API 调用失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

/**
 * 验证 API 调用配置
 */
export function validateApiCallConfig(config: ApiCallConfig): boolean {
  if (!config.url) return false;
  if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(config.method)) return false;
  return true;
}
