const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const configs = await prisma.opencodeConfig.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
      progressQuestion: true,
      userId: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  
  console.log('Total configs:', configs.length);
  console.log('');
  
  for (const config of configs) {
    console.log('---');
    console.log('ID:', config.id);
    console.log('Name:', config.name);
    console.log('isActive:', config.isActive);
    console.log('userId:', config.userId);
    console.log('progressQuestion:', config.progressQuestion ? `${config.progressQuestion.substring(0, 50)}...` : '(empty)');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
