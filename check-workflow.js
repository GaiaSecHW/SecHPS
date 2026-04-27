const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  // 检查 Workflow 表
  const workflows = await prisma.workflow.findMany({
    select: {
      id: true,
      name: true,
      workflowType: true,
      fsmTemplateId: true,
    }
  });
  
  console.log('=== Workflow 表 ===');
  workflows.forEach(w => {
    console.log(`ID: ${w.id}`);
    console.log(`  name: ${w.name}`);
    console.log(`  workflowType: ${w.workflowType}`);
    console.log(`  fsmTemplateId: ${w.fsmTemplateId}`);
    console.log('');
  });
  
  // 检查 WorkflowNode 表
  const nodes = await prisma.workflowNode.findMany({
    select: {
      id: true,
      workflowId: true,
      type: true,
      data: true,
    },
    take: 10
  });
  
  console.log('=== WorkflowNode 表 ===');
  nodes.forEach(n => {
    console.log(`ID: ${n.id}`);
    console.log(`  workflowId: ${n.workflowId}`);
    console.log(`  type: ${n.type}`);
    try {
      const data = JSON.parse(n.data || '{}');
      console.log(`  label: ${data.label || data.name || '无'}`);
    } catch {
      console.log(`  data: 解析失败`);
    }
    console.log('');
  });

  await prisma.$disconnect();
}
check();
