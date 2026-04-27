/**
 * API 客户端工具
 * 
 * 提供前端 API 调用的统一工具函数
 */

/**
 * 从 API 响应中提取错误消息
 * 支持多种格式：
 * - { error: 'message' }
 * - { details: { error: 'message' } }
 * - { details: 'message' }
 * 
 * @param data - API 响应数据
 * @param fallback - 默认错误消息
 * @returns 错误消息字符串
 */
export function extractErrorMessage(data: unknown, fallback: string = '操作失败'): string {
  if (!data || typeof data !== 'object') return fallback;
  
  const d = data as Record<string, unknown>;
  
  // 格式 A: { error: 'message' }
  if (typeof d.error === 'string') {
    return d.error;
  }
  
  // 格式 B: { details: { error: 'message' } }
  if (d.details && typeof d.details === 'object') {
    const details = d.details as Record<string, unknown>;
    if (typeof details.error === 'string') {
      return details.error;
    }
  }
  
  // 格式 C: { details: 'message' }
  if (typeof d.details === 'string') {
    return d.details;
  }
  
  return fallback;
}

/**
 * 处理 API 响应错误
 * 
 * @param response - fetch Response 对象
 * @param fallbackMessage - 默认错误消息
 * @returns 错误消息字符串
 */
export async function handleApiError(response: Response, fallbackMessage: string = '请求失败'): Promise<string> {
  try {
    const data = await response.json();
    return extractErrorMessage(data, fallbackMessage);
  } catch {
    return fallbackMessage;
  }
}

/**
 * 统一的 API 请求封装
 * 
 * @param url - 请求 URL
 * @param options - fetch 选项
 * @returns 响应数据和错误信息
 */
export async function apiRequest<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: string | null }> {
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(url, {
      ...options,
      headers,
    });
    
    if (!response.ok) {
      const errorMsg = await handleApiError(response);
      return { data: null, error: errorMsg };
    }
    
    const data = await response.json() as T;
    return { data, error: null };
  } catch (err) {
    console.error('[api-client] 网络请求失败:', err instanceof Error ? err.message : String(err));
    return { 
      data: null, 
      error: err instanceof Error ? err.message : '网络请求失败' 
    };
  }
}

/**
 * GET 请求
 */
export async function apiGet<T = unknown>(url: string): Promise<{ data: T | null; error: string | null }> {
  return apiRequest<T>(url, { method: 'GET' });
}

/**
 * POST 请求
 */
export async function apiPost<T = unknown>(url: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
  return apiRequest<T>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * PUT 请求
 */
export async function apiPut<T = unknown>(url: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
  return apiRequest<T>(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * DELETE 请求
 */
export async function apiDelete<T = unknown>(url: string): Promise<{ data: T | null; error: string | null }> {
  return apiRequest<T>(url, { method: 'DELETE' });
}

/**
 * PATCH 请求
 */
export async function apiPatch<T = unknown>(url: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
  return apiRequest<T>(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
