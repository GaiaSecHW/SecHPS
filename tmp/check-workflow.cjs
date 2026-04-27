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
      label: true,
      data: true,
      config: true,
    }
  });
  
  console.log('=== Workflow Nodes ===');
  console.log('Count:', workflowNodes.length);
  
  workflowNodes.forEach(n => {
    console.log(`\nNode: ${n.label || n.type}`);
    console.log(`  ID: ${n.id}`);
    console.log(`  Type: ${n.type}`);
    
    if (n.data) {
      try {
        const data = JSON.parse(n.data);
        console.log(`  Data:`, JSON.stringify(data, null, 2).substring(0, 500));
      } catch(e) {}
    }
    
    if (n.config) {
      try {
        const config = JSON.parse(n.config);
        console.log(`  Config:`, JSON.stringify(config, null, 2).substring(0, 500));
        if (config.subWorkflowId) {
          console.log(`  -> SubWorkflow: ${config.subWorkflowId}`);
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
    console.log(`  ${sourceNode?.label || sourceNode?.type || e.sourceId} -> ${targetNode?.label || targetNode?.type || e.targetId}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());