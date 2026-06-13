/**
 * API 工具 — 直接调用 Scheduler 服务
 *
 * 路径重映射：前端组件原来调用 /api/codeswarm/*（Next.js 代理），
 * 现在直接调用 Scheduler 的 /api/codeswarm/task/*、/api/codeswarm/node/* 等路径。
 */

/** 从 API 响应中提取错误消息 */
function extractErrorMessage(data: unknown, fallback = '操作失败'): string {
  if (!data || typeof data !== 'object') return fallback;
  const d = data as Record<string, unknown>;
  if (typeof d.error === 'string') return d.error;
  if (d.details && typeof d.details === 'object') {
    const details = d.details as Record<string, unknown>;
    if (typeof details.error === 'string') return details.error;
  }
  if (typeof d.details === 'string') return d.details;
  return fallback;
}

/** 通用 fetch 封装 */
export async function apiRequest<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const resp = await fetch(path, {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string> | undefined),
    },
  });

  if (!resp.ok) {
    let errorMsg = `HTTP ${resp.status}`;
    try {
      const data = await resp.json();
      errorMsg = extractErrorMessage(data, errorMsg);
    } catch {}
    throw new Error(errorMsg);
  }

  return resp.json();
}

export function apiGet<T = unknown>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function apiPatch<T = unknown>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function apiDelete<T = unknown>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'DELETE' });
}
