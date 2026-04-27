const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    // 检查 task 类型节点的 data 内容
    const nodes = await prisma.workflowNode.findMany({
      where: { type: 'task' },
      select: { id: true, type: true, data: true },
    });
    
    console.log('=== task 类型节点的 data 内容 ===');
    for (const node of nodes) {
      let data = {};
      try { data = JSON.parse(node.data || '{}'); } catch {}
      console.log(`节点 ID: ${node.id}`);
      console.log(`  data.skills: ${JSON.stringify(data.skills)}`);
      console.log(`  data.vulnerabilityCategories: ${JSON.stringify(data.vulnerabilityCategories)}`);
      console.log(`  data.description: ${data.description || '(无)'}`);
      console.log(`  data 完整: ${JSON.stringify(data).substring(0, 500)}`);
      console.log('');
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();