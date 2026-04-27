const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. 查看所有评估会话
  const sessions = await prisma.evaluationSession.findMany({
    orderBy: { startedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      projectId: true,
      status: true,
      workflowType: true,
      startedAt: true,
      completedAt: true,
      workflowId: true
    }
  });
  
  console.log('\n=== 评估会话列表 ===');
  sessions.forEach(s => {
    console.log('ID:', s.id.slice(0,8), '| Project:', s.projectId.slice(0,8), '| Workflow:', s.workflowId?.slice(0,8), '| Status:', s.status, '| Type:', s.workflowType);
    console.log('  Start:', new Date(s.startedAt).toLocaleString('zh-CN'), '| End:', s.completedAt ? new Date(s.completedAt).toLocaleString('zh-CN') : 'null');
  });
  
  // 2. 对每个会话，检查数据完整性
  for (const session of sessions.slice(0, 3)) {
    console.log('\n\n========================================');
    console.log('=== 会话详情:', session.id.slice(0,8), '| Type:', session.workflowType, '===');
    
    // 2.1 NodeExecution
    const nodeExecutions = await prisma.nodeExecution.findMany({
      where: { evaluationSessionId: session.id },
      select: {
        id: true,
        workflowNodeId: true,
        nodeLabel: true,
        nodeType: true,
        status: true,
        startedAt: true,
        completedAt: true,
        opencodeSessionId: true,
        inputTokens: true,
        outputTokens: true
      }
    });
    console.log('\n--- NodeExecution:', nodeExecutions.length, '条 ---');
    nodeExecutions.forEach(ne => {
      console.log('  NE:', ne.id.slice(0,8), '| workflowNodeId:', ne.workflowNodeId?.slice(0,8), '| label:', ne.nodeLabel, '| type:', ne.nodeType, '| status:', ne.status);
      console.log('    opencodeSessionId:', ne.opencodeSessionId?.slice(0,8), '| tokens:', ne.inputTokens, '/', ne.outputTokens);
    });
    
    // 2.2 SessionMessage - 按节点分组
    const messages = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: session.id },
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
    const nodeMsgCounts = {};
    messages.forEach(m => {
      // 按节点统计
      const nodeId = m.workflowNodeId || 'null';
      nodeMsgCounts[nodeId] = (nodeMsgCounts[nodeId] || 0) + 1;
      
      // 解析content统计类型
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
          } else if (parsed.role === 'assistant') {
            msgStats['assistant_message'] = (msgStats['assistant_message'] || 0) + 1;
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
    console.log('  按节点消息数:', JSON.stringify(nodeMsgCounts, null, 2));
    
    // 2.3 WorkflowNode (如果是DAG)
    if (session.workflowType === 'DAG' && session.workflowId) {
      const workflowNodes = await prisma.workflowNode.findMany({
        where: { workflowId: session.workflowId },
        select: { id: true, type: true }
      });
      console.log('\n--- WorkflowNode:', workflowNodes.length, '条 ---');
      
      // 获取每个节点的data中的label
      for (const wn of workflowNodes) {
        try {
          const data = JSON.parse(wn.data || '{}');
          console.log('  WN:', wn.id.slice(0,8), '| label:', data.label || wn.type, '| type:', wn.type);
          
          // 检查这个节点的消息
          const nodeMsgs = messages.filter(m => m.workflowNodeId === wn.id);
          console.log('    该节点消息:', nodeMsgs.length, '条');
          
          // 检查对应的NodeExecution
          const ne = nodeExecutions.find(n => n.workflowNodeId === wn.id);
          console.log('    对应NodeExecution:', ne ? (ne.id.slice(0,8) + ' | status:' + ne.status) : 'null');
        } catch (e) {
          console.log('  WN:', wn.id.slice(0,8), '| data parse error');
        }
      }
    }
    
    // 2.4 检查是否有todoList字段
    console.log('\n--- Todo数据检查 ---');
    if (session.todoList) {
      try {
        const todos = JSON.parse(session.todoList);
        console.log('  todoList字段存在，解析结果:', todos.length, '个TODO');
        todos.slice(0, 5).forEach(t => {
          console.log('    TODO:', t.content?.slice(0,30), '| nodeId:', t.nodeId?.slice(0,8), '| status:', t.status);
        });
      } catch (e) {
        console.log('  todoList解析失败:', e.message);
      }
    } else {
      console.log('  todoList字段为空');
    }
    
    // 2.5 检查子Agent调用 - 查找agent_call类型的消息
    console.log('\n--- 子Agent调用检查 ---');
    const agentCalls = [];
    messages.forEach(m => {
      const content = m.content;
      if (typeof content === 'string') {
        try {
          const parsed = JSON.parse(content);
          // 检查是否是agent_call类型
          if (parsed.type === 'agent_call') {
            agentCalls.push({ msgId: m.id, workflowNodeId: m.workflowNodeId, parsed });
          }
          // 检查metadata中是否有agent调用信息
          if (m.metadata) {
            const meta = JSON.parse(m.metadata);
            if (meta.agentCall || meta.subAgent) {
              agentCalls.push({ msgId: m.id, workflowNodeId: m.workflowNodeId, metadata: meta });
            }
          }
        } catch {}
      }
    });
    console.log('  找到agent_call消息:', agentCalls.length, '条');
    
    if (agentCalls.length > 0) {
      agentCalls.slice(0, 3).forEach(ac => {
        console.log('  Agent调用:', ac.msgId.slice(0,8), '| workflowNodeId:', ac.workflowNodeId?.slice(0,8));
        if (ac.parsed) {
          console.log('    parsed内容:', JSON.stringify(ac.parsed, null, 2).slice(0,200));
        }
        if (ac.metadata) {
          console.log('    metadata:', JSON.stringify(ac.metadata, null, 2).slice(0,200));
        }
        
        // 检查是否有对应的时间范围消息
        // 找到这个agent调用的NodeExecution的时间范围
        const ne = nodeExecutions.find(n => n.workflowNodeId === ac.workflowNodeId);
        if (ne) {
          console.log('    对应NodeExecution时间:', ne.startedAt ? new Date(ne.startedAt).toLocaleString('zh-CN') : 'null', '->', ne.completedAt ? new Date(ne.completedAt).toLocaleString('zh-CN') : 'null');
          
          // 查找时间范围内的消息
          const timeRangeMsgs = messages.filter(m => {
            const createdAt = m.createdAt;
            if (ne.startedAt && ne.completedAt) {
              return createdAt >= ne.startedAt && createdAt <= ne.completedAt;
            }
            return false;
          });
          console.log('    时间范围内消息:', timeRangeMsgs.length, '条');
          
          // 显示消息类型
          const rangeTypes = {};
          timeRangeMsgs.forEach(m => {
            const content = m.content;
            if (typeof content === 'string') {
              try {
                const parsed = JSON.parse(content);
                if (parsed.type) rangeTypes[parsed.type] = (rangeTypes[parsed.type] || 0) + 1;
                else if (Array.isArray(parsed)) parsed.forEach(p => { if (p.type) rangeTypes[p.type] = (rangeTypes[p.type] || 0) + 1; });
              } catch {}
            }
          });
          console.log('    时间范围内消息类型:', JSON.stringify(rangeTypes));
        }
      });
    }
    
    // 2.6 检查metadata中的agentCallMsgId字段
    console.log('\n--- metadata中agentCallMsgId检查 ---');
    const msgsWithAgentCallId = [];
    messages.forEach(m => {
      if (m.metadata) {
        try {
          const meta = JSON.parse(m.metadata);
          if (meta.agentCallMsgId) {
            msgsWithAgentCallId.push({ msgId: m.id, agentCallMsgId: meta.agentCallMsgId, workflowNodeId: m.workflowNodeId });
          }
        } catch {}
      }
    });
    console.log('  有agentCallMsgId的消息:', msgsWithAgentCallId.length, '条');
    if (msgsWithAgentCallId.length > 0) {
      msgsWithAgentCallId.slice(0, 5).forEach(m => {
        console.log('    msgId:', m.msgId.slice(0,8), '| agentCallMsgId:', m.agentCallMsgId?.slice(0,8), '| nodeId:', m.workflowNodeId?.slice(0,8));
      });
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());