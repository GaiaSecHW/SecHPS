const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const locks = await prisma.evaluationLock.findMany({
    where: { 
      OR: [
        { projectId: 'proj-1777021450958-ow16z9t27' },
        { evaluationId: 'eval-1777268403518-z8x6rv8gu' }
      ]
    }
  });
  
  console.log('Locks found:', locks.length);
  locks.forEach(l => {
    console.log(`  projectId=${l.projectId}, evaluationId=${l.evaluationId}, lockedAt=${l.lockedAt}`);
  });
  
  // 查询最近的 SessionMessage 记录（Prisma）
  const messages = await prisma.sessionMessage.findMany({
    where: { evaluationSessionId: 'eval-1777268403518-z8x6rv8gu' },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  
  console.log('\nSessionMessage records (Prisma):', messages.length);
  messages.forEach(m => {
    console.log(`  ${m.id}: role=${m.role}, createdAt=${m.createdAt}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());