/**
 * Scheduler 独立 Prisma 客户端
 * 只包含 Codeswarm* 表的操作，不含平台业务
 */
import { PrismaClient, type Prisma } from '@prisma/client';

export type TransactionClient = Prisma.TransactionClient;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.LOG_LEVEL === 'debug' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * 死锁重试包装器
 * PostgreSQL 并发事务可能产生 deadlock，重试即可恢复
 * 退避策略：50ms → 100ms → 150ms，最多 maxRetries 次
 */
export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isDeadlock =
        error?.code === 'P2034' || // Prisma transaction conflict
        error?.message?.includes('deadlock') ||
        error?.message?.includes('could not serialize access');

      if (!isDeadlock || attempt >= maxRetries) {
        throw error;
      }

      const delayMs = 50 * (attempt + 1);
      console.warn(`[Prisma] Deadlock detected (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('withDeadlockRetry: unreachable');
}
