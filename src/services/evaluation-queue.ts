// src/services/evaluation-queue.ts
// 评估队列处理服务 - 管理并发限制和排队评估

import { prisma } from '@/lib/prisma';

const LOG_PREFIX = '[EvaluationQueue]';

/**
 * 获取当前运行中的评估数量
 */
export async function getRunningCount(): Promise<number> {
  return await prisma.evaluationSession.count({
    where: { status: 'running' },
  });
}

/**
 * 获取当前排队的评估数量
 */
export async function getQueuedCount(): Promise<number> {
  return await prisma.evaluationSession.count({
    where: { status: 'queued' },
  });
}

/**
 * 获取最大并发限制
 */
export async function getMaxConcurrent(): Promise<number> {
  const globalConfig = await prisma.opencodeConfig.findFirst({
    where: { isActive: true },
    select: { maxConcurrentEvaluations: true },
  });
  return globalConfig?.maxConcurrentEvaluations || 3;
}

/**
 * 检查队列并启动下一个排队评估
 * 在评估完成或失败时调用
 */
export async function processQueue(): Promise<void> {
  console.log(`${LOG_PREFIX} 开始处理队列...`);
  
  try {
    const runningCount = await getRunningCount();
    const maxConcurrent = await getMaxConcurrent();
    
    console.log(`${LOG_PREFIX} 当前运行: ${runningCount}, 最大并发: ${maxConcurrent}`);
    
    // 如果还有空闲名额
    if (runningCount < maxConcurrent) {
      // 获取最早的排队评估
      const queuedEvaluation = await prisma.evaluationSession.findFirst({
        where: { status: 'queued' },
        orderBy: { startedAt: 'asc' },
        include: {
          project: {
            select: { id: true, name: true, projectPath: true },
          },
        },
      });
      
      if (queuedEvaluation) {
        console.log(`${LOG_PREFIX} 发现排队评估: ${queuedEvaluation.id}, 项目: ${queuedEvaluation.project?.name}`);
        
        // 触发排队评估的启动
        // 通过内部 API 调用启动评估
        try {
          const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/evaluations/${queuedEvaluation.id}/start-queued`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // 内部调用使用密钥验证
              'X-Internal-Token': process.env.INTERNAL_API_SECRET || '',
            },
          });
          
          if (response.ok) {
            console.log(`${LOG_PREFIX} 排队评估 ${queuedEvaluation.id} 已启动`);
          } else {
            console.error(`${LOG_PREFIX} 启动排队评估失败: ${response.status}`);
            // 标记为失败
            await prisma.evaluationSession.update({
              where: { id: queuedEvaluation.id },
              data: {
                status: 'failed',
                errorMessage: '队列启动失败',
                completedAt: new Date(),
              },
            });
          }
        } catch (error) {
          console.error(`${LOG_PREFIX} 启动排队评估异常:`, error);
        }
      } else {
        console.log(`${LOG_PREFIX} 没有排队评估`);
      }
    } else {
      console.log(`${LOG_PREFIX} 无空闲名额，队列暂不处理`);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} 处理队列异常:`, error);
  }
}

/**
 * 获取队列状态信息（供前端显示）
 */
export async function getQueueStatus(): Promise<{
  runningCount: number;
  queuedCount: number;
  maxConcurrent: number;
  queuedEvaluations: Array<{
    id: string;
    projectId: string;
    projectName: string;
    createdAt: Date;
    queuePosition: number;
  }>;
}> {
  const runningCount = await getRunningCount();
  const queuedCount = await getQueuedCount();
  const maxConcurrent = await getMaxConcurrent();
  
  const queuedEvaluations = await prisma.evaluationSession.findMany({
    where: { status: 'queued' },
    orderBy: { startedAt: 'asc' },
    include: {
      project: {
        select: { id: true, name: true },
      },
    },
  });
  
  // 计算队列位置
  const queueList = queuedEvaluations.map((evaluation, index) => ({
    id: evaluation.id,
    projectId: evaluation.projectId,
    projectName: evaluation.project?.name || '未知项目',
    createdAt: evaluation.startedAt,
    queuePosition: index + 1,
  }));
  
  return {
    runningCount,
    queuedCount,
    maxConcurrent,
    queuedEvaluations: queueList,
  };
}