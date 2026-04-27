const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: 'eval-1777268403518-z8x6rv8gu' },
    include: {
      Project: { select: { name: true, projectPath: true } },
      NodeExecution: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          workflowNodeId: true,
          nodeLabel: true,
          nodeType: true,
          status: true,
          order: true,
          opencodeSessionId: true,
          startedAt: true,
          completedAt: true,
          updatedAt: true,
        }
      }
    }
  });
  
  console.log('=== Evaluation Status ===');
  console.log('ID:', eval.id);
  console.log('Status:', eval.status);
  console.log('Project:', eval.Project?.name);
  console.log('WorkflowId:', eval.workflowId);
  console.log('WorkflowType:', eval.workflowType);
  console.log('LastActivity:', eval.lastActivity);
  console.log('CompletedAt:', eval.completedAt);
  console.log('\n=== Node Executions ===');
  console.log('Count:', eval.NodeExecution?.length);
  
  eval.NodeExecution?.forEach(n => {
    console.log(`\nNode #${n.order}: ${n.nodeLabel}`);
    console.log(`  ID: ${n.id}`);
    console.log(`  nodeId: ${n.workflowNodeId}`);
    console.log(`  Type: ${n.nodeType}`);
    console.log(`  Status: ${n.status}`);
    console.log(`  SessionId: ${n.opencodeSessionId || 'NULL'}`);
    console.log(`  Started: ${n.startedAt}`);
    console.log(`  Completed: ${n.completedAt || 'NOT COMPLETED'}`);
    console.log(`  Updated: ${n.updatedAt}`);
  });
  
  // 查询 workflow 节点定义
  console.log('\n=== Workflow Nodes ===');
  const workflowNodes = await prisma.workflowNode.findMany({
    where: { workflowId: eval.workflowId },
    select: {
      id: true,
      nodeId: true,
      type: true,
      label: true,
      config: true,
    }
  });
  
  console.log('Workflow Nodes count:', workflowNodes.length);
  workflowNodes.forEach(n => {
    console.log(`  nodeId: ${n.nodeId}, type: ${n.type}, label: ${n.label}`);
    if (n.config) {
      const config = JSON.parse(n.config);
      if (config.subWorkflowId) {
        console.log(`    -> SubWorkflow: ${config.subWorkflowId}`);
      }
    }
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());