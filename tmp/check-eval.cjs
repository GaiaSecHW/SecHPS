const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: 'eval-1777287687449-17oddx9mq' },
    include: {
      NodeExecution: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          order: true,
          nodeLabel: true,
          status: true,
          opencodeSessionId: true
        }
      }
    }
  });
  
  if (!eval) {
    console.log('Evaluation not found');
    return;
  }
  
  console.log('Evaluation ID:', eval.id);
  console.log('Status:', eval.status);
  console.log('Last Activity:', eval.lastActivity);
  console.log('\nNode Executions:');
  
  eval.NodeExecution.forEach(n => {
    console.log(`  Node ${n.order}: ${n.nodeLabel} - status=${n.status}, sessionId=${n.opencodeSessionId || 'NULL'}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());