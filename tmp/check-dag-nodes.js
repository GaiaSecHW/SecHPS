const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. 找一个 DAG 会话
  const dagSession = await prisma.evaluationSession.findFirst({
    where: { workflowType: 'dag', status: 'cancelled' },
    select: { id: true, workflowId: true }
  });
  
  console.log('\n=== 检查 DAG 会话数据 ===');
  
  if (!dagSession) {
    console.log('没有找到 DAG 会话');
    return;
  }
  
  console.log('DAG 会话:', dagSession.id);
  console.log('workflowId:', dagSession.workflowId);
  
  // 2. 查询这个 workflowId 对应的 WorkflowNode
  const workflowNodes = await prisma.workflowNode.findMany({
    where: { workflowId: dagSession.workflowId },
    select: { id: true, data: true }
  });
  
  console.log('\nWorkflowNode 数量:', workflowNodes.length);
  
  const validNodeIds = workflowNodes.map(wn => wn.id);
  console.log('有效的 WorkflowNode IDs:');
  validNodeIds.forEach(id => {
    console.log('  ', id.slice(0, 12));
  });
  
  // 3. 查询 NodeExecution，看 workflowNodeId 是否匹配
  const nodeExecutions = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: dagSession.id },
    select: { id: true, workflowNodeId: true, nodeLabel: true }
  });
  
  console.log('\nNodeExecution 数量:', nodeExecutions.length);
  nodeExecutions.forEach(ne => {
    const isValid = validNodeIds.includes(ne.workflowNodeId);
    console.log('  NE:', ne.id.slice(0, 12), '| workflowNodeId:', ne.workflowNodeId?.slice(0, 12) || 'null', '| valid:', isValid ? '✅' : '❌', '| label:', ne.nodeLabel);
  });
  
  // 4. 查询 SessionMessage，检查 workflowNodeId
  const messages = await prisma.sessionMessage.findMany({
    where: { evaluationSessionId: dagSession.id },
    select: { id: true, workflowNodeId: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 20
  });
  
  console.log('\nSessionMessage 数量:', messages.length);
  console.log('SessionMessage workflowNodeId 分布:');
  
  const nodeMsgCounts = {};
  messages.forEach(m => {
    const nid = m.workflowNodeId || 'null';
    nodeMsgCounts[nid] = (nodeMsgCounts[nid] || 0) + 1;
  });
  
  Object.entries(nodeMsgCounts).forEach(([nid, count]) => {
    const isValidNid = validNodeIds.some(v => v.slice(0, 12) === nid.slice(0, 12)) || nid === 'null';
    console.log('  nodeId:', nid.slice(0, 12), '| 消息数:', count, '| valid:', isValidNid ? '✅' : '❌');
  });
  
  // 5. 测试：尝试用正确的 WorkflowNode ID 插入消息
  if (validNodeIds.length > 0) {
    const testNodeId = validNodeIds[0];
    const testMsgId = 'test-msg-' + Date.now();
    
    console.log('\n=== 测试用正确的 WorkflowNode ID 插入 ===');
    console.log('测试 nodeId:', testNodeId.slice(0, 12));
    
    try {
      const result = await prisma.sessionMessage.create({
        data: {
          id: testMsgId,
          evaluationSessionId: dagSession.id,
          workflowNodeId: testNodeId,  // 使用真实存在的 ID
          role: 'test',
          content: 'test content',
        }
      });
      console.log('✅ 插入成功！');
      console.log('消息 ID:', result.id);
      console.log('workflowNodeId:', result.workflowNodeId?.slice(0, 12));
      
      // 删除测试消息
      await prisma.sessionMessage.delete({
        where: { id: testMsgId }
      });
      console.log('测试消息已删除');
      
    } catch (error) {
      console.log('❌ 插入失败:', error.message);
    }
  }
  
  // 6. 分析：如果 NodeExecution.workflowNodeId 和 WorkflowNode.id 不匹配
  const neNodeIds = nodeExecutions.map(ne => ne.workflowNodeId);
  const mismatchedNE = neNodeIds.filter(nid => nid && !validNodeIds.includes(nid));
  
  if (mismatchedNE.length > 0) {
    console.log('\n=== 发现 NodeExecution.workflowNodeId 不匹配 WorkflowNode.id ===');
    console.log('不匹配的 NodeExecution workflowNodeId:');
    mismatchedNE.forEach(nid => {
      console.log('  ', nid.slice(0, 12));
    });
    
    // 检查这些 ID 是否存在于其他 workflow
    const otherNodes = await prisma.workflowNode.findMany({
      where: { id: { in: mismatchedNE } },
      select: { id: true, workflowId: true }
    });
    
    console.log('这些 ID 实际属于的 workflow:');
    otherNodes.forEach(wn => {
      console.log('  nodeId:', wn.id.slice(0, 12), '| workflowId:', wn.workflowId?.slice(0, 12));
    });
    
    if (otherNodes.length === 0) {
      console.log('  这些 ID 不存在于任何 WorkflowNode 表中！');
    }
  }
  
  // 7. 检查 topology-sort 返回的节点 ID 格式
  console.log('\n=== 检查节点 ID 格式 ===');
  console.log('WorkflowNode ID 格式:');
  validNodeIds.slice(0, 3).forEach(id => {
    console.log('  长度:', id.length, '| 内容:', id);
  });
  
  console.log('NodeExecution workflowNodeId 格式:');
  neNodeIds.slice(0, 3).forEach(id => {
    if (id) {
      console.log('  长度:', id.length, '| 内容:', id);
    }
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());