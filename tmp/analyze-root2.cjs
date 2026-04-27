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
      startedAt: true,
      status: true,
      lastActivity: true,
    }
  });
  
  console.log('=== 评估创建信息 ===');
  console.log('startedAt:', eval.startedAt);
  console.log('workflowType:', eval.workflowType);
  console.log('lastActivity:', eval.lastActivity);
  console.log('workflowId:', eval.workflowId);
  
  // 检查 workflow 定义
  const workflow = await prisma.workflow.findUnique({
    where: { id: eval.workflowId },
    select: {
      name: true,
      workflowType: true,
      fsmTemplateId: true,
    }
  });
  
  console.log('\n=== Workflow 定义 ===');
  console.log('name:', workflow?.name);
  console.log('workflowType:', workflow?.workflowType);
  console.log('fsmTemplateId:', workflow?.fsmTemplateId);
  
  // 检查 WorkflowNode
  const workflowNodes = await prisma.workflowNode.findMany({
    where: { workflowId: eval.workflowId },
    select: {
      id: true,
      type: true,
      fsmPhase: true,
    }
  });
  
  console.log('\n=== WorkflowNode (DAG定义的节点) ===');
  console.log('数量:', workflowNodes.length);
  workflowNodes.forEach(n => {
    console.log(`  id: ${n.id}, type: ${n.type}, fsmPhase: ${n.fsmPhase}`);
  });
  
  // 检查 NodeExecution (实际执行的节点)
  const nodeExecs = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: evalId },
    orderBy: { order: 'asc' },
    select: {
      workflowNodeId: true,
      nodeType: true,
      nodeLabel: true,
      order: true,
    }
  });
  
  console.log('\n=== NodeExecution (实际执行节点) ===');
  console.log('数量:', nodeExecs.length);
  nodeExecs.forEach(n => {
    const matchedWorkflowNode = workflowNodes.find(wn => wn.id === n.workflowNodeId);
    console.log(`#${n.order}: nodeId=${n.workflowNodeId}, type=${n.nodeType}, label=${n.nodeLabel}`);
    console.log(`  匹配 WorkflowNode: ${matchedWorkflowNode ? 'YES (' + matchedWorkflowNode.type + ')' : 'NO - 这是FSM节点'}`);
  });
  
  console.log('\n=== 问题分析 ===');
  const unmatchedNodes = nodeExecs.filter(n => !workflowNodes.find(wn => wn.id === n.workflowNodeId));
  if (unmatchedNodes.length > 0) {
    console.log('Workflow 定义只有', workflowNodes.length, '个节点');
    console.log('但 NodeExecution 有', nodeExecs.length, '个节点');
    console.log('其中', unmatchedNodes.length, '个节点不匹配 WorkflowNode 定义');
    console.log('这些节点是 FSM 节点，不是 DAG 节点');
    console.log('\n根因：评估创建时使用了 FSM 模板，而不是 DAG 定义');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());