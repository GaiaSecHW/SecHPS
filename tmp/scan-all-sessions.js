const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 查找所有会话
  const sessions = await prisma.evaluationSession.findMany({
    orderBy: { startedAt: 'desc' },
    take: 50,
    select: { 
      id: true, 
      projectId: true, 
      workflowId: true,
      workflowType: true, 
      status: true, 
      startedAt: true, 
      completedAt: true,
      todoList: true,
      totalInputTokens: true,
      totalOutputTokens: true
    }
  });
  
  console.log('\n=== 所有会话概览 ===');
  console.log('会话总数:', sessions.length);
  
  // 汇总统计
  const stats = {
    dag: 0,
    fsm: 0,
    null: 0,
    completed: 0,
    running: 0,
    failed: 0,
    cancelled: 0,
    withTodo: 0,
    withTokens: 0,
    withMessages: 0,
    withNodeExecutions: 0,
    withSkillCalls: 0,
    withNested: 0
  };
  
  // 详细检查每个会话
  const sessionDetails = [];
  
  for (const session of sessions) {
    // 统计类型
    if (session.workflowType === 'dag') stats.dag++;
    else if (session.workflowType === 'fsm') stats.fsm++;
    else stats.null++;
    
    // 统计状态
    stats[session.status] = (stats[session.status] || 0) + 1;
    
    // 检查todoList
    if (session.todoList) {
      stats.withTodo++;
    }
    
    // 检查tokens
    if (session.totalInputTokens > 0 || session.totalOutputTokens > 0) {
      stats.withTokens++;
    }
    
    // 检查NodeExecution
    const nodeExecutions = await prisma.nodeExecution.findMany({
      where: { evaluationSessionId: session.id },
      select: { 
        id: true, 
        workflowNodeId: true, 
        nodeLabel: true, 
        nodeType: true,
        startedAt: true, 
        completedAt: true,
        opencodeSessionId: true,
        inputTokens: true,
        outputTokens: true
      }
    });
    
    // 检查消息
    const messages = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: session.id },
      select: { id: true, role: true, workflowNodeId: true }
    });
    
    if (nodeExecutions.length > 0) stats.withNodeExecutions++;
    if (messages.length > 0) stats.withMessages++;
    
    // 检查Skill调用
    const skillCalls = await prisma.sessionMessage.findMany({
      where: {
        evaluationSessionId: session.id,
        role: 'tool_call',
        content: { contains: '"name":"Skill"' }
      },
      select: { id: true }
    });
    
    if (skillCalls.length > 0) stats.withSkillCalls++;
    
    // 检查嵌套
    const hasNested = checkNested(nodeExecutions);
    if (hasNested) stats.withNested++;
    
    // 记录详情
    sessionDetails.push({
      sessionId: session.id.slice(0, 12),
      projectId: session.projectId?.slice(0, 8),
      workflowType: session.workflowType,
      status: session.status,
      todoList: session.todoList ? '有' : '无',
      tokens: `${session.totalInputTokens}/${session.totalOutputTokens}`,
      nodeExecutions: nodeExecutions.length,
      messages: messages.length,
      skillCalls: skillCalls.length,
      hasNested: hasNested,
      neLabels: nodeExecutions.map(ne => ne.nodeLabel || ne.nodeType).join(', ')
    });
  }
  
  console.log('\n=== 统计结果 ===');
  console.log('类型分布: DAG:', stats.dag, '| FSM:', stats.fsm, '| NULL:', stats.null);
  console.log('状态分布: completed:', stats.completed, '| running:', stats.running, '| failed:', stats.failed, '| cancelled:', stats.cancelled);
  console.log('数据分布: withTodo:', stats.withTodo, '| withTokens:', stats.withTokens, '| withMessages:', stats.withMessages, '| withNodeExecutions:', stats.withNodeExecutions);
  console.log('子Agent分布: skillCalls:', stats.withSkillCalls, '| nested:', stats.withNested);
  
  console.log('\n=== 会话详情列表 ===');
  sessionDetails.forEach(s => {
    console.log('ID:', s.sessionId, '| type:', s.workflowType || 'null', '| status:', s.status);
    console.log('  todo:', s.todoList, '| tokens:', s.tokens, '| NE:', s.nodeExecutions, '| msgs:', s.messages, '| skillCalls:', s.skillCalls);
    console.log('  NE labels:', s.neLabels || '无');
    if (s.hasNested) console.log('  ★ 有嵌套关系');
    if (s.skillCalls > 0) console.log('  ★ 有Skill调用');
  });
  
  // 找出有完整数据的会话进行深入分析
  console.log('\n\n========================================');
  console.log('=== 深入分析有数据的会话 ===');
  
  // 找有NodeExecution和消息的会话
  const goodSessions = sessionDetails.filter(s => 
    s.nodeExecutions > 0 && s.messages > 0
  );
  
  console.log('有数据的会话数:', goodSessions.length);
  
  // 详细分析前5个有数据的会话
  for (const gs of goodSessions.slice(0, 5)) {
    console.log('\n\n=== 会话:', gs.sessionId, '===');
    const session = sessions.find(s => s.id.slice(0, 12) === gs.sessionId);
    
    if (!session) continue;
    
    // NodeExecution详情
    const nodeExecutions = await prisma.nodeExecution.findMany({
      where: { evaluationSessionId: session.id },
      orderBy: { startedAt: 'asc' },
      select: { 
        id: true, 
        workflowNodeId: true, 
        nodeLabel: true, 
        nodeType: true,
        startedAt: true, 
        completedAt: true,
        opencodeSessionId: true,
        inputTokens: true,
        outputTokens: true
      }
    });
    
    console.log('\nNodeExecution详情:');
    nodeExecutions.forEach(ne => {
      console.log('  NE:', ne.id.slice(0, 12));
      console.log('    workflowNodeId:', ne.workflowNodeId?.slice(0, 12));
      console.log('    label:', ne.nodeLabel, '| type:', ne.nodeType);
      console.log('    time:', ne.startedAt ? new Date(ne.startedAt).toLocaleString('zh-CN') : 'null', '->', ne.completedAt ? new Date(ne.completedAt).toLocaleString('zh-CN') : 'null');
      console.log('    opencodeSession:', ne.opencodeSessionId?.slice(0, 12));
      console.log('    tokens:', ne.inputTokens, '/', ne.outputTokens);
    });
    
    // 消息详情 - 按NodeExecution时间范围分组
    const allMessages = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: session.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, workflowNodeId: true, createdAt: true }
    });
    
    console.log('\n消息分布:');
    
    // 按workflowNodeId统计
    const nodeMsgCounts = {};
    allMessages.forEach(m => {
      const nid = m.workflowNodeId?.slice(0, 12) || 'null';
      nodeMsgCounts[nid] = (nodeMsgCounts[nid] || 0) + 1;
    });
    console.log('按workflowNodeId统计:', JSON.stringify(nodeMsgCounts));
    
    // 按role统计
    const roleCounts = {};
    allMessages.forEach(m => {
      roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
    });
    console.log('按role统计:', JSON.stringify(roleCounts));
    
    // 检查Skill调用
    const skillCallMessages = await prisma.sessionMessage.findMany({
      where: {
        evaluationSessionId: session.id,
        role: 'tool_call',
        content: { contains: '"name":"Skill"' }
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, workflowNodeId: true, createdAt: true }
    });
    
    console.log('\nSkill调用详情:', skillCallMessages.length, '条');
    for (const sc of skillCallMessages.slice(0, 3)) {
      try {
        const parsed = JSON.parse(sc.content);
        console.log('  Skill:', sc.id.slice(0, 12));
        console.log('    skillName:', parsed.args?.skill);
        console.log('    toolUseId:', parsed.toolUseId?.slice(0, 12));
        console.log('    workflowNodeId:', sc.workflowNodeId?.slice(0, 12));
        console.log('    time:', new Date(sc.createdAt).toLocaleString('zh-CN'));
        
        // 查找对应的tool_result
        const toolResult = await prisma.sessionMessage.findFirst({
          where: {
            evaluationSessionId: session.id,
            role: 'tool_result',
            createdAt: { gte: sc.createdAt }
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, content: true, createdAt: true }
        });
        
        if (toolResult) {
          const content = toolResult.content?.slice(0, 100);
          const isError = content?.toLowerCase().includes('error') || content?.toLowerCase().includes('unknown');
          console.log('    结果:', isError ? '❌失败' : '✓成功');
          console.log('    结果内容:', content);
        }
      } catch {}
    }
    
    // 检查TODO
    if (session.todoList) {
      console.log('\nTODO详情:');
      try {
        const todos = JSON.parse(session.todoList);
        console.log('  TODO数量:', todos.length);
        todos.slice(0, 5).forEach(t => {
          console.log('    content:', t.content?.slice(0, 30), '| status:', t.status, '| nodeId:', t.nodeId?.slice(0, 8));
        });
      } catch (e) {
        console.log('  解析失败:', e.message);
      }
    }
    
    // 检查子Agent执行
    if (skillCallMessages.length > 0) {
      console.log('\n子Agent执行检查:');
      
      for (const sc of skillCallMessages.slice(0, 1)) {
        const scTime = new Date(sc.createdAt);
        
        // 查找Skill调用后开始的NodeExecution
        const childNE = nodeExecutions.find(ne => {
          if (!ne.startedAt) return false;
          const neStart = new Date(ne.startedAt);
          // Skill调用后1分钟内开始
          return neStart >= scTime && neStart.getTime() - scTime.getTime() < 60000;
        });
        
        if (childNE) {
          console.log('  找到可能的子Agent NodeExecution:', childNE.id.slice(0, 12));
          console.log('    label:', childNE.nodeLabel);
          console.log('    startedAt:', new Date(childNE.startedAt).toLocaleString('zh-CN'));
          
          // 查找时间范围内的消息
          const childMessages = await prisma.sessionMessage.findMany({
            where: {
              evaluationSessionId: session.id,
              createdAt: {
                gte: childNE.startedAt,
                lte: childNE.completedAt || new Date()
              }
            },
            orderBy: { createdAt: 'asc' },
            select: { id: true, role: true, workflowNodeId: true, createdAt: true }
          });
          
          console.log('    时间范围内消息:', childMessages.length, '条');
          
          // 统计
          const childRoleCounts = {};
          childMessages.forEach(m => {
            childRoleCounts[m.role] = (childRoleCounts[m.role] || 0) + 1;
          });
          console.log('    角色统计:', JSON.stringify(childRoleCounts));
          
          // 检查workflowNodeId分布
          const childNodeCounts = {};
          childMessages.forEach(m => {
            const nid = m.workflowNodeId?.slice(0, 12) || 'null';
            childNodeCounts[nid] = (childNodeCounts[nid] || 0) + 1;
          });
          console.log('    workflowNodeId分布:', JSON.stringify(childNodeCounts));
          
          // 检查是否使用metadata中的agentCallMsgId
          const childMsgsWithMeta = await prisma.sessionMessage.findMany({
            where: {
              evaluationSessionId: session.id,
              createdAt: {
                gte: childNE.startedAt,
                lte: childNE.completedAt || new Date()
              },
              metadata: { not: null }
            },
            select: { id: true, metadata: true }
          });
          
          console.log('    有metadata的消息:', childMsgsWithMeta.length, '条');
          
          // 检查metadata中的agentCallMsgId
          const agentCallMsgIds = [];
          childMsgsWithMeta.forEach(m => {
            try {
              const meta = JSON.parse(m.metadata);
              if (meta.agentCallMsgId) {
                agentCallMsgIds.push(meta.agentCallMsgId);
              }
            } catch {}
          });
          
          console.log('    agentCallMsgId数量:', agentCallMsgIds.length);
          if (agentCallMsgIds.length > 0) {
            console.log('    agentCallMsgId样本:', agentCallMsgIds.slice(0, 3).map(id => id?.slice(0, 8)));
          }
        } else {
          console.log('  未找到对应的子Agent NodeExecution');
        }
      }
    }
  }
}

function checkNested(nodeExecutions) {
  for (let i = 0; i < nodeExecutions.length; i++) {
    for (let j = 0; j < nodeExecutions.length; j++) {
      if (i !== j) {
        const ne1 = nodeExecutions[i];
        const ne2 = nodeExecutions[j];
        
        if (ne1.startedAt && ne1.completedAt && ne2.startedAt && ne2.completedAt) {
          const ne1Start = new Date(ne1.startedAt);
          const ne1End = new Date(ne1.completedAt);
          const ne2Start = new Date(ne2.startedAt);
          const ne2End = new Date(ne2.completedAt);
          
          if (ne2Start >= ne1Start && ne2End <= ne1End) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

main().catch(console.error).finally(() => prisma.$disconnect());