const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const active = await prisma.evaluationSession.findMany({
    where: { status: { in: ['preparing', 'running', 'queued'] } },
    select: { id: true, projectId: true, status: true, startedAt: true }
  });
  
  console.log('活跃评估数量:', active.length);
  for (const e of active) {
    console.log(`  ${e.id}: projectId=${e.projectId}, status=${e.status}`);
  }
  
  // 检查最近的评估（包括已完成的）
  const recent = await prisma.evaluationSession.findMany({
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: { id: true, projectId: true, status: true, startedAt: true, completedAt: true }
  });
  
  console.log('\n最近5个评估:');
  for (const e of recent) {
    console.log(`  ${e.id}: projectId=${e.projectId}, status=${e.status}, startedAt=${e.startedAt}`);
  }
  
  await prisma.$disconnect();
}

check();