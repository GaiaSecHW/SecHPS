const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 测试：尝试插入一条 workflowNodeId 不存在于 WorkflowNode 表的消息
  console.log('\n=== 测试 SessionMessage 外键约束 ===');
  
  // 1. 找一个存在的评估会话
  const session = await prisma.evaluationSession.findFirst({
    select: { id: true }
  });
  
  if (!session) {
    console.log('没有找到评估会话，无法测试');
    return;
  }
  
  console.log('使用会话:', session.id);
  
  // 2. 检查 WorkflowNode 表中是否存在某个 ID
  const fakeNodeId = 'fsm-phase-test-123';
  const existingNode = await prisma.workflowNode.findUnique({
    where: { id: fakeNodeId }
  });
  
  console.log('测试 nodeId:', fakeNodeId);
  console.log('WorkflowNode 表中是否存在:', existingNode ? '存在' : '不存在');
  
  // 3. 尝试插入一条消息，workflowNodeId 使用不存在的 ID
  const testMsgId = 'test-msg-' + Date.now();
  
  try {
    const result = await prisma.sessionMessage.create({
      data: {
        id: testMsgId,
        evaluationSessionId: session.id,
        workflowNodeId: fakeNodeId,  // 不存在的 ID
        role: 'test',
        content: 'test content',
      }
    });
    console.log('\n✅ 插入成功！外键约束不强制检查');
    console.log('消息 ID:', result.id);
    console.log('workflowNodeId:', result.workflowNodeId);
    
    // 删除测试消息
    await prisma.sessionMessage.delete({
      where: { id: testMsgId }
    });
    console.log('测试消息已删除');
    
  } catch (error) {
    console.log('\n❌ 插入失败！外键约束强制检查');
    console.log('错误:', error.message);
    
    // 如果外键约束失败，尝试插入 workflowNodeId = null
    try {
      const result2 = await prisma.sessionMessage.create({
        data: {
          id: testMsgId,
          evaluationSessionId: session.id,
          workflowNodeId: null,  // 使用 null
          role: 'test',
          content: 'test content',
          metadata: JSON.stringify({ nodeId: fakeNodeId }),  // 存到 metadata
        }
      });
      console.log('\n✅ 使用 null 插入成功');
      console.log('消息 ID:', result2.id);
      console.log('workflowNodeId:', result2.workflowNodeId);
      console.log('metadata:', result2.metadata);
      
      // 删除测试消息
      await prisma.sessionMessage.delete({
        where: { id: testMsgId }
      });
      console.log('测试消息已删除');
      
    } catch (error2) {
      console.log('\n❌ 使用 null 也失败:', error2.message);
    }
  }
  
  // 4. 检查实际的外键约束设置
  console.log('\n=== 检查数据库外键约束设置 ===');
  
  // SQLite 不支持直接查询外键约束，但可以通过 schema 理解
  // Prisma schema 定义了 WorkflowNode? 作为可选关系
  // 这意味着外键约束是宽松的
  
  console.log('Prisma schema 定义: WorkflowNode WorkflowNode? (可选关系)');
  console.log('这意味着: workflowNodeId 可以是 null 或任何值');
  console.log('但 Prisma 会在查询时尝试关联，如果找不到则返回 null');
  
  // 5. 验证：查询一条 FSM 消息
  console.log('\n=== 检查现有 FSM 消息 ===');
  
  const fsmSession = await prisma.evaluationSession.findFirst({
    where: { workflowType: 'fsm' },
    select: { id: true }
  });
  
  if (fsmSession) {
    const fsmMessages = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: fsmSession.id },
      select: { id: true, workflowNodeId: true, metadata: true },
      take: 5
    });
    
    console.log('FSM 会话:', fsmSession.id);
    console.log('FSM 消息示例:');
    fsmMessages.forEach(m => {
      console.log('  msgId:', m.id.slice(0, 12), '| workflowNodeId:', m.workflowNodeId?.slice(0, 12) || 'null');
      if (m.metadata) {
        try {
          const meta = JSON.parse(m.metadata);
          console.log('    metadata.nodeId:', meta.nodeId?.slice(0, 12) || '无');
        } catch {}
      }
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());