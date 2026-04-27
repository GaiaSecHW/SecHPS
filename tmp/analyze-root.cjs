const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const evalId = 'eval-1777287928441-sixzjlcf1';
  
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: evalId },
    select: {
      id: true,
      createdAt: true,
      workflowId: true,
      workflowType: true,
      startedAt: true,
      status: true,
    }
  });
  
  console.log('=== 评估创建信息 ===');
  console.log('createdAt:', eval.createdAt);
  console.log('workflowType:', eval.workflowType);
  console.log('startedAt:', eval.startedAt);
  console.log('workflowId:', eval.workflowId);
  
  // 检查 workflow 定义
  const workflow = await prisma.workflow.findUnique({
    where: { id: eval.workflowId },
    select: {
      name: true,
      workflowType: true,
      fsmTemplateId: true,
      createdAt: true,
    }
  });
  
  console.log('\n=== Workflow 定义 ===');
  console.log('name:', workflow?.name);
  console.log('workflowType:', workflow?.workflowType);
  console.log('fsmTemplateId:', workflow?.fsmTemplateId);
  console.log('createdAt:', workflow?.createdAt);
  
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
    select: {
      workflowNodeId: true,
      nodeType: true,
      nodeLabel: true,
    }
  });
  
  console.log('\n=== NodeExecution (实际执行节点) ===');
  console.log('数量:', nodeExecs.length);
  nodeExecs.forEach(n => {
    const matchedWorkflowNode = workflowNodes.find(wn => wn.id === n.workflowNodeId);
    console.log(`  nodeId: ${n.workflowNodeId}, type: ${n.nodeType}, label: ${n.nodeLabel}`);
    console.log(`    匹配 WorkflowNode: ${matchedWorkflowNode ? matchedWorkflowNode.type : '未匹配'}`);
  });
  
  console.log('\n=== 问题分析 ===');
  if (workflow?.workflowType === 'dag' && workflow?.fsmTemplateId === null) {
    console.log('Workflow 是 DAG 类型，没有 FSM 模板');
    console.log('但 NodeExecution 是 fsm_phase 类型，节点 ID 是 fsm-node-*');
    console.log('结论：评估创建时错误地使用了 FSM 模板');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());