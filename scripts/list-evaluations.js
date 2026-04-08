const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const evaluations = await prisma.evaluationSession.findMany({
    select: {
      id: true,
      opencodeSessionId: true,
      status: true,
      createdAt: true,
      project: {
        select: { name: true, projectPath: true }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  
  console.log('最近的评估会话:');
  evaluations.forEach((e, i) => {
    console.log(`${i + 1}. ID: ${e.id}`);
    console.log(`   OpenCode Session ID: ${e.opencodeSessionId || '无'}`);
    console.log(`   项目: ${e.project?.name || '未知'}`);
    console.log(`   项目路径: ${e.project?.projectPath || '未知'}`);
    console.log(`   状态: ${e.status}`);
    console.log(`   创建时间: ${e.createdAt}`);
    console.log('');
  });
  
  await prisma.$disconnect();
})();
