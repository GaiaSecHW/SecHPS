const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const evalId = 'eval-1777293551997-hpqyorkp6';
  
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: evalId },
    select: {
      id: true,
      workflowType: true,
      status: true,
      workflowId: true,
      startedAt: true,
      lastActivity: true,
      endReason: true,
      errorMessage: true,
    }
  });
  
  console.log('=== 评估状态 ===');
  console.log('workflowType:', eval.workflowType);
  console.log('status:', eval.status);
  console.log('workflowId:', eval.workflowId);
  console.log('startedAt:', eval.startedAt);
  console.log('lastActivity:', eval.lastActivity);
  console.log('endReason:', eval.endReason);
  console.log('errorMessage:', eval.errorMessage);
  
  // 检查 NodeExecution
  const nodeExecs = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: evalId },
    select: {
      id: true,
      workflowNodeId: true,
      nodeLabel: true,
      status: true,
      order: true,
    }
  });
  
  console.log('\n=== NodeExecution ===');
  console.log('数量:', nodeExecs.length);
  nodeExecs.forEach(n => {
    console.log(`#${n.order}: ${n.nodeLabel} - ${n.status}`);
  });
  
  // 检查 WorkflowNode
  if (eval.workflowId) {
    const workflowNodes = await prisma.workflowNode.findMany({
      where: { workflowId: eval.workflowId },
      select: { id: true, type: true }
    });
    
    console.log('\n=== WorkflowNode ===');
    console.log('数量:', workflowNodes.length);
    workflowNodes.forEach(n => console.log(`  ${n.id}: ${n.type}`));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());