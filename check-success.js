const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSuccessEvaluation() {
  const evalId = 'eval-1776801658437-oijegykoo';
  
  // 检查评估详情
  const evaluation = await prisma.evaluationSession.findUnique({
    where: { id: evalId },
    select: {
      id: true,
      workflowType: true,
      status: true,
      totalInputTokens: true,
      totalOutputTokens: true,
      endReason: true,
      endMessage: true
    }
  });
  
  console.log('=== Evaluation ===');
  console.log(JSON.stringify(evaluation, null, 2));
  
  // 检查节点执行记录
  const nodeExecs = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: evalId },
    select: {
      id: true,
      workflowNodeId: true,
      nodeLabel: true,
      status: true,
      modelName: true,
      inputTokens: true,
      outputTokens: true
    }
  });
  
  console.log('\n=== Node Executions ===');
  console.log(`Count: ${nodeExecs.length}`);
  nodeExecs.forEach(n => console.log(`  ${n.workflowNodeId} - ${n.nodeLabel} - ${n.status} - tokens: ${n.inputTokens}/${n.outputTokens}`));
  
  // 检查消息
  const messages = await prisma.sessionMessage.findMany({
    where: { evaluationSessionId: evalId },
    select: {
      id: true,
      workflowNodeId: true,
      role: true,
      content: true
    },
    take: 20
  });
  
  console.log('\n=== Messages ===');
  console.log(`Count: ${messages.length}`);
  messages.forEach(m => {
    const contentPreview = m.content ? m.content.substring(0, 100) + '...' : 'empty';
    console.log(`  ${m.workflowNodeId || 'null'} - ${m.role} - ${contentPreview}`);
  });
  
  await prisma.$disconnect();
}

checkSuccessEvaluation();