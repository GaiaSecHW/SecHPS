const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const evaluation = await prisma.evaluationSession.findUnique({
    where: { id: 'cmnmtuj3r0001wq2569emzeh8' }
  });
  
  console.log('Evaluation Status:', evaluation.status);
  console.log('Completed At:', evaluation.completedAt);
  console.log('Error Message:', evaluation.errorMessage);
  console.log('Started At:', evaluation.startedAt);
}

check()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
