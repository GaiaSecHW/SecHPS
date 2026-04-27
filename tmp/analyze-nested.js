const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 分析有嵌套关系的会话
  console.log('\n========================================');
  console.log('=== 分析有嵌套关系的会话 ===');
  
  // eval-1776799 (有4个NE, 有嵌套, completed)
  const session1 = await prisma.evaluationSession.findFirst({
    where: { id: { contains: 'eval-1776799' }, status: 'completed' },
    select: { id: true, projectId: true, workflowType: true, status: true, todoList: true, totalInputTokens: true, totalOutputTokens: true }
  });
  
  if (session1) {
    console.log('\n=== 会话1:', session1.id, '===');
    console.log('workflowType:', session1.workflowType, '| status:', session1.status);
    console.log('tokens:', session1.totalInputTokens, '/', session1.totalOutputTokens);
    
    const ne1 = await prisma.nodeExecution.findMany({
      where: { evaluationSessionId: session1.id },
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
    
    console.log('\nNodeExecution (按时间排序):');
    ne1.forEach(ne => {
      console.log('  NE:', ne.id.slice(0, 12));
      console.log('    workflowNodeId:', ne.workflowNodeId?.slice(0, 12));
      console.log('    label:', ne.nodeLabel, '| type:', ne.nodeType);
      console.log('    time:', ne.startedAt ? new Date(ne.startedAt).toLocaleString('zh-CN') : 'null', '->', ne.completedAt ? new Date(ne.completedAt).toLocaleString('zh-CN') : 'null');
      console.log('    tokens:', ne.inputTokens, '/', ne.outputTokens);
    });
    
    // 检查嵌套关系
    console.log('\n嵌套关系分析:');
    for (let i = 0; i < ne1.length; i++) {
      for (let j = 0; j < ne1.length; j++) {
        if (i !== j && ne1[i].startedAt && ne1[i].completedAt && ne1[j].startedAt && ne1[j].completedAt) {
          const ne_outer = ne1[i];
          const ne_inner = ne1[j];
          const outerStart = new Date(ne_outer.startedAt);
          const outerEnd = new Date(ne_outer.completedAt);
          const innerStart = new Date(ne_inner.startedAt);
          const innerEnd = new Date(ne_inner.completedAt);
          
          if (innerStart >= outerStart && innerEnd <= outerEnd) {
            console.log('  外层:', ne_outer.id.slice(0, 12), '| 内层:', ne_inner.id.slice(0, 12));
            console.log('    外层label:', ne_outer.nodeLabel, '| 内层label:', ne_inner.nodeLabel);
            console.log('    外层tokens:', ne_outer.inputTokens, '/', ne_outer.outputTokens);
            console.log('    内层tokens:', ne_inner.inputTokens, '/', ne_inner.outputTokens);
            
            // 查找内层时间范围内的消息
            const innerMsgs = await prisma.sessionMessage.findMany({
              where: {
                evaluationSessionId: session1.id,
                createdAt: {
                  gte: ne_inner.startedAt,
                  lte: ne_inner.completedAt
                }
              },
              orderBy: { createdAt: 'asc' },
              select: { id: true, role: true, workflowNodeId: true, metadata: true, createdAt: true }
            });
            
            console.log('    内层时间范围消息:', innerMsgs.length, '条');
            
            // 统计role
            const roleCounts = {};
            innerMsgs.forEach(m => {
              roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
            });
            console.log('    角色统计:', JSON.stringify(roleCounts));
            
            // 显示前5条消息
            console.log('    前5条消息:');
            innerMsgs.slice(0, 5).forEach(m => {
              console.log('      role:', m.role, '| msgId:', m.id.slice(0, 12), '| nodeId:', m.workflowNodeId?.slice(0, 12) || 'null');
            });
            
            // 检查metadata中的agentCallMsgId
            const msgsWithAgentCallId = [];
            innerMsgs.forEach(m => {
              if (m.metadata) {
                try {
                  const meta = JSON.parse(m.metadata);
                  if (meta.agentCallMsgId || meta.parentAgentCallId) {
                    msgsWithAgentCallId.push({
                      msgId: m.id,
                      agentCallMsgId: meta.agentCallMsgId || meta.parentAgentCallId
                    });
                  }
                } catch {}
              }
            });
            console.log('    有agentCallMsgId的消息:', msgsWithAgentCallId.length, '条');
            if (msgsWithAgentCallId.length > 0) {
              console.log('    agentCallMsgId样本:', msgsWithAgentCallId.slice(0, 3).map(m => m.agentCallMsgId?.slice(0, 12)));
            }
          }
        }
      }
    }
    
    // 查找Skill调用
    const skillCalls1 = await prisma.sessionMessage.findMany({
      where: {
        evaluationSessionId: session1.id,
        role: 'tool_call',
        content: { contains: '"name":"Skill"' }
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, workflowNodeId: true, createdAt: true }
    });
    
    console.log('\nSkill调用:', skillCalls1.length, '条');
    for (const sc of skillCalls1.slice(0, 3)) {
      try {
        const parsed = JSON.parse(sc.content);
        console.log('  Skill:', sc.id.slice(0, 12));
        console.log('    skillName:', parsed.args?.skill);
        console.log('    time:', new Date(sc.createdAt).toLocaleString('zh-CN'));
        
        // 查找对应的tool_result
        const toolResult = await prisma.sessionMessage.findFirst({
          where: {
            evaluationSessionId: session1.id,
            role: 'tool_result',
            createdAt: { gte: sc.createdAt }
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, content: true }
        });
        
        if (toolResult) {
          const content = toolResult.content?.slice(0, 150);
          const isError = content?.toLowerCase().includes('error') || content?.toLowerCase().includes('unknown');
          console.log('    结果:', isError ? '❌失败' : '✓成功');
          console.log('    内容:', content);
        }
      } catch {}
    }
  }
  
  // eval-1776798 (有6个NE, 有嵌套, failed)
  const session2 = await prisma.evaluationSession.findFirst({
    where: { id: { contains: 'eval-1776798' }, status: 'failed' },
    select: { id: true, projectId: true, workflowType: true, status: true, todoList: true, errorMessage: true }
  });
  
  if (session2) {
    console.log('\n\n========================================');
    console.log('=== 会话2:', session2.id, '===');
    console.log('workflowType:', session2.workflowType, '| status:', session2.status);
    console.log('errorMessage:', session2.errorMessage?.slice(0, 100));
    
    const ne2 = await prisma.nodeExecution.findMany({
      where: { evaluationSessionId: session2.id },
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
    
    console.log('\nNodeExecution (按时间排序):');
    ne2.forEach(ne => {
      console.log('  NE:', ne.id.slice(0, 12));
      console.log('    workflowNodeId:', ne.workflowNodeId?.slice(0, 12));
      console.log('    label:', ne.nodeLabel, '| type:', ne.nodeType);
      console.log('    time:', ne.startedAt ? new Date(ne.startedAt).toLocaleString('zh-CN') : 'null', '->', ne.completedAt ? new Date(ne.completedAt).toLocaleString('zh-CN') : 'null');
      console.log('    tokens:', ne.inputTokens, '/', ne.outputTokens);
    });
    
    // 检查嵌套关系
    console.log('\n嵌套关系分析:');
    for (let i = 0; i < ne2.length; i++) {
      for (let j = 0; j < ne2.length; j++) {
        if (i !== j && ne2[i].startedAt && ne2[i].completedAt && ne2[j].startedAt && ne2[j].completedAt) {
          const ne_outer = ne2[i];
          const ne_inner = ne2[j];
          const outerStart = new Date(ne_outer.startedAt);
          const outerEnd = new Date(ne_outer.completedAt);
          const innerStart = new Date(ne_inner.startedAt);
          const innerEnd = new Date(ne_inner.completedAt);
          
          if (innerStart >= outerStart && innerEnd <= outerEnd) {
            console.log('  外层:', ne_outer.id.slice(0, 12), '| 内层:', ne_inner.id.slice(0, 12));
            console.log('    外层label:', ne_outer.nodeLabel, '| 内层label:', ne_inner.nodeLabel);
          }
        }
      }
    }
    
    // 查找消息
    const msgs2 = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: session2.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, workflowNodeId: true, createdAt: true }
    });
    
    console.log('\n消息数:', msgs2.length);
    if (msgs2.length > 0) {
      const roleCounts = {};
      msgs2.forEach(m => {
        roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
      });
      console.log('角色统计:', JSON.stringify(roleCounts));
    }
  }
  
  // 分析有13个Skill调用的会话
  console.log('\n\n========================================');
  console.log('=== 分析多Skill调用的会话 ===');
  
  const session3 = await prisma.evaluationSession.findFirst({
    where: { id: { contains: 'eval-1776861' }, workflowType: 'dag' },
    select: { id: true, workflowType: true, status: true, todoList: true }
  });
  
  if (session3) {
    console.log('\n=== 会话3:', session3.id, '===');
    console.log('workflowType:', session3.workflowType, '| status:', session3.status);
    
    const ne3 = await prisma.nodeExecution.findMany({
      where: { evaluationSessionId: session3.id },
      orderBy: { startedAt: 'asc' },
      select: { 
        id: true, 
        workflowNodeId: true, 
        nodeLabel: true, 
        nodeType: true,
        startedAt: true, 
        completedAt: true,
        inputTokens: true,
        outputTokens: true
      }
    });
    
    console.log('\nNodeExecution:');
    ne3.forEach(ne => {
      console.log('  NE:', ne.id.slice(0, 12), '| label:', ne.nodeLabel || ne.nodeType, '| nodeId:', ne.workflowNodeId?.slice(0, 12));
      console.log('    time:', ne.startedAt ? new Date(ne.startedAt).toLocaleString('zh-CN') : 'null', '->', ne.completedAt ? new Date(ne.completedAt).toLocaleString('zh-CN') : 'null');
      console.log('    tokens:', ne.inputTokens, '/', ne.outputTokens);
    });
    
    // 查找所有Skill调用
    const skillCalls3 = await prisma.sessionMessage.findMany({
      where: {
        evaluationSessionId: session3.id,
        role: 'tool_call',
        content: { contains: '"name":"Skill"' }
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, workflowNodeId: true, createdAt: true }
    });
    
    console.log('\nSkill调用:', skillCalls3.length, '条');
    for (const sc of skillCalls3.slice(0, 5)) {
      try {
        const parsed = JSON.parse(sc.content);
        console.log('  Skill:', sc.id.slice(0, 12), '| name:', parsed.args?.skill);
        console.log('    workflowNodeId:', sc.workflowNodeId?.slice(0, 12));
        console.log('    time:', new Date(sc.createdAt).toLocaleTimeString('zh-CN'));
        
        // 查找对应的tool_result
        const toolResult = await prisma.sessionMessage.findFirst({
          where: {
            evaluationSessionId: session3.id,
            role: 'tool_result',
            createdAt: { gte: sc.createdAt }
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, content: true }
        });
        
        if (toolResult) {
          const content = toolResult.content?.slice(0, 80);
          const isError = content?.toLowerCase().includes('error') || content?.toLowerCase().includes('unknown');
          console.log('    结果:', isError ? '❌' : '✓', content);
        }
      } catch {}
    }
    
    // 查找成功执行的Skill
    const successSkills = [];
    for (const sc of skillCalls3) {
      const toolResult = await prisma.sessionMessage.findFirst({
        where: {
          evaluationSessionId: session3.id,
          role: 'tool_result',
          createdAt: { gte: sc.createdAt }
        },
        orderBy: { createdAt: 'asc' },
        select: { content: true }
      });
      
      if (toolResult) {
        const content = toolResult.content || '';
        const isError = content.toLowerCase().includes('error') || content.toLowerCase().includes('unknown');
        if (!isError) {
          try {
            const parsed = JSON.parse(sc.content);
            successSkills.push({
              skillName: parsed.args?.skill,
              msgId: sc.id,
              result: content.slice(0, 100)
            });
          } catch {}
        }
      }
    }
    
    console.log('\n成功执行的Skill:', successSkills.length, '条');
    successSkills.forEach(s => {
      console.log('  skill:', s.skillName, '| msgId:', s.msgId.slice(0, 12));
      console.log('    result:', s.result);
    });
    
    // 检查TODO
    if (session3.todoList) {
      console.log('\nTODO详情:');
      try {
        const todos = JSON.parse(session3.todoList);
        console.log('  TODO数量:', todos.length);
        todos.slice(0, 10).forEach(t => {
          console.log('    content:', t.content?.slice(0, 40), '| status:', t.status, '| nodeId:', t.nodeId?.slice(0, 12) || 'null');
        });
      } catch {}
    }
    
    // 检查消息的workflowNodeId分布
    const msgs3 = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: session3.id },
      select: { id: true, role: true, workflowNodeId: true }
    });
    
    const nodeCounts = {};
    msgs3.forEach(m => {
      const nid = m.workflowNodeId?.slice(0, 12) || 'null';
      nodeCounts[nid] = (nodeCounts[nid] || 0) + 1;
    });
    console.log('\n消息workflowNodeId分布:', JSON.stringify(nodeCounts));
    
    // 检查是否有子Agent的NodeExecution
    console.log('\n检查子Agent NodeExecution:');
    for (const sc of skillCalls3.slice(0, 3)) {
      const scTime = new Date(sc.createdAt);
      
      // 查找Skill调用后开始的NodeExecution
      const childNE = ne3.find(ne => {
        if (!ne.startedAt) return false;
        const neStart = new Date(ne.startedAt);
        // Skill调用后30秒内开始，且有独立label
        return neStart >= scTime && neStart.getTime() - scTime.getTime() < 30000 && ne.nodeLabel && ne.nodeLabel !== 'task';
      });
      
      if (childNE) {
        console.log('  找到可能的子Agent NE:', childNE.id.slice(0, 12));
        console.log('    label:', childNE.nodeLabel);
        console.log('    startedAt:', new Date(childNE.startedAt).toLocaleString('zh-CN'));
      } else {
        console.log('  未找到对应的子Agent NE');
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());