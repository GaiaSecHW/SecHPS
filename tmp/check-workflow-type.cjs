const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const evalId = 'eval-1777287928441-sixzjlcf1';
  
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: evalId },
    select: {
      id: true,
      workflowId: true,
      workflowType: true,
      status: true,
    }
  });
  
  console.log('=== 评估信息 ===');
  console.log('workflowId:', eval.workflowId);
  console.log('workflowType:', eval.workflowType);
  
  if (eval.workflowId) {
    const workflow = await prisma.workflow.findUnique({
      where: { id: eval.workflowId },
      select: {
        id: true,
        name: true,
        workflowType: true,
        fsmTemplateId: true,
      }
    });
    
    console.log('\n=== Workflow ===');
    console.log('name:', workflow?.name);
    console.log('workflowType:', workflow?.workflowType);
    console.log('fsmTemplateId:', workflow?.fsmTemplateId);
    
    if (workflow?.fsmTemplateId) {
      const fsmTemplate = await prisma.fSMTemplate.findUnique({
        where: { id: workflow.fsmTemplateId },
        select: {
          id: true,
          name: true,
        }
      });
      
      console.log('\n=== FSMTemplate ===');
      console.log('name:', fsmTemplate?.name);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());