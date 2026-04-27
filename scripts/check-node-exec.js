const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const records = await prisma.nodeExecution.findMany({
    take: 10,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      status: true,
      inputTokens: true,
      outputTokens: true,
      startedAt: true,
      completedAt: true,
      updatedAt: true,
      evaluationSessionId: true,
      workflowNodeId: true,
      nodeLabel: true,
      modelName: true,
    }
  });
  console.log(JSON.stringify(records, null, 2));
}

main().finally(() => prisma.$disconnect());