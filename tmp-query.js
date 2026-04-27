const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const nodes = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: 'eval-1777044309579-obxh6lyb3' },
    orderBy: { order: 'asc' }
  });
  console.log('NodeExecutions:', JSON.stringify(nodes, null, 2));
  
  const session = await prisma.evaluationSession.findUnique({
    where: { id: 'eval-1777044309579-obxh6lyb3' }
  });
  console.log('EvaluationSession:', JSON.stringify(session, null, 2));
}

main().catch(e => console.error(e)).finally(() => prisma.disconnect());
