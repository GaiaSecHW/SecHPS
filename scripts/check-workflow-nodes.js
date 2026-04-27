const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 获取 FSM workflow 的所有 WorkflowNode（包括 fsmOrder）
  const workflow = await prisma.workflow.findFirst({
    where: { workflowType: 'fsm' },
    select: { id: true }
  });
  
  if (workflow) {
    const workflowNodes = await prisma.workflowNode.findMany({
      where: { workflowId: workflow.id },
      select: {
        id: true,
        type: true,
        fsmPhase: true,
        fsmOrder: true,
        fsmFixed: true,
        skills: true,
        vulnerabilityCategories: true,
        data: true,
        positionX: true,
        positionY: true
      }
    });
    
    console.log('WorkflowNode 表完整信息:');
    for (const wn of workflowNodes) {
      const data = wn.data ? JSON.parse(wn.data) : {};
      console.log(`\n节点: ${wn.id}`);
      console.log(`  type: ${wn.type}`);
      console.log(`  fsmPhase: ${wn.fsmPhase}`);
      console.log(`  fsmOrder: ${wn.fsmOrder}`);
      console.log(`  fsmFixed: ${wn.fsmFixed}`);
      console.log(`  position: (${wn.positionX}, ${wn.positionY})`);
      console.log(`  label: ${data.label}`);
      console.log(`  skillLoadingMode: ${data.skillLoadingMode}`);
      console.log(`  skills: ${wn.skills}`);
      console.log(`  vulnCategories: ${wn.vulnerabilityCategories}`);
    }
    
    // 按 fsmOrder 排序看执行顺序
    const sortedNodes = workflowNodes
      .filter(n => n.fsmOrder !== null)
      .sort((a, b) => (a.fsmOrder || 0) - (b.fsmOrder || 0));
    
    console.log('\n按 fsmOrder 排序的执行顺序:');
    for (const n of sortedNodes) {
      const data = n.data ? JSON.parse(n.data) : {};
      console.log(`  ${n.fsmOrder}: ${n.id} (${data.label || n.type})`);
    }
  }
}

main().finally(() => prisma.$disconnect());