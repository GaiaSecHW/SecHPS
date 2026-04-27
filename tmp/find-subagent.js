const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 查找所有会话，找一个有多个NodeExecution且时间范围不重叠的（可能是父子关系）
  const sessions = await prisma.evaluationSession.findMany({
    where: { 
      workflowType: { in: ['dag', 'fsm'] },
      status: { in: ['completed', 'running'] }
    },
    orderBy: { startedAt: 'desc' },
    take: 20,
    select: { id: true, workflowType: true, status: true, startedAt: true, completedAt: true }
  });
  
  console.log('\n=== 查找有子Agent执行的会话 ===');
  console.log('会话数:', sessions.length);
  
  // 检查每个会话的NodeExecution数量和时间范围
  for (const session of sessions) {
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
    
    // 检查是否有嵌套时间范围（父Agent包含子Agent）
    const hasNested = checkNestedExecutions(nodeExecutions);
    const hasMultiple = nodeExecutions.length > 1;
    
    console.log('\n会话:', session.id.slice(0,12), '| type:', session.workflowType, '| status:', session.status, '| NE数量:', nodeExecutions.length);
    
    if (nodeExecutions.length > 0) {
      nodeExecutions.forEach(ne => {
        console.log('  NE:', ne.id.slice(0,12), '| label:', ne.nodeLabel || ne.nodeType, '| tokens:', ne.inputTokens, '/', ne.outputTokens);
        console.log('    time:', ne.startedAt ? new Date(ne.startedAt).toLocaleTimeString('zh-CN') : 'null', '->', ne.completedAt ? new Date(ne.completedAt).toLocaleTimeString('zh-CN') : 'null');
        console.log('    workflowNodeId:', ne.workflowNodeId?.slice(0,12));
        console.log('    opencodeSession:', ne.opencodeSessionId?.slice(0,12));
      });
    }
    
    if (hasNested) {
      console.log('  ★ 有嵌套时间范围 - 可能是父子Agent关系');
    }
    
    if (hasMultiple && !hasNested) {
      console.log('  ★ 有多个NodeExecution - 可能是顺序执行');
    }
    
    // 如果有有意义的NodeExecution，详细检查
    if (hasMultiple || (nodeExecutions.length === 1 && nodeExecutions[0].nodeLabel)) {
      console.log('\n  详细检查...');
      
      // 查找Skill调用
      const skillCalls = await prisma.sessionMessage.findMany({
        where: {
          evaluationSessionId: session.id,
          role: 'tool_call'
        },
        select: { id: true, content: true, createdAt: true }
      });
      
      const parsedSkillCalls = [];
      skillCalls.forEach(tc => {
        try {
          const content = JSON.parse(tc.content);
          if (content.name === 'Skill') {
            parsedSkillCalls.push({
              msgId: tc.id,
              createdAt: tc.createdAt,
              skillName: content.args?.skill,
              toolUseId: content.toolUseId
            });
          }
        } catch {}
      });
      
      console.log('  Skill调用数:', parsedSkillCalls.length);
      if (parsedSkillCalls.length > 0) {
        parsedSkillCalls.slice(0, 3).forEach(sc => {
          console.log('    Skill:', sc.skillName, '| time:', new Date(sc.createdAt).toLocaleTimeString('zh-CN'));
        });
        
        // 检查Skill调用的结果
        for (const sc of parsedSkillCalls.slice(0, 1)) {
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
            const isError = content?.includes('Error') || content?.includes('error') || content?.includes('Unknown');
            console.log('    Skill结果:', isError ? '失败' : '成功');
            console.log('    结果内容:', content);
          }
        }
      }
      
      // 只详细检查第一个有意义的会话
      if (session.status === 'completed' && hasMultiple) {
        console.log('\n\n========================================');
        console.log('=== 深入分析第一个完成的会话 ===');
        await analyzeSession(session.id);
        break;
      }
    }
  }
}

function checkNestedExecutions(nodeExecutions) {
  for (let i = 0; i < nodeExecutions.length; i++) {
    for (let j = 0; j < nodeExecutions.length; j++) {
      if (i !== j) {
        const ne1 = nodeExecutions[i];
        const ne2 = nodeExecutions[j];
        
        // 检查ne2是否在ne1的时间范围内
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

async function analyzeSession(sessionId) {
  // 获取NodeExecution
  const nodeExecutions = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: sessionId },
    orderBy: { startedAt: 'asc' },
    select: { id: true, workflowNodeId: true, nodeLabel: true, startedAt: true, completedAt: true }
  });
  
  console.log('NodeExecutions:', nodeExecutions.length);
  
  // 获取所有消息
  const messages = await prisma.sessionMessage.findMany({
    where: { evaluationSessionId: sessionId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, workflowNodeId: true, metadata: true, createdAt: true }
  });
  
  console.log('总消息数:', messages.length);
  
  // 按NodeExecution时间范围分组消息
  for (const ne of nodeExecutions) {
    console.log('\n--- NodeExecution:', ne.id.slice(0,12), '| label:', ne.nodeLabel, '---');
    console.log('时间范围:', new Date(ne.startedAt).toLocaleString('zh-CN'), '->', new Date(ne.completedAt).toLocaleString('zh-CN'));
    
    const neMessages = messages.filter(m => {
      if (!ne.startedAt) return false;
      const msgTime = new Date(m.createdAt);
      const neStart = new Date(ne.startedAt);
      const neEnd = ne.completedAt ? new Date(ne.completedAt) : new Date();
      return msgTime >= neStart && msgTime <= neEnd;
    });
    
    console.log('时间范围内消息:', neMessages.length, '条');
    
    // 统计role
    const roleCounts = {};
    neMessages.forEach(m => {
      roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
    });
    console.log('角色统计:', JSON.stringify(roleCounts));
    
    // 统计workflowNodeId
    const nodeCounts = {};
    neMessages.forEach(m => {
      const nid = m.workflowNodeId?.slice(0,12) || 'null';
      nodeCounts[nid] = (nodeCounts[nid] || 0) + 1;
    });
    console.log('workflowNodeId统计:', JSON.stringify(nodeCounts));
    
    // 显示thinking和assistant消息
    console.log('thinking消息:');
    neMessages.filter(m => m.role === 'thinking').slice(0, 3).forEach(m => {
      console.log('  ', m.content?.slice(0, 50));
    });
    
    console.log('assistant_chunk消息:');
    neMessages.filter(m => m.role === 'assistant_chunk').slice(0, 3).forEach(m => {
      console.log('  ', m.content?.slice(0, 50));
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());