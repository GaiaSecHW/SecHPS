const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const workflowId = 'cmo2pt46s00018pv5uckw0g5m';
  
  // 查询 workflow 节点定义
  const workflowNodes = await prisma.workflowNode.findMany({
    where: { workflowId },
    select: {
      id: true,
      type: true,
      data: true,
      skills: true,
    }
  });
  
  console.log('=== Workflow Nodes ===');
  console.log('Count:', workflowNodes.length);
  
  workflowNodes.forEach(n => {
    console.log(`\nNode ID: ${n.id}`);
    console.log(`  Type: ${n.type}`);
    
    if (n.data) {
      try {
        const data = JSON.parse(n.data);
        console.log(`  Label: ${data.label || 'no label'}`);
        if (data.subWorkflowId) {
          console.log(`  -> SubWorkflow: ${data.subWorkflowId}`);
        }
      } catch(e) {
        console.log(`  Data parse error`);
      }
    }
    
    if (n.skills) {
      try {
        const skills = JSON.parse(n.skills);
        if (Array.isArray(skills) && skills.length > 0) {
          console.log(`  Skills (${skills.length}):`, skills.map(s => s.name || s).join(', ').substring(0, 200));
        }
      } catch(e) {}
    }
  });
  
  // 查询 workflow 边
  const edges = await prisma.workflowEdge.findMany({
    where: { workflowId },
    select: {
      id: true,
      sourceId: true,
      targetId: true,
    }
  });
  
  console.log('\n=== Workflow Edges ===');
  console.log('Count:', edges.length);
  edges.forEach(e => {
    const sourceNode = workflowNodes.find(n => n.id === e.sourceId);
    const targetNode = workflowNodes.find(n => n.id === e.targetId);
    const sourceLabel = sourceNode?.data ? JSON.parse(sourceNode.data).label : sourceNode?.type;
    const targetLabel = targetNode?.data ? JSON.parse(targetNode.data).label : targetNode?.type;
    console.log(`  ${sourceLabel || e.sourceId} -> ${targetLabel || e.targetId}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());