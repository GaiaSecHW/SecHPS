const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const evalId = 'eval-1777294347529-bbjcxzemw';
  
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: evalId },
    select: {
      id: true,
      workflowType: true,
      status: true,
      workflowId: true,
      startedAt: true,
      lastActivity: true,
    }
  });
  
  console.log('=== 评估状态 ===');
  console.log('workflowType:', eval.workflowType);
  console.log('status:', eval.status);
  console.log('workflowId:', eval.workflowId);
  console.log('startedAt:', eval.startedAt);
  console.log('lastActivity:', eval.lastActivity);
  
  // 检查 NodeExecution
  const nodeExecs = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: evalId },
    select: { id: true, nodeLabel: true, status: true, order: true }
  });
  
  console.log('\n=== NodeExecution ===');
  console.log('数量:', nodeExecs.length);
  nodeExecs.forEach(n => console.log(`#${n.order}: ${n.nodeLabel} - ${n.status}`));
  
  // 检查项目状态
  const project = await prisma.project.findFirst({
    where: { EvaluationSession: { some: { id: evalId } } },
    select: { id: true, status: true }
  });
  
  console.log('\n=== 项目状态 ===');
  console.log('status:', project?.status);
}

main().catch(console.error).finally(() => prisma.$disconnect());