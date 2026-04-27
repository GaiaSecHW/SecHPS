const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const nodeId = 'wn-1777050632034-lke4zm0b2';
  
  const node = await prisma.workflowNode.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      type: true,
      data: true,
      skills: true,
    }
  });
  
  console.log('=== 安全排查节点详情 ===');
  console.log('ID:', node?.id);
  console.log('Type:', node?.type);
  
  if (node?.data) {
    console.log('\n=== Data (完整) ===');
    const data = JSON.parse(node.data);
    console.log(JSON.stringify(data, null, 2));
  }
  
  if (node?.skills) {
    console.log('\n=== Skills (完整) ===');
    const skills = JSON.parse(node.skills);
    console.log('Skills count:', skills.length);
    console.log(JSON.stringify(skills, null, 2));
  }
  
  // 查询这个评估的 NodeExecution 是否有更多子任务
  const evalId = 'eval-1777268403518-z8x6rv8gu';
  const nodeExecutions = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: evalId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      workflowNodeId: true,
      nodeLabel: true,
      nodeType: true,
      status: true,
      order: true,
      createdAt: true,
    }
  });
  
  console.log('\n=== NodeExecution 记录 ===');
  console.log('Count:', nodeExecutions.length);
  nodeExecutions.forEach(n => {
    console.log(`  #${n.order}: ${n.nodeLabel || n.nodeType} - ${n.status} (nodeId: ${n.workflowNodeId})`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());