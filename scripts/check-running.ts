import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  // 查询运行中的评估
  const running = await prisma.evaluationSession.findMany({
    where: { status: { in: ['preparing', 'running'] } },
    include: { Project: { select: { name: true } } },
    orderBy: { startedAt: 'desc' }
  });
  
  console.log('=== 运行中的评估 ===');
  console.log('数量:', running.length);
  running.forEach(e => {
    console.log('- ' + e.id + ' | 项目: ' + (e.Project?.name || '未知') + ' | 状态: ' + e.status + ' | 启动: ' + e.startedAt);
  });
  
  // 查询排队中的评估
  const queued = await prisma.evaluationSession.findMany({
    where: { status: 'queued' },
    include: { Project: { select: { name: true } } },
    orderBy: { startedAt: 'asc' }
  });
  
  console.log('\n=== 排队中的评估 ===');
  console.log('数量:', queued.length);
  queued.forEach(e => {
    console.log('- ' + e.id + ' | 项目: ' + (e.Project?.name || '未知'));
  });
  
  // 查询全局配置的并发限制
  const config = await prisma.opencodeConfig.findFirst({
    where: { isActive: true },
    select: { name: true, maxConcurrentEvaluations: true }
  });
  
  console.log('\n=== 全局配置 ===');
  console.log('配置名: ' + (config?.name || '无激活配置'));
  console.log('并发限制: ' + (config?.maxConcurrentEvaluations ?? '未设置'));
  
  await prisma.$disconnect();
}

check();