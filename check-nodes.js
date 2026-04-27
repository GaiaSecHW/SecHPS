const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  // 1. 检查最近的评估
  const evals = await prisma.evaluationSession.findMany({
    take: 3,
    select: { 
      id: true, 
      status: true, 
      workflowType: true, 
      workflowId: true,
      projectId: true
    }
  });
  console.log('=== 最近评估 ===');
  console.log(JSON.stringify(evals, null, 2));

  // 2. 检查节点执行记录
  if (evals.length > 0) {
    const latestEval = evals[0];
    const nodeExecs = await prisma.nodeExecution.findMany({
      where: { evaluationSessionId: latestEval.id },
      select: {
        id: true,
        workflowNodeId: true,
        nodeLabel: true,
        nodeType: true,
        status: true
      }
    });
    console.log('\n=== 节点执行记录 ===');
    console.log('评估ID:', latestEval.id);
    console.log('节点数量:', nodeExecs.length);
    nodeExecs.forEach(n => {
      console.log(`- ${n.nodeLabel} (${n.nodeType}) | nodeId: ${n.workflowNodeId} | status: ${n.status}`);
    });

    // 3. 检查消息
    const messages = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: latestEval.id },
      select: {
        id: true,
        workflowNodeId: true,
        role: true,
        content: true
      }
    });
    console.log('\n=== 消息记录 ===');
    console.log('消息数量:', messages.length);
    messages.forEach(m => {
      console.log(`- nodeId: ${m.workflowNodeId} | role: ${m.role} | content length: ${m.content?.length || 0}`);
    });
  }

  // 4. 检查 FSM 模板
  const fsmTemplate = await prisma.fSMTemplate.findFirst();
  if (fsmTemplate) {
    console.log('\n=== FSM 模板 ===');
    console.log('ID:', fsmTemplate.id);
    console.log('Name:', fsmTemplate.name);
    console.log('NodeCount:', fsmTemplate.nodeCount);
    try {
      const nodes = JSON.parse(fsmTemplate.nodes);
      console.log('实际节点数:', nodes.length);
      nodes.forEach(n => console.log(`  - ${n.id}: ${n.label}`));
    } catch (e) {
      console.log('解析 nodes 失败:', e.message);
    }
  }

  // 5. 检查 Workflow 表
  const workflows = await prisma.workflow.findMany({
    take: 3,
    select: {
      id: true,
      name: true,
      type: true,
      fsmTemplateId: true
    }
  });
  console.log('\n=== Workflow ===');
  console.log(JSON.stringify(workflows, null, 2));

  await prisma.$disconnect();
}
check();
