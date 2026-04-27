const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const evalId = 'eval-1777287928441-sixzjlcf1';
  
  const nodeExecs = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: evalId },
    orderBy: { order: 'asc' },
    select: {
      workflowNodeId: true,
      nodeLabel: true,
      nodeType: true,
      status: true,
      order: true,
    }
  });
  
  console.log('=== NodeExecution ===');
  nodeExecs.forEach(n => {
    console.log(`#${n.order}: ${n.nodeLabel}`);
    console.log(`  workflowNodeId: ${n.workflowNodeId}`);
    console.log(`  nodeType: ${n.nodeType}`);
    console.log(`  status: ${n.status}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());