const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkEvaluation() {
  const evalId = 'eval-1776798928178-ve7wn116p';
  
  const evaluation = await prisma.evaluationSession.findUnique({
    where: { id: evalId }
  });
  
  console.log('Evaluation:', evaluation ? JSON.stringify(evaluation, null, 2) : 'NOT FOUND');
  
  // 检查最近的评估
  const recent = await prisma.evaluationSession.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, status: true, workflowType: true, createdAt: true }
  });
  
  console.log('\nRecent evaluations:');
  recent.forEach(e => console.log(`  ${e.id} - ${e.status} - ${e.workflowType} - ${e.createdAt}`));
  
  await prisma.$disconnect();
}

checkEvaluation();
