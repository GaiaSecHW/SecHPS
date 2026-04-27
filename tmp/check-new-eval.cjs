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
    }
  });
  
  console.log('=== 评估信息 ===');
  console.log('workflowType:', eval.workflowType);
  console.log('status:', eval.status);
  console.log('workflowId:', eval.workflowId);
  console.log('startedAt:', eval.startedAt);
  console.log('lastActivity:', eval.lastActivity);
  
  // 检查 WorkflowNode
  const workflowNodes = await prisma.workflowNode.findMany({
    where: { workflowId: eval.workflowId },
    select: { id: true, type: true }
  });
  
  console.log('\n=== WorkflowNode (DAG定义) ===');
  console.log('数量:', workflowNodes.length);
  workflowNodes.forEach(n => console.log(`  ${n.id}: ${n.type}`));
  
  // 检查 NodeExecution
  const nodeExecs = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: evalId },
    orderBy: { order: 'asc' },
    select: {
      workflowNodeId: true,
      nodeType: true,
      nodeLabel: true,
      status: true,
      order: true,
      opencodeSessionId: true,
      updatedAt: true,
    }
  });
  
  console.log('\n=== NodeExecution (实际节点) ===');
  console.log('数量:', nodeExecs.length);
  nodeExecs.forEach(n => {
    const matched = workflowNodes.find(wn => wn.id === n.workflowNodeId);
    const age = (Date.now() - new Date(n.updatedAt).getTime()) / 60000;
    console.log(`#${n.order}: ${n.nodeLabel} (${n.nodeType}) - ${n.status}`);
    console.log(`  nodeId: ${n.workflowNodeId}`);
    console.log(`  sessionId: ${n.opencodeSessionId || 'NULL'}`);
    console.log(`  updatedAt: ${age.toFixed(1)}分钟前`);
    console.log(`  匹配DAG: ${matched ? 'YES' : 'NO (FSM节点)'}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());