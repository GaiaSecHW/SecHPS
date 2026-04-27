const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const evalId = 'eval-1777287928441-sixzjlcf1';
  
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: evalId },
    select: {
      id: true,
      status: true,
      workflowType: true,
      endReason: true,
      endMessage: true,
      lastActivity: true,
    }
  });
  
  console.log('=== 评估状态 ===');
  console.log('status:', eval.status);
  console.log('workflowType:', eval.workflowType);
  console.log('endReason:', eval.endReason);
  console.log('endMessage:', eval.endMessage);
  console.log('lastActivity:', eval.lastActivity);
}

main().catch(console.error).finally(() => prisma.$disconnect());