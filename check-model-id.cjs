const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const models = await prisma.modelConfig.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' }
  });
  
  console.log('ModelConfig IDs:');
  for (const m of models) {
    console.log(`  id=${m.id}, name=${m.name}`);
  }
  
  // 检查是否有 id 为 MiniMax/MiniMax-M2.5 的记录
  const invalidId = await prisma.modelConfig.findUnique({
    where: { id: 'MiniMax/MiniMax-M2.5' }
  });
  console.log('\n是否存在 id=MiniMax/MiniMax-M2.5:', invalidId ? '存在' : '不存在');
  
  await prisma.$disconnect();
}

check();