import { PrismaClient, Prisma } from '@prisma/client';

export { Prisma };

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    transactionOptions: {
      maxWait: 5000,
      timeout: 30000,
    },
  });
}

let prismaInstance: PrismaClient | undefined;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = createPrismaClient();
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = prismaInstance;
    }
  }
  return prismaInstance;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(target, prop) {
    const client = getPrismaClient();
    const value = client[prop as keyof PrismaClient];
    if (typeof value === 'function') {
      return async (...args: unknown[]) => {
        try {
          reconnectAttempts = 0;
          return await (value as (...args: unknown[]) => Promise<unknown>).apply(client, args);
        } catch (error: unknown) {
          const prismaError = error as { code?: string; message?: string };
          if (prismaError.code === 'P1017' || prismaError.message?.includes('Server has closed the connection')) {
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttempts++;
              console.log(`[Prisma] 连接已断开，尝试重连 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
              await client.$disconnect().catch(() => {});
              prismaInstance = undefined;
              const newClient = getPrismaClient();
              await newClient.$connect();
              return await (value as (...args: unknown[]) => Promise<unknown>).apply(newClient, args);
            }
          }
          throw error;
        }
      };
    }
    return value;
  },
});

getPrismaClient()
  .$connect()
  .then(() => console.log('[Prisma] 数据库连接成功'))
  .catch((err) => console.error('[Prisma] 数据库连接失败:', err));

const keepAliveInterval = setInterval(async () => {
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
  } catch {
    console.log('[Prisma] Keep-alive 失败，下次查询将触发重连');
  }
}, 15000);

process.on('beforeExit', () => {
  clearInterval(keepAliveInterval);
  if (prismaInstance) {
    prismaInstance.$disconnect().catch(() => {});
  }
});
