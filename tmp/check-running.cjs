const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 查询所有运行状态的评估
  const runningEvals = await prisma.evaluationSession.findMany({
    where: { status: 'running' },
    select: {
      id: true,
      projectId: true,
      status: true,
      lastActivity: true,
    }
  });
  
  console.log(`Found ${runningEvals.length} running evaluations:\n`);
  
  runningEvals.forEach(e => {
    console.log(`  ${e.id} - projectId=${e.projectId}, lastActivity=${e.lastActivity}`);
  });
  
  // 详细检查用户指定的评估
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: 'eval-1777268403518-z8x6rv8gu' },
    include: {
      Project: { select: { name: true } },
      NodeExecution: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          workflowNodeId: true,
          nodeLabel: true,
          nodeType: true,
          status: true,
          order: true,
          startedAt: true,
          completedAt: true,
          updatedAt: true,
          opencodeSessionId: true,
        }
      }
    }
  });
  
  console.log('\n\n=== Detailed Evaluation ===');
  console.log('ID:', eval.id);
  console.log('Project:', eval.Project?.name);
  console.log('Status:', eval.status);
  console.log('WorkflowId:', eval.workflowId);
  console.log('WorkflowType:', eval.workflowType);
  console.log('Last Activity:', eval.lastActivity);
  console.log('\nNode Executions (count:', eval.NodeExecution?.length, '):');
  
  if (eval.NodeExecution && eval.NodeExecution.length > 0) {
    eval.NodeExecution.forEach(n => {
      console.log(`\n  Node #${n.order}:`);
      console.log(`    ID: ${n.id}`);
      console.log(`    Label: ${n.nodeLabel}`);
      console.log(`    Type: ${n.nodeType}`);
      console.log(`    Status: ${n.status}`);
      console.log(`    Started: ${n.startedAt}`);
      console.log(`    Completed: ${n.completedAt}`);
      console.log(`    Updated: ${n.updatedAt}`);
      console.log(`    SessionId: ${n.opencodeSessionId || 'NULL'}`);
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());