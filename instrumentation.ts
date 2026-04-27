// instrumentation.ts
// Next.js 服务启动钩子 - 恢复评估状态和触发队列调度

import { restoreLocksFromDatabase } from './src/lib/evaluation-lock';
import { processQueue } from './src/services/evaluation-queue';
import { recoverInterruptedEvaluations } from './src/services/evaluation-recovery';
import { prisma } from './src/lib/prisma';

const LOG_PREFIX = '[Instrumentation]';

/**
 * 服务启动时执行
 * 1. 恢复项目锁状态（从数据库读取活跃评估）
 * 2. 检查异常中断的评估（running但没有实际执行）
 * 3. 自动恢复被中断的评估（断点恢复）
 * 4. 触发队列调度（启动排队的评估）
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
      
      // Step 3: 自动恢复被中断的评估（断点恢复）
      console.log(`${LOG_PREFIX} 开始断点恢复检查...`);
      
      // 延迟触发断点恢复（不阻塞服务启动）
      // 服务启动后 10 秒再恢复，确保 API 路由和数据库连接已就绪
      setTimeout(async () => {
        console.log(`${LOG_PREFIX} ========== 开始断点恢复 ==========`);
        try {
          const recoveryResult = await recoverInterruptedEvaluations();
          console.log(`${LOG_PREFIX} ========== 断点恢复完成 ==========`);
          console.log(`${LOG_PREFIX} 恢复结果: 恢复=${recoveryResult.recovered}, 失败=${recoveryResult.failed}, 跳过=${recoveryResult.skipped}`);
          
          if (recoveryResult.details.length > 0) {
            recoveryResult.details.forEach((detail, index) => {
              console.log(`  ${index + 1}. ${detail.evaluationId} - 从节点 ${detail.nextNodeToExecute + 1} 恢复 (${detail.recoveryReason})`);
            });
          }
        } catch (err) {
          console.error(`${LOG_PREFIX} 断点恢复失败:`, err);
        }
      }, 10000);
      
      // Step 4: 检查排队评估并触发调度
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
        
        // 延迟触发队列调度（不阻塞服务启动）
        // 服务启动后 15 秒再调度，确保断点恢复已完成
        console.log(`${LOG_PREFIX} 将在 15 秒后触发队列调度（不阻塞启动）...`);
        setTimeout(() => {
          console.log(`${LOG_PREFIX} ========== 开始队列调度 ==========`);
          processQueue()
            .then(() => console.log(`${LOG_PREFIX} ========== 队列调度完成 ==========`))
            .catch((err) => console.error(`${LOG_PREFIX} 队列调度失败:`, err));
        }, 15000);
      }
      
      console.log(`${LOG_PREFIX} 评估状态恢复完成，服务继续启动...`);
      
    } catch (error) {
      console.error(`${LOG_PREFIX} 评估状态恢复失败:`, error);
    }
  }
}