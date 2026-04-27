const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const evalId = 'eval-1777293551997-hpqyorkp6';
  
  // 更新为 cancelled
  const result = await prisma.evaluationSession.update({
    where: { id: evalId },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
      endReason: 'workflowType 错误，清理旧数据',
      lastActivity: new Date(),
    }
  });
  
  console.log('已清理评估:', evalId);
  console.log('新状态:', result.status);
  
  // 同时释放项目
  const project = await prisma.project.findFirst({
    where: { id: result.projectId },
    select: { status: true }
  });
  
  if (project?.status === 'running') {
    await prisma.project.update({
      where: { id: result.projectId },
      data: { status: 'idle' }
    });
    console.log('项目状态已更新为 idle');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());