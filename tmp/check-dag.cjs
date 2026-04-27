const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 查询 workflow 的完整节点定义
  const workflowId = 'cmo5psi2f0001xc7yi3tqzq4b';
  
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    select: {
      id: true,
      name: true,
      workflowType: true,
      nodes: true,  // JSON 字段，存储节点定义
      edges: true,  // JSON 字段，存储边定义
    }
  });
  
  console.log('=== Workflow ===');
  console.log('ID:', workflow?.id);
  console.log('Name:', workflow?.name);
  console.log('Type:', workflow?.workflowType);
  
  if (workflow?.nodes) {
    const nodes = JSON.parse(workflow.nodes);
    console.log('\n=== Nodes (from workflow definition) ===');
    console.log('Count:', nodes.length);
    nodes.forEach((n, i) => {
      console.log(`  ${i}: id=${n.id}, type=${n.type}, label=${n.data?.label || n.label || ''}`);
    });
  }
  
  if (workflow?.edges) {
    const edges = JSON.parse(workflow.edges);
    console.log('\n=== Edges ===');
    console.log('Count:', edges.length);
    edges.forEach((e, i) => {
      console.log(`  ${i}: source=${e.source}, target=${e.target}`);
    });
  }
  
  // 查询评估的节点执行记录
  const evalId = 'eval-1777287687449-17oddx9mq';
  const nodeExecutions = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: evalId },
    orderBy: { order: 'asc' },
    select: {
      workflowNodeId: true,
      nodeLabel: true,
      nodeType: true,
      status: true,
      order: true,
    }
  });
  
  console.log('\n=== Node Executions (from database) ===');
  console.log('Count:', nodeExecutions.length);
  nodeExecutions.forEach(n => {
    console.log(`  #${n.order}: nodeId=${n.workflowNodeId}, type=${n.nodeType}, status=${n.status}`);
  });
  
  // 分析：DAG 是否还有后续节点？
  const lastCompletedNode = nodeExecutions.filter(n => n.status === 'completed').pop();
  console.log('\n=== Analysis ===');
  console.log('Last completed node:', lastCompletedNode?.workflowNodeId);
  
  if (workflow?.edges && lastCompletedNode) {
    const edges = JSON.parse(workflow.edges);
    const nextNodes = edges.filter(e => e.source === lastCompletedNode.workflowNodeId);
    console.log('Next nodes in DAG:', nextNodes.map(e => e.target));
    
    if (nextNodes.length === 0) {
      console.log('结论: DAG 已执行完毕，没有后续节点');
    } else {
      console.log('结论: DAG 还有后续节点需要执行');
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());