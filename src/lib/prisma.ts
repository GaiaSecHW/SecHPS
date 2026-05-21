import { PrismaClient, Prisma } from '@prisma/client';

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
      console.warn(`[Prisma] 瞬时错误 ${error.code}，正在重试 (${attempt + 1}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastError;
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
      console.warn(`[DB] max_connections=${current}, 需要调整到 ${requiredMax}`);
      await prisma.$executeRawUnsafe(`ALTER SYSTEM SET max_connections = ${requiredMax}`);
      if (pendingRestart) {
        console.warn(`[DB] max_connections 需要重启 PostgreSQL 才能生效（已设置 ALTER SYSTEM, 当前值仍为 ${current}）`);
      } else {
        await prisma.$executeRaw`SELECT pg_reload_conf()`;
        console.log(`[DB] max_connections 已调整为 ${requiredMax}`);
      }
    } else {
      console.log(`[DB] max_connections=${current}, 满足要求`);
    }
  } catch (e) {
    console.warn('[DB] 检查/调整 max_connections 失败:', e);
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
