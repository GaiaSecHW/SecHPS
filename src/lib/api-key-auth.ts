import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { unauthorized, forbidden, rateLimited } from '@/lib/api-errors';

export interface ApiKeyAuthSuccess {
  success: true;
  apiKey: {
    id: string;
    tenantId: string | null;
    userId: string;
    allowedAgentIds: string[];
  };
}

export interface ApiKeyAuthError {
  success: false;
  error: string;
  code: string;
  statusCode: number;
}

export type ApiKeyAuthResult = ApiKeyAuthSuccess | ApiKeyAuthError;

export interface ApiKeyAuthOptions {
  requiredAgentId?: string;
}

export async function authenticateApiKey(
  request: NextRequest,
  options?: ApiKeyAuthOptions
): Promise<ApiKeyAuthResult> {
  // 1. 提取 Bearer token
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED', statusCode: 401 };
  }

  const token = authHeader.substring(7);

  // 2. 验证 icsl- 前缀
  if (!token.startsWith('icsl-')) {
    return { success: false, error: 'Invalid API key format', code: 'UNAUTHORIZED', statusCode: 401 };
  }

  // 3. SHA256 哈希
  const keyHash = crypto.createHash('sha256').update(token).digest('hex');

  // 4. 查询数据库
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: {
      allowedAgents: { select: { agentAppId: true } },
    },
  });

  if (!apiKey) {
    return { success: false, error: 'Invalid API key', code: 'UNAUTHORIZED', statusCode: 401 };
  }

  // 5. 检查是否已撤销
  if (apiKey.revokedAt) {
    return { success: false, error: 'API key has been revoked', code: 'UNAUTHORIZED', statusCode: 401 };
  }

  // 6. 检查限频
  if (apiKey.lastUsedAt) {
    const elapsed = Date.now() - apiKey.lastUsedAt.getTime();
    const minInterval = apiKey.rateLimitInterval * 60 * 1000;
    if (elapsed < minInterval) {
      const retryAfter = Math.ceil((minInterval - elapsed) / 1000);
      return {
        success: false,
        error: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
        code: 'RATE_LIMITED',
        statusCode: 429,
      };
    }
  }

  const allowedAgentIds = apiKey.allowedAgents.map(a => a.agentAppId);

  // 7. 检查 Agent 访问权限
  if (options?.requiredAgentId && !allowedAgentIds.includes(options.requiredAgentId)) {
    return { success: false, error: 'Access denied to this agent', code: 'FORBIDDEN', statusCode: 403 };
  }

  // 8. 更新 lastUsedAt（fire-and-forget）
  prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return {
    success: true,
    apiKey: {
      id: apiKey.id,
      tenantId: apiKey.tenantId,
      userId: apiKey.userId,
      allowedAgentIds,
    },
  };
}

// Helper: 如果认证失败，返回对应的错误响应
export function apiKeyAuthErrorResponse(result: ApiKeyAuthError) {
  const { error, code, statusCode } = result;
  if (statusCode === 401) return unauthorized(error);
  if (statusCode === 403) return forbidden(error);
  if (statusCode === 429) return rateLimited(error);
  return unauthorized(error);
}
