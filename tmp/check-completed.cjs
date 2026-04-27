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
      completedAt: true,
      lastActivity: true,
      summary: true,
      endReason: true,
    }
  });
  
  console.log('=== 评估状态 ===');
  console.log(JSON.stringify(eval, null, 2));
  
  // 检查 NodeExecution
  const nodeExecs = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: evalId },
    select: { id: true, nodeLabel: true, status: true, order: true, startedAt: true, completedAt: true }
  });
  
  console.log('\n=== NodeExecution ===');
  console.log('数量:', nodeExecs.length);
  nodeExecs.forEach(n => console.log(JSON.stringify(n)));
  
  // 检查 workflow 定义
  if (eval && eval.workflowId) {
    const workflow = await prisma.workflow.findUnique({
      where: { id: eval.workflowId },
      select: { id: true, name: true, workflowType: true, nodes: true }
    });
    console.log('\n=== Workflow 定义 ===');
    console.log('name:', workflow?.name);
    console.log('workflowType:', workflow?.workflowType);
    console.log('nodes 数量:', workflow?.nodes ? JSON.parse(workflow.nodes).length : 0);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());