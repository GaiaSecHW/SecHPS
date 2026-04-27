const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 查找最近的几个评估
  const evals = await prisma.evaluationSession.findMany({
    where: { workflowId: 'cmo5psi2f0001xc7yi3tqzq4b' },
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: {
      id: true,
      workflowType: true,
      status: true,
      startedAt: true,
      lastActivity: true,
    }
  });
  
  console.log('=== 最近 DAG workflow 评估 ===');
  evals.forEach(e => {
    console.log(`\n${e.id}:`);
    console.log(`  workflowType: ${e.workflowType}`);
    console.log(`  status: ${e.status}`);
    console.log(`  startedAt: ${e.startedAt}`);
    console.log(`  lastActivity: ${e.lastActivity}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());