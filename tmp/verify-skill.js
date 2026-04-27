const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 取一个DAG类型的会话，检查Skill调用
  const session = await prisma.evaluationSession.findFirst({
    where: { workflowType: 'dag', status: 'cancelled' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, projectId: true, workflowId: true }
  });
  
  console.log('\n=== 检查Skill调用（子Agent调用） ===');
  console.log('会话ID:', session.id);
  
  // 获取NodeExecution
  const nodeExecutions = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: session.id },
    select: { id: true, workflowNodeId: true, nodeLabel: true, startedAt: true, completedAt: true, opencodeSessionId: true }
  });
  console.log('\nNodeExecutions:', nodeExecutions.length);
  nodeExecutions.forEach(ne => {
    console.log('  NE:', ne.id.slice(0,12), '| nodeId:', ne.workflowNodeId?.slice(0,12), '| label:', ne.nodeLabel, '| opencodeSession:', ne.opencodeSessionId?.slice(0,12));
  });
  
  // 获取所有tool_call消息，筛选Skill调用
  const toolCalls = await prisma.sessionMessage.findMany({
    where: { 
      evaluationSessionId: session.id,
      role: 'tool_call'
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, content: true, workflowNodeId: true, metadata: true, createdAt: true }
  });
  
  console.log('\n--- tool_call消息:', toolCalls.length, '条 ---');
  
  // 找Skill调用
  const skillCalls = [];
  toolCalls.forEach(tc => {
    try {
      const content = JSON.parse(tc.content);
      if (content.name === 'Skill' || content.name === 'skill') {
        skillCalls.push({
          msgId: tc.id,
          workflowNodeId: tc.workflowNodeId,
          createdAt: tc.createdAt,
          toolUseId: content.toolUseId,
          skillName: content.args?.skill || content.args?.skill_name,
          metadata: tc.metadata
        });
      }
    } catch {}
  });
  
  console.log('\n--- Skill调用:', skillCalls.length, '条 ---');
  skillCalls.forEach(sc => {
    console.log('  Skill调用:', sc.msgId.slice(0,12));
    console.log('    toolUseId:', sc.toolUseId?.slice(0,12));
    console.log('    skillName:', sc.skillName);
    console.log('    workflowNodeId:', sc.workflowNodeId?.slice(0,12));
    console.log('    createdAt:', new Date(sc.createdAt).toLocaleString('zh-CN'));
    if (sc.metadata) {
      try {
        const meta = JSON.parse(sc.metadata);
        console.log('    metadata:', JSON.stringify(meta));
      } catch {}
    }
  });
  
  // 对于每个Skill调用，找对应的tool_result
  console.log('\n--- 检查Skill调用的tool_result ---');
  for (const sc of skillCalls.slice(0, 3)) {
    // 找对应的tool_result（通过时间顺序，下一个tool_result）
    const toolResult = await prisma.sessionMessage.findFirst({
      where: {
        evaluationSessionId: session.id,
        role: 'tool_result',
        createdAt: { gte: sc.createdAt }
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, metadata: true, createdAt: true }
    });
    
    if (toolResult) {
      console.log('\n  对应tool_result:', toolResult.id.slice(0,12));
      console.log('    createdAt:', new Date(toolResult.createdAt).toLocaleString('zh-CN'));
      console.log('    content:', toolResult.content?.slice(0, 100));
      if (toolResult.metadata) {
        try {
          const meta = JSON.parse(toolResult.metadata);
          console.log('    metadata:', JSON.stringify(meta));
        } catch {}
      }
    }
  }
  
  // 检查是否有子Agent执行的NodeExecution
  console.log('\n\n=== 检查子Agent NodeExecution ===');
  
  // 查找Skill调用时间范围内的NodeExecution
  for (const sc of skillCalls.slice(0, 3)) {
    console.log('\nSkill调用:', sc.msgId.slice(0,12), '| skill:', sc.skillName, '| time:', new Date(sc.createdAt).toLocaleString('zh-CN'));
    
    // 找Skill调用之后的NodeExecution（可能是子Agent）
    const childNE = nodeExecutions.find(ne => {
      // 检查是否在Skill调用之后开始
      if (ne.startedAt && sc.createdAt) {
        const neStart = new Date(ne.startedAt);
        const scTime = new Date(sc.createdAt);
        // Skill调用后5分钟内开始的NodeExecution
        const timeDiff = neStart.getTime() - scTime.getTime();
        return timeDiff >= 0 && timeDiff < 5 * 60 * 1000;
      }
      return false;
    });
    
    if (childNE) {
      console.log('  可能的子Agent NodeExecution:', childNE.id.slice(0,12));
      console.log('    label:', childNE.nodeLabel);
      console.log('    opencodeSession:', childNE.opencodeSessionId?.slice(0,12));
      console.log('    startedAt:', new Date(childNE.startedAt).toLocaleString('zh-CN'));
      
      // 查找这个NodeExecution时间范围内的消息
      const childMsgs = await prisma.sessionMessage.findMany({
        where: {
          evaluationSessionId: session.id,
          createdAt: {
            gte: childNE.startedAt,
            lte: childNE.completedAt || new Date()
          }
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, workflowNodeId: true, createdAt: true }
      });
      
      console.log('  时间范围内消息:', childMsgs.length, '条');
      
      // 统计role
      const roleCounts = {};
      childMsgs.forEach(m => {
        roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
      });
      console.log('  角色统计:', JSON.stringify(roleCounts));
      
      // 检查workflowNodeId
      const nodeCounts = {};
      childMsgs.forEach(m => {
        const nid = m.workflowNodeId || 'null';
        nodeCounts[nid] = (nodeCounts[nid] || 0) + 1;
      });
      console.log('  workflowNodeId统计:', JSON.stringify(nodeCounts));
      
      // 显示前5条消息内容
      console.log('  前5条消息:');
      childMsgs.slice(0, 5).forEach((m, i) => {
        console.log(`    [${i}] role:${m.role} | msgId:${m.id.slice(0,12)} | nodeId:${m.workflowNodeId?.slice(0,12) || 'null'}`);
        const content = m.content?.slice(0, 50);
        console.log(`        content: ${content}`);
      });
    } else {
      console.log('  未找到对应的子Agent NodeExecution');
    }
  }
  
  // 检查两个NodeExecution的关系
  console.log('\n\n=== NodeExecution关系分析 ===');
  if (nodeExecutions.length >= 2) {
    const ne1 = nodeExecutions[0];
    const ne2 = nodeExecutions[1];
    
    console.log('NE1:', ne1.id.slice(0,12), '| label:', ne1.nodeLabel, '| time:', new Date(ne1.startedAt).toLocaleString('zh-CN'), '->', new Date(ne1.completedAt).toLocaleString('zh-CN'));
    console.log('NE2:', ne2.id.slice(0,12), '| label:', ne2.nodeLabel, '| time:', new Date(ne2.startedAt).toLocaleString('zh-CN'), '->', new Date(ne2.completedAt).toLocaleString('zh-CN'));
    
    // 检查时间关系
    const ne1End = new Date(ne1.completedAt);
    const ne2Start = new Date(ne2.startedAt);
    const timeDiff = ne2Start.getTime() - ne1End.getTime();
    
    console.log('时间差:', timeDiff / 1000, '秒');
    console.log('NE2是否紧接NE1:', timeDiff >= 0 && timeDiff < 1000);
    
    // 检查是否有workflowNodeId关联
    console.log('workflowNodeId:', ne1.workflowNodeId?.slice(0,12), 'vs', ne2.workflowNodeId?.slice(0,12));
    console.log('是否相同:', ne1.workflowNodeId === ne2.workflowNodeId);
  }
  
  // 检查FSM类型的会话
  console.log('\n\n=== FSM类型会话分析 ===');
  const fsmSession = await prisma.evaluationSession.findFirst({
    where: { workflowType: 'fsm' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, projectId: true }
  });
  
  if (fsmSession) {
    console.log('FSM会话ID:', fsmSession.id);
    
    const fsmNodeExecutions = await prisma.nodeExecution.findMany({
      where: { evaluationSessionId: fsmSession.id },
      select: { id: true, workflowNodeId: true, nodeLabel: true, startedAt: true, completedAt: true }
    });
    console.log('FSM NodeExecutions:', fsmNodeExecutions.length);
    
    const fsmMessages = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: fsmSession.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, workflowNodeId: true, createdAt: true },
      take: 20
    });
    console.log('FSM 前20条消息:');
    fsmMessages.forEach((m, i) => {
      console.log(`  [${i}] role:${m.role} | nodeId:${m.workflowNodeId?.slice(0,12) || 'null'} | time:${new Date(m.createdAt).toLocaleString('zh-CN')}`);
    });
    
    // 统计workflowNodeId
    const fsmNodeCounts = {};
    fsmMessages.forEach(m => {
      const nid = m.workflowNodeId || 'null';
      fsmNodeCounts[nid] = (fsmNodeCounts[nid] || 0) + 1;
    });
    console.log('FSM workflowNodeId统计:', JSON.stringify(fsmNodeCounts));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());