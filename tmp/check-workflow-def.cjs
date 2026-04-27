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
  console.log('id:', workflow.id);
  console.log('name:', workflow.name);
  console.log('workflowType:', workflow.workflowType);
  console.log('fsmTemplateId:', workflow.fsmTemplateId);
  
  // 检查 WorkflowNode
  const nodes = await prisma.workflowNode.findMany({
    where: { workflowId },
    select: {
      id: true,
      type: true,
      fsmPhase: true,
    }
  });
  
  console.log('\n=== WorkflowNode ===');
  console.log('Count:', nodes.length);
  nodes.forEach(n => {
    console.log(`  id: ${n.id}, type: ${n.type}, fsmPhase: ${n.fsmPhase}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());