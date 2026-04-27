const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const evalId = 'eval-1777293551997-hpqyorkp6';
  
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: evalId },
  });
  
  console.log('=== 评估完整信息 ===');
  console.log('workflowType:', eval.workflowType);
  console.log('status:', eval.status);
  console.log('startedAt:', eval.startedAt);
  console.log('endReason:', eval.endReason);
  console.log('errorMessage:', eval.errorMessage);
}

main().catch(console.error).finally(() => prisma.$disconnect());