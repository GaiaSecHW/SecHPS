const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 找有 NodeExecution 和 SessionMessage 的 DAG 会话
  const sessions = await prisma.evaluationSession.findMany({
    where: { workflowType: 'dag' },
    orderBy: { startedAt: 'desc' },
    take: 20,
    select: { id: true, workflowId: true, status: true }
  });
  
  console.log('\n=== 遍历 DAG 会话，找有数据的 ===');
  
  for (const session of sessions) {
    const neCount = await prisma.nodeExecution.count({
      where: { evaluationSessionId: session.id }
    });
    
    const msgCount = await prisma.sessionMessage.count({
      where: { evaluationSessionId: session.id }
    });
    
    if (neCount > 0 && msgCount > 0) {
      console.log('\n========================================');
      console.log('会话:', session.id.slice(0, 12), '| status:', session.status);
      console.log('workflowId:', session.workflowId?.slice(0, 12));
      console.log('NodeExecution 数量:', neCount);
      console.log('SessionMessage 数量:', msgCount);
      
      // 查询 WorkflowNode
      const workflowNodes = await prisma.workflowNode.findMany({
        where: { workflowId: session.workflowId },
        select: { id: true }
      });
      
      const validNodeIds = workflowNodes.map(wn => wn.id);
      console.log('WorkflowNode 数量:', validNodeIds.length);
      
      // 查询 NodeExecution 的 workflowNodeId
      const nodeExecutions = await prisma.nodeExecution.findMany({
        where: { evaluationSessionId: session.id },
        select: { workflowNodeId: true, nodeLabel: true }
      });
      
      console.log('\nNodeExecution workflowNodeId 检查:');
      nodeExecutions.forEach(ne => {
        const isValid = validNodeIds.includes(ne.workflowNodeId);
        console.log('  nodeId:', ne.workflowNodeId?.slice(0, 12) || 'null', '| valid:', isValid ? '✅' : '❌', '| label:', ne.nodeLabel);
      });
      
      // 查询 SessionMessage 的 workflowNodeId
      const messages = await prisma.sessionMessage.findMany({
        where: { evaluationSessionId: session.id },
        select: { workflowNodeId: true, role: true },
        take: 50
      });
      
      const msgNodeCounts = {};
      messages.forEach(m => {
        const nid = m.workflowNodeId?.slice(0, 12) || 'null';
        msgNodeCounts[nid] = (msgNodeCounts[nid] || 0) + 1;
      });
      
      console.log('\nSessionMessage workflowNodeId 分布:');
      Object.entries(msgNodeCounts).forEach(([nid, count]) => {
        const isValidNid = validNodeIds.some(v => v.slice(0, 12) === nid) || nid === 'null';
        console.log('  nodeId:', nid, '| 消息数:', count, '| valid:', isValidNid ? '✅' : '❌');
      });
      
      // 找一个 workflowNodeId 为 null 但应该有值的消息
      const nullNodeMsgs = messages.filter(m => !m.workflowNodeId);
      if (nullNodeMsgs.length > 0) {
        console.log('\n!!! 发现 workflowNodeId 为 null 的消息:', nullNodeMsgs.length, '条');
        
        // 尝试模拟：如果用正确的 nodeId 插入会怎样
        if (validNodeIds.length > 0) {
          const testNodeId = validNodeIds[0];
          console.log('测试：用 WorkflowNode ID', testNodeId.slice(0, 12), '插入消息...');
          
          const testMsgId = 'test-msg-' + Date.now();
          try {
            await prisma.sessionMessage.create({
              data: {
                id: testMsgId,
                evaluationSessionId: session.id,
                workflowNodeId: testNodeId,
                role: 'test',
                content: 'test'
              }
            });
            console.log('✅ 成功！说明外键约束没问题');
            await prisma.sessionMessage.delete({ where: { id: testMsgId } });
          } catch (e) {
            console.log('❌ 失败:', e.message);
          }
        }
      }
      
      break;  // 只分析第一个有数据的会话
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());