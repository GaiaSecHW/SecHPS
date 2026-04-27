const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    // 查找所有编排和节点
    const workflows = await prisma.workflow.findMany({
      select: { id: true, name: true, workflowType: true },
    });
    
    console.log('=== 所有编排及其节点 ===');
    for (const w of workflows) {
      const nodes = await prisma.workflowNode.findMany({
        where: { workflowId: w.id },
        select: { id: true, data: true, type: true },
      });
      
      console.log(`编排: ${w.name} (type: ${w.workflowType})`);
      for (const n of nodes) {
        let data = {};
        try { data = JSON.parse(n.data || '{}'); } catch {}
        const label = data.label || data.name || n.type;
        console.log(`  节点: ${label} (type: ${n.type}, id: ${n.id})`);
      }
      console.log('');
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();