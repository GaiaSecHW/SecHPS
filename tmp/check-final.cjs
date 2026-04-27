const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: 'eval-1777287687449-17oddx9mq' },
    include: {
      Project: { select: { name: true, projectPath: true } },
      NodeExecution: {
        orderBy: { order: 'asc' },
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
  
  if (!eval) {
    console.log('Evaluation not found');
    return;
  }
  
  console.log('=== Evaluation Status ===');
  console.log('ID:', eval.id);
  console.log('Status:', eval.status);
  console.log('Project:', eval.Project?.name);
  console.log('ProjectPath:', eval.Project?.projectPath);
  console.log('WorkflowId:', eval.workflowId);
  console.log('WorkflowType:', eval.workflowType);
  console.log('LastActivity:', eval.lastActivity);
  console.log('CompletedAt:', eval.completedAt);
  console.log('\n=== Node Executions ===');
  console.log('Count:', eval.NodeExecution?.length);
  
  eval.NodeExecution?.forEach(n => {
    console.log(`\nNode #${n.order}: ${n.nodeLabel}`);
    console.log(`  ID: ${n.id}`);
    console.log(`  Type: ${n.nodeType}`);
    console.log(`  Status: ${n.status}`);
    console.log(`  SessionId: ${n.opencodeSessionId || 'NULL'}`);
    console.log(`  Started: ${n.startedAt}`);
    console.log(`  Completed: ${n.completedAt}`);
    console.log(`  Updated: ${n.updatedAt}`);
  });
  
  // Check if there's a running node
  const runningNodes = eval.NodeExecution?.filter(n => n.status === 'running');
  console.log('\n=== Running Nodes ===');
  console.log('Count:', runningNodes?.length || 0);
}

main().catch(console.error).finally(() => prisma.$disconnect());