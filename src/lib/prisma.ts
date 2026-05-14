import { PrismaClient, Prisma } from '@prisma/client';

export { Prisma };

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined;
};

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

// 连接断开时自动重连 + 连接池保活
prisma.$connect().catch(() => {});

// 定期 ping 连接池，防止远程服务端回收空闲连接
const keepAliveInterval = setInterval(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    // 连接已断开，下次查询时会自动重连
  }
}, 30000); // 每 30 秒保活一次

// 进程退出时清理
process.on('beforeExit', () => {
  clearInterval(keepAliveInterval);
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
