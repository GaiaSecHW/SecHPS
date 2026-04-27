const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 取一个DAG类型的会话详细分析消息内容
  const session = await prisma.evaluationSession.findFirst({
    where: { workflowType: 'dag', status: 'cancelled' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, projectId: true, workflowId: true }
  });
  
  console.log('\n=== 深入分析消息内容 ===');
  console.log('会话ID:', session.id);
  
  // 获取NodeExecution
  const nodeExecutions = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: session.id },
    select: { id: true, workflowNodeId: true, nodeLabel: true, startedAt: true, completedAt: true, opencodeSessionId: true }
  });
  console.log('\nNodeExecutions:', nodeExecutions.length);
  
  // 获取所有消息
  const messages = await prisma.sessionMessage.findMany({
    where: { evaluationSessionId: session.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, workflowNodeId: true, metadata: true, createdAt: true },
    take: 50  // 只取前50条进行分析
  });
  
  console.log('\n--- 前50条消息详细内容 ---');
  messages.forEach((m, idx) => {
    console.log(`\n[${idx}] msgId: ${m.id.slice(0,8)} | role: ${m.role} | nodeId: ${m.workflowNodeId?.slice(0,8) || 'null'}`);
    console.log('createdAt:', new Date(m.createdAt).toLocaleString('zh-CN'));
    
    // 解析content
    let contentParsed = null;
    if (typeof m.content === 'string') {
      try {
        contentParsed = JSON.parse(m.content);
      } catch {
        // 可能是普通文本
        console.log('content (text):', m.content.slice(0, 100));
        return;
      }
    } else {
      contentParsed = m.content;
    }
    
    if (contentParsed) {
      // 检查是否是数组
      if (Array.isArray(contentParsed)) {
        console.log('content (array):', contentParsed.length, 'items');
        contentParsed.forEach((item, i) => {
          if (item.type) {
            console.log(`  [${i}] type: ${item.type}`);
            if (item.type === 'text') {
              console.log(`      text: ${item.text?.slice(0, 50)}`);
            } else if (item.type === 'tool_use') {
              console.log(`      tool: ${item.name} | id: ${item.id?.slice(0,8)}`);
            } else if (item.type === 'tool_result') {
              console.log(`      toolUseId: ${item.tool_use_id?.slice(0,8)} | result: ${item.content?.slice(0, 50)}`);
            } else if (item.type === 'thinking') {
              console.log(`      thinking: ${item.thinking?.slice(0, 50)}`);
            }
          } else if (item.role) {
            console.log(`  [${i}] role: ${item.role}`);
          }
        });
      } else if (contentParsed.type) {
        console.log('content type:', contentParsed.type);
        if (contentParsed.type === 'agent_call') {
          console.log('  AGENT_CALL DETECTED!');
          console.log('  agentId:', contentParsed.agentId);
          console.log('  agentName:', contentParsed.agentName);
          console.log('  input:', JSON.stringify(contentParsed.input)?.slice(0, 100));
        } else if (contentParsed.type === 'agent_result') {
          console.log('  AGENT_RESULT DETECTED!');
          console.log('  result:', JSON.stringify(contentParsed.result)?.slice(0, 100));
        }
      } else if (contentParsed.role) {
        console.log('content role:', contentParsed.role);
        if (contentParsed.content && Array.isArray(contentParsed.content)) {
          console.log('  内部content:', contentParsed.content.length, 'items');
          contentParsed.content.forEach((item, i) => {
            if (item.type) {
              console.log(`    [${i}] type: ${item.type}`, item.name ? `name: ${item.name}` : '', item.id ? `id: ${item.id?.slice(0,8)}` : '');
            }
          });
        }
      } else {
        console.log('content (unknown):', JSON.stringify(contentParsed).slice(0, 200));
      }
    }
    
    // 解析metadata
    if (m.metadata) {
      try {
        const meta = JSON.parse(m.metadata);
        console.log('metadata:', JSON.stringify(meta).slice(0, 200));
      } catch {
        console.log('metadata (raw):', m.metadata.slice(0, 100));
      }
    }
  });
  
  // 搜索包含特定关键字的消息
  console.log('\n\n--- 搜索关键字消息 ---');
  
  // 搜索包含 "tool_use" 的消息
  const toolUseMsgs = messages.filter(m => {
    const content = m.content;
    if (typeof content === 'string') {
      return content.includes('tool_use') || content.includes('tool_result');
    }
    if (Array.isArray(content)) {
      return content.some(c => c.type === 'tool_use' || c.type === 'tool_result');
    }
    return false;
  });
  console.log('包含tool_use/tool_result的消息:', toolUseMsgs.length, '条');
  
  // 搜索包含 "agent" 的消息
  const agentMsgs = messages.filter(m => {
    const content = m.content;
    const metadata = m.metadata;
    const str = (typeof content === 'string' ? content : JSON.stringify(content)) + (metadata || '');
    return str.toLowerCase().includes('agent');
  });
  console.log('包含agent关键字的消息:', agentMsgs.length, '条');
  agentMsgs.forEach(m => {
    console.log('  msgId:', m.id.slice(0,8), '| role:', m.role);
    const content = m.content;
    if (typeof content === 'string') {
      const match = content.match(/agent[^"]{0,50}/gi);
      console.log('    match:', match?.slice(0, 3));
    }
  });
  
  // 搜索包含 "thinking" 的消息
  const thinkingMsgs = messages.filter(m => {
    const content = m.content;
    if (typeof content === 'string') {
      return content.includes('thinking') || content.includes('type:"thinking"');
    }
    if (Array.isArray(content)) {
      return content.some(c => c.type === 'thinking');
    }
    return false;
  });
  console.log('包含thinking的消息:', thinkingMsgs.length, '条');
  
  // 检查NodeExecution的时间范围与消息的关系
  console.log('\n\n--- NodeExecution时间范围与消息关系 ---');
  for (const ne of nodeExecutions) {
    console.log('\nNodeExecution:', ne.id.slice(0,8), '| label:', ne.nodeLabel, '| opencodeSession:', ne.opencodeSessionId?.slice(0,8));
    console.log('时间:', ne.startedAt ? new Date(ne.startedAt).toLocaleString('zh-CN') : 'null', '->', ne.completedAt ? new Date(ne.completedAt).toLocaleString('zh-CN') : 'null');
    
    // 查找时间范围内的消息
    const timeRangeMsgs = await prisma.sessionMessage.findMany({
      where: {
        evaluationSessionId: session.id,
        createdAt: {
          gte: ne.startedAt,
          lte: ne.completedAt || new Date()
        }
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, createdAt: true }
    });
    console.log('时间范围内消息数:', timeRangeMsgs.length);
    
    // 统计role
    const roleCounts = {};
    timeRangeMsgs.forEach(m => {
      roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
    });
    console.log('角色统计:', JSON.stringify(roleCounts));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());