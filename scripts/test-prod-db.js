const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:e:\\dev.db' } } });

async function test() {
  try {
    const result = await prisma.$queryRawUnsafe('SELECT name FROM sqlite_master WHERE type="table" LIMIT 5');
    console.log('连接成功，表:', result.map(r => r.name).join(', '));
  } catch (e) {
    console.error('连接失败:', e.message);
  }
  await prisma.$disconnect();
}
test();
