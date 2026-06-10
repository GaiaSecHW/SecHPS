/**
 * Worker JWT 认证
 * 从平台 codeswarm-worker-auth.ts 搬入
 */
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const WORKER_TOKEN_EXPIRES = '7d';

interface WorkerTokenPayload {
  nodeId: string;
  workerId: string;
  type: 'worker';
}

export function generateWorkerToken(workerId: string, nodeId: string): string {
  return jwt.sign({ workerId, nodeId, type: 'worker' }, JWT_SECRET, {
    expiresIn: WORKER_TOKEN_EXPIRES,
  });
}

export function verifyWorkerToken(token: string): WorkerTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (typeof payload === 'object' && (payload as any).type === 'worker') {
      return payload as WorkerTokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** Extract Bearer token from Fastify request Authorization header */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
