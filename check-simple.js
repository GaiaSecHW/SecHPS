const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSuccessEvaluation() {
  const evalId = 'eval-1776801658437-oijegykoo';
  
  // 检查节点执行记录（简化）
  const nodeExecs = await prisma.$queryRaw`
    SELECT id, workflowNodeId, nodeLabel, status 
    FROM NodeExecution 
    WHERE evaluationSessionId = ${evalId}
  `;
  
  console.log('=== Node Executions ===');
  console.log(`Count: ${nodeExecs.length}`);
  nodeExecs.forEach(n => console.log(`  ${n.workflowNodeId} - ${n.nodeLabel} - ${n.status}`));
  
  // 检查消息（简化）
  const messages = await prisma.$queryRaw`
    SELECT id, workflowNodeId, role, LENGTH(content) as contentLen 
    FROM SessionMessage 
    WHERE evaluationSessionId = ${evalId}
    LIMIT 20
  `;
  
  console.log('\n=== Messages ===');
  console.log(`Count: ${messages.length}`);
  messages.forEach(m => console.log(`  ${m.workflowNodeId || 'NULL'} - ${m.role} - contentLen: ${m.contentLen}`));
  
  await prisma.$disconnect();
}

checkSuccessEvaluation();