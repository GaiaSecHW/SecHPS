// src/instrumentation.ts
// Next.js 服务启动钩子 - 恢复评估状态和触发队列调度

import { prisma } from '@/lib/prisma';
import { restoreLocksFromDatabase } from '@/lib/evaluation-lock';
import { processQueue } from '@/services/evaluation-queue';
import { logger, LOG_MODULES } from '@/lib/logger';

const LOG_PREFIX = '[Instrumentation]';

/**
 * 服务启动时执行
 * 1. 恢复项目锁状态（从数据库读取活跃评估）
 * 2. 检查并清理异常中断的评估（running但没有实际执行）
 * 3. 触发队列调度（启动排队的评估）
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log(`${LOG_PREFIX} 服务启动，开始恢复评估状态...`);
    
    try {
      // Step 1: 恢复项目锁状态
      console.log(`${LOG_PREFIX} 恢复项目锁状态...`);
      await restoreLocksFromDatabase(prisma);
      
      // Step 2: 检查异常中断的评估
      // 服务重启后，之前running的评估实际上已经停止
      // 需要将它们标记为failed或让用户手动处理
      console.log(`${LOG_PREFIX} 检查异常中断的评估...`);
      
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
        console.log(`${LOG_PREFIX} 活跃评估列表:`);
        runningEvaluations.forEach((eval, index) => {
          console.log(`  ${index + 1}. ${eval.id} - ${eval.Project?.name || '未知'} - 状态: ${eval.status}`);
        });
        
        // 注意：不自动将running评估标记为failed，因为用户可能需要查看它们的状态
        // 但需要通知用户这些评估可能已经中断
        // 可以通过前端显示"需要重新启动"的提示
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
        console.log(`${LOG_PREFIX} 排队评估列表:`);
        queuedEvaluations.forEach((eval, index) => {
          console.log(`  ${index + 1}. ${eval.id} - ${eval.Project?.name || '未知'} - 入队时间: ${eval.startedAt?.toISOString() || '未知'}`);
        });
        
        // 触发队列调度
        console.log(`${LOG_PREFIX} 触发队列调度...`);
        await processQueue();
        
        console.log(`${LOG_PREFIX} 队列调度完成`);
      }
      
      console.log(`${LOG_PREFIX} 评估状态恢复完成`);
      
    } catch (error) {
      console.error(`${LOG_PREFIX} 评估状态恢复失败:`, error);
      logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估状态恢复失败`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
}