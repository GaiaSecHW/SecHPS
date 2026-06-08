import { PrismaClient, Prisma } from '@prisma/client';
import { logger, LOG_MODULES } from '@/lib/logger';

export { Prisma };

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined;
};

// 瞬时连接错误码：服务端关闭连接 / 连接失败 / 超时 / 连接池耗尽
const TRANSIENT_ERROR_CODES = new Set(['P1017', 'P1001', 'P1002', 'P1008']);

/**
 * 对 Prisma 操作进行自动重试，处理远程数据库瞬时断连
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  delayMs = 1000,
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (!TRANSIENT_ERROR_CODES.has(error.code) || attempt === maxRetries) {
        throw error;
      }
      logger.warn(LOG_MODULES.CONFIG, `瞬时错误 ${error.code}，正在重试 (${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * 对 Prisma 事务进行死锁/写冲突自动重试。
 * 覆盖场景：
 *   1. Prisma P2034（TransactionWriteConflict）—— Prisma 对 PostgreSQL 40P01 的标准封装
 *   2. PostgreSQL 原生 40P01 / serialization_failure（40001）—— 在极端情况下可能不被 Prisma
 *      正确封装（如驱动适配器模式或引擎内部错误路径），通过消息关键词兜底识别
 * 死锁是瞬态错误：竞争事务完成后重试通常能成功。
 * 退避策略：50ms → 100ms → 150ms，最多 maxRetries 次重试（含初次共 maxRetries+1 次尝试）。
 */
export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  logModule = LOG_MODULES.CODESWARM,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isDeadlock = isRetryableTransactionConflict(error);

      if (!isDeadlock || attempt === maxRetries) throw error;

      const delayMs = 50 * (attempt + 1);
      logger.warn(logModule, `事务死锁，自动重试 (${attempt + 1}/${maxRetries})`, { delayMs, error: summarizeError(error) });
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('withDeadlockRetry: unreachable');
}

/**
 * 判断错误是否为可重试的事务冲突（死锁 / 序列化失败）。
 *
 * 识别路径：
 *  a) Prisma 标准封装：PrismaClientKnownRequestError + code P2034
 *  b) 兜底：错误消息包含 PostgreSQL 原生错误码 40P01（deadlock_detected）
 *     或 40001（serialization_failure），且来源为 pg 驱动。
 *     这覆盖了 Prisma 未正确封装原生死锁的极端场景。
 */
type PgDriverError = Error & { code: string };

function hasPgErrorCode(e: Error): e is PgDriverError {
  return 'code' in e && typeof e.code === 'string';
}

function isRetryableTransactionConflict(error: unknown): boolean {
  // 路径 a：Prisma 标准封装的 TransactionWriteConflict
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  ) {
    return true;
  }

  // 路径 b：pg 驱动直接抛出的 PostgreSQL 原生死锁/序列化失败
  // pg 驱动的 DatabaseError 具有 code 属性（PG 错误码）和 name='error'
  if (error instanceof Error && hasPgErrorCode(error)) {
    // 40P01 = deadlock_detected, 40001 = serialization_failure
    return error.code === '40P01' || error.code === '40001';
  }

  return false;
}

function summarizeError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `Prisma ${error.code}: ${error.message.substring(0, 120)}`;
  }
  if (error instanceof Error) {
    const pgCode = hasPgErrorCode(error) ? error.code : '';
    return pgCode ? `PG ${pgCode}: ${error.message.substring(0, 120)}` : error.message.substring(0, 120);
  }
  return String(error);
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    transactionOptions: {
      maxWait: 5000,   // 等待连接最多 5s
      timeout: 30000,  // 事务最多执行 30s
    },
  });

// 连接断开时自动重连
prisma.$connect().then(() => ensureMaxConnections()).catch(() => {});

async function ensureMaxConnections() {
  const requiredMax = 1000;
  try {
    const result = await prisma.$queryRaw<{ current_value: number; pending_restart: boolean }[]>`
      SELECT setting::int AS current_value, pending_restart AS pending_restart FROM pg_settings WHERE name = 'max_connections'
    `;
    const current = result[0]?.current_value ?? 0;
    const pendingRestart = result[0]?.pending_restart ?? false;
    if (current < requiredMax) {
      logger.warn(LOG_MODULES.CONFIG, `max_connections=${current}, 需要调整到 ${requiredMax}`);
      await prisma.$executeRawUnsafe(`ALTER SYSTEM SET max_connections = ${requiredMax}`);
      if (pendingRestart) {
        logger.warn(LOG_MODULES.CONFIG, `max_connections 需要重启 PostgreSQL 才能生效（已设置 ALTER SYSTEM, 当前值仍为 ${current}）`);
      } else {
        await prisma.$executeRaw`SELECT pg_reload_conf()`;
        logger.info(LOG_MODULES.CONFIG, `max_connections 已调整为 ${requiredMax}`);
      }
    } else {
      logger.info(LOG_MODULES.CONFIG, `max_connections=${current}, 满足要求`);
    }
  } catch (e) {
    logger.warn(LOG_MODULES.CONFIG, '检查/调整 max_connections 失败', { details: { error: e instanceof Error ? e.message : String(e) } });
  }
}

// 定期刷新连接池，防止远程 PostgreSQL / 防火墙回收空闲连接
// 用 $executeRaw 而非 $queryRaw 避免结果解析开销
const keepAliveInterval = setInterval(async () => {
  try {
    await prisma.$executeRaw`SELECT 1`;
  } catch {
    // 连接已断开，Prisma 下次查询时自动重建
  }
}, 30000);

// 进程退出时清理
process.on('beforeExit', () => {
  clearInterval(keepAliveInterval);
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
