// instrumentation.ts
// Next.js 服务启动钩子 - 恢复评估状态和触发队列调度

import { restoreLocksFromDatabase } from './src/lib/evaluation-lock';
import { processQueue } from './src/services/evaluation-queue';
import { prisma } from './src/lib/prisma';

const LOG_PREFIX = '[Instrumentation]';

/**
 * 服务启动时执行
 * 1. 恢复项目锁状态（从数据库读取活跃评估）
 * 2. 检查异常中断的评估（running但没有实际执行）
 * 3. 触发队列调度（启动排队的评估）
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log(`${LOG_PREFIX} 应用启动，恢复评估锁定状态...`);
    
    try {
      // Step 1: 恢复项目锁状态
      await restoreLocksFromDatabase(prisma);
      console.log(`${LOG_PREFIX} 评估锁定状态已恢复`);
      
      // Step 2: 检查异常中断的评估
      console.log(`${LOG_PREFIX} 检查活跃评估...`);
      
      const runningEvaluations = await prisma.evaluationSession.findMany({
        where: {
          status: { in: ['preparing', 'running'] },
        },
        include: {
          Project: {
            select: { name: true },
          },
        },
      });
      
      console.log(`${LOG_PREFIX} 发现 ${runningEvaluations.length} 个活跃评估`);
      
      if (runningEvaluations.length > 0) {
        runningEvaluations.forEach((session, index) => {
          console.log(`  ${index + 1}. ${session.id} - ${session.Project?.name || '未知'} - 状态: ${session.status}`);
        });
      }
      
      // Step 3: 检查排队评估并触发调度
      console.log(`${LOG_PREFIX} 检查排队评估...`);
      
      const queuedEvaluations = await prisma.evaluationSession.findMany({
        where: { status: 'queued' },
        include: {
          Project: {
            select: { name: true },
          },
        },
        orderBy: { startedAt: 'asc' },
      });
      
      console.log(`${LOG_PREFIX} 发现 ${queuedEvaluations.length} 个排队评估`);
      
      if (queuedEvaluations.length > 0) {
        queuedEvaluations.forEach((session, index) => {
          console.log(`  ${index + 1}. ${session.id} - ${session.Project?.name || '未知'} - 入队时间: ${session.startedAt?.toISOString() || '未知'}`);
        });
        
        // 触发队列调度
        console.log(`${LOG_PREFIX} ========== 触发队列调度 ==========`);
        await processQueue();
        console.log(`${LOG_PREFIX} ========== 队列调度完成 ==========`);
      }
      
      console.log(`${LOG_PREFIX} 评估状态恢复完成`);
      
    } catch (error) {
      console.error(`${LOG_PREFIX} 评估状态恢复失败:`, error);
    }
  }
}