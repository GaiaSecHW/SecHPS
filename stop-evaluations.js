const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function stopRunningEvaluations() {
  // 更新所有运行中的评估为失败状态
  const result = await prisma.evaluationSession.updateMany({
    where: { status: 'running' },
    data: {
      status: 'failed',
      completedAt: new Date(),
      endReason: 'manual_stop',
      endMessage: '手动停止测试'
    }
  });
  
  console.log(`Stopped ${result.count} running evaluations`);
  
  // 更新项目状态
  const projectResult = await prisma.project.updateMany({
    where: { status: 'running' },
    data: { status: 'pending' }
  });
  
  console.log(`Reset ${projectResult.count} running projects`);
  
  await prisma.$disconnect();
}

stopRunningEvaluations();
