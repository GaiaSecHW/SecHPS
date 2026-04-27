const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkProject() {
  const project = await prisma.project.findUnique({
    where: { id: 'proj-1776612189849-0hp5tacbh' },
    include: {
      EvaluationSession: {
        orderBy: { startedAt: 'desc' },
      },
    },
  });
  
  console.log('项目:', project?.name);
  console.log('EvaluationSession 数量:', project?.EvaluationSession?.length);
  
  for (const e of project?.EvaluationSession || []) {
    console.log(`  ${e.id}: status=${e.status}, startedAt=${e.startedAt}`);
  }
  
  await prisma.$disconnect();
}

checkProject();