const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    // 模拟 projects API 的查询
    const projects = await prisma.project.findMany({
      include: {
        EvaluationSession: {
          orderBy: { startedAt: 'desc' },
          take: 3,
        },
        _count: {
          select: {
            Vulnerability: {
              where: {
                status: { notIn: ['false-positive', 'closed'] }
              }
            }
          }
        }
      },
    });
    
    console.log('=== 项目列表评估状态 ===');
    for (const project of projects) {
      const evals = project.EvaluationSession || [];
      
      // 计算 evaluationStatus（与 API 一致）
      const runningCount = evals.filter(e => e.status === 'running').length;
      const waitingCount = evals.filter(e => e.status === 'preparing' || e.status === 'ready').length;
      const completedCount = evals.filter(e => e.status === 'completed').length;
      const failedCount = evals.filter(e => e.status === 'failed' || e.status === 'cancelled').length;
      
      let evaluationStatus = 'idle';
      if (runningCount > 0) {
        evaluationStatus = 'running';
      } else if (waitingCount > 0) {
        evaluationStatus = 'waiting';
      } else if (failedCount > 0) {
        evaluationStatus = 'failed';
      } else if (completedCount > 0) {
        evaluationStatus = 'completed';
      }
      
      console.log(`项目: ${project.name}`);
      console.log(`  最近评估状态: ${evals.map(e => e.status).join(', ')}`);
      console.log(`  统计: running=${runningCount}, waiting=${waitingCount}, completed=${completedCount}, failed=${failedCount}`);
      console.log(`  evaluationStatus: ${evaluationStatus}`);
      console.log('');
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();