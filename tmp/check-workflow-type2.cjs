const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const workflowId = 'cmo5psi2f0001xc7yi3tqzq4b';
  
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    select: {
      id: true,
      name: true,
      workflowType: true,
      fsmTemplateId: true,
    }
  });
  
  console.log('=== Workflow ===');
  console.log('name:', workflow.name);
  console.log('workflowType:', workflow.workflowType);
  console.log('fsmTemplateId:', workflow.fsmTemplateId);
  
  console.log('\n判断:');
  if (workflow.workflowType === 'fsm') {
    console.log('会调用 executeFSMBackground');
  } else {
    console.log('会调用 executeDAGBackground');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());