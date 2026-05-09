const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: 'eval-1777268388885-638hpn05s' },
    include: {
      NodeExecution: { orderBy: { order: 'asc' } },
      Workflow: { select: { id: true, workflowType: true } }
    }
  });
  console.log('Evaluation:', JSON.stringify({
    id: eval.id,
    status: eval.status,
    workflowType: eval.workflowType,
    Workflow: eval.Workflow
  }, null, 2));
  console.log('NodeExecutions:', JSON.stringify(eval.NodeExecution.map(n => ({
    id: n.id,
    nodeLabel: n.nodeLabel,
    status: n.status,
    order: n.order
  })), null, 2));
}

main().catch(console.error).finally(() => prisma.());
