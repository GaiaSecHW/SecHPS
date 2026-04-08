// 查询评估会话信息
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const evaluationId = 'cmnmtuj3r0001wq2569emzeh8';
  
  const evaluation = await prisma.evaluationSession.findUnique({
    where: { id: evaluationId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          projectPath: true,
        }
      }
    }
  });

  if (!evaluation) {
    console.log('Evaluation not found');
    return;
  }

  console.log('Evaluation ID:', evaluation.id);
  console.log('OpenCode Session ID:', evaluation.opencodeSessionId);
  console.log('Project:', evaluation.project);
  console.log('Status:', evaluation.status);
  console.log('Started at:', evaluation.startedAt);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
