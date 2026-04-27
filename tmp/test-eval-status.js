const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    // 获取最近5个评估会话的状态
    const evaluations = await prisma.evaluationSession.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        projectId: true,
        Project: { select: { name: true } },
      },
    });
    
    console.log('=== 最近评估会话状态 ===');
    for (const eval of evaluations) {
      const duration = eval.completedAt 
        ? Math.round((new Date(eval.completedAt) - new Date(eval.startedAt)) / 1000)
        : 'N/A';
      console.log(`${eval.id} | ${eval.status} | 项目: ${eval.Project?.name} | 耗时: ${duration}s`);
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();