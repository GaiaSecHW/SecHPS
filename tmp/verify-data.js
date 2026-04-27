const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. 查看所有评估会话
  const sessions = await prisma.evaluationSession.findMany({
    orderBy: { startTime: 'desc' },
    take: 10,
    select: {
      id: true,
      projectId: true,
      status: true,
      workflowType: true,
      startTime: true,
      endTime: true
    }
  });
  
  console.log('\n=== 评估会话列表 ===');
  sessions.forEach(s => {
    console.log('ID:', s.id, '| Project:', s.projectId, '| Status:', s.status, '| Type:', s.workflowType);
    console.log('  Start:', new Date(s.startTime).toLocaleString('zh-CN'), '| End:', s.endTime ? new Date(s.endTime).toLocaleString('zh-CN') : 'null');
  });
  
  // 2. 对每个会话，检查数据完整性
  for (const session of sessions.slice(0, 3)) {
    console.log('\n\n========================================');
    console.log('=== 会话详情:', session.id, '===');
    
    // 2.1 NodeExecution
    const nodeExecutions = await prisma.nodeExecution.findMany({
      where: { sessionId: session.id },
      select: {
        id: true,
        workflowNodeId: true,
        nodeId: true,
        status: true,
        startTime: true,
        endTime: true,
        agentCallMsgId: true
      }
    });
    console.log('\n--- NodeExecution:', nodeExecutions.length, '条 ---');
    nodeExecutions.forEach(ne => {
      console.log('  NE:', ne.id.slice(0,8), '| workflowNodeId:', ne.workflowNodeId?.slice(0,8), '| nodeId:', ne.nodeId?.slice(0,8), '| agentCallMsgId:', ne.agentCallMsgId?.slice(0,8), '| status:', ne.status);
    });
    
    // 2.2 SessionMessage
    const messages = await prisma.sessionMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        workflowNodeId: true,
        metadata: true,
        createdAt: true
      }
    });
    console.log('\n--- SessionMessage:', messages.length, '条 ---');
    
    // 统计消息类型
    const msgStats = {};
    messages.forEach(m => {
      const content = m.content;
      if (typeof content === 'string') {
        try {
          const parsed = JSON.parse(content);
          if (parsed.type) {
            msgStats[parsed.type] = (msgStats[parsed.type] || 0) + 1;
          } else if (Array.isArray(parsed)) {
            parsed.forEach(p => {
              if (p.type) msgStats[p.type] = (msgStats[p.type] || 0) + 1;
            });
          } else {
            msgStats['unknown_structure'] = (msgStats['unknown_structure'] || 0) + 1;
          }
        } catch {
          msgStats['raw_string'] = (msgStats['raw_string'] || 0) + 1;
        }
      } else if (Array.isArray(content)) {
        content.forEach(c => {
          if (c.type) msgStats[c.type] = (msgStats[c.type] || 0) + 1;
        });
      } else if (content?.type) {
        msgStats[content.type] = (msgStats[content.type] || 0) + 1;
      } else {
        msgStats['unknown'] = (msgStats['unknown'] || 0) + 1;
      }
    });
    console.log('  消息类型统计:', JSON.stringify(msgStats, null, 2));
    
    // 2.3 WorkflowNode (如果是DAG)
    if (session.workflowType === 'DAG') {
      const workflowNodes = await prisma.workflowNode.findMany({
        where: { workflowId: session.projectId },
        select: { id: true, label: true, type: true }
      });
      console.log('\n--- WorkflowNode:', workflowNodes.length, '条 ---');
      workflowNodes.forEach(wn => {
        console.log('  WN:', wn.id.slice(0,8), '| label:', wn.label, '| type:', wn.type);
        
        // 检查这个节点的消息
        const nodeMsgs = messages.filter(m => m.workflowNodeId === wn.id);
        console.log('    该节点消息:', nodeMsgs.length, '条');
      });
    }
    
    // 2.4 TODO (如果有)
    const todos = await prisma.$queryRaw`
      SELECT id, content, status, nodeId, agentCallMsgId
      FROM Todo
      WHERE sessionId = ${session.id}
      LIMIT 20
    `;
    console.log('\n--- TODO:', todos.length, '条 ---');
    todos.forEach(t => {
      console.log('  TODO:', t.id.slice(0,8), '| nodeId:', t.nodeId?.slice(0,8), '| agentCallMsgId:', t.agentCallMsgId?.slice(0,8), '| status:', t.status, '| content:', t.content?.slice(0,30));
    });
    
    // 2.5 检查子Agent调用消息
    console.log('\n--- 子Agent调用消息 ---');
    const agentCalls = messages.filter(m => {
      const content = m.content;
      if (typeof content === 'string') {
        try {
          const parsed = JSON.parse(content);
          return parsed.type === 'agent_call' || parsed.role === 'assistant' && parsed.content?.some?.(c => c.type === 'tool_use');
        } catch { return false; }
      }
      return content?.type === 'agent_call';
    });
    console.log('  agent_call消息数:', agentCalls.length);
    agentCalls.forEach(ac => {
      const content = typeof ac.content === 'string' ? JSON.parse(ac.content) : ac.content;
      console.log('    Agent调用:', ac.id.slice(0,8), '| workflowNodeId:', ac.workflowNodeId?.slice(0,8));
      console.log('    metadata:', JSON.stringify(ac.metadata, null, 2));
      
      // 检查对应的NodeExecution
      const ne = nodeExecutions.find(n => n.agentCallMsgId === ac.id);
      console.log('    对应NodeExecution:', ne ? ne.id.slice(0,8) : 'null');
      
      // 检查agentCallMsgId字段
      const msgsForAgent = messages.filter(m => {
        const meta = m.metadata;
        return meta?.agentCallMsgId === ac.id || meta?.parentAgentCallId === ac.id;
      });
      console.log('    有agentCallMsgId指向此Agent的消息:', msgsForAgent.length);
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());