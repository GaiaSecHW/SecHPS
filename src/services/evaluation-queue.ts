// src/services/evaluation-queue.ts
// 评估队列处理服务 - 管理并发限制和排队评估

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import {
  emitQueueStatusChange,
  emitQueueProcessing,
  emitEvaluationDequeued,
  emitQueueError,
} from '@/lib/event-bus';
import { unlockProject } from '@/lib/evaluation-lock';
import { startQueuedEvaluation } from '@/services/start-evaluation';

const LOG_PREFIX = '[EvaluationQueue]';

/**
 * 获取当前活跃的评估数量（包括 preparing 和 running）
 */
export async function getRunningCount(): Promise<number> {
  return await prisma.evaluationSession.count({
    where: { status: { in: ['preparing', 'running'] } },
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
 * 
 * 改进：循环启动所有可启动的排队评估，直到名额用完
 */
export async function processQueue(): Promise<void> {
  console.log(`\n${LOG_PREFIX} ========== 开始处理队列 ==========`);
  logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 开始处理队列...`);
  
  try {
    const maxConcurrent = await getMaxConcurrent();
    console.log(`${LOG_PREFIX} 最大并发限制: ${maxConcurrent}`);
    
    // 循环启动所有可启动的排队评估
    let startedCount = 0;
    
    while (startedCount < maxConcurrent) {
      const activeCount = await getRunningCount();
      const queuedCount = await getQueuedCount();
      
      console.log(`${LOG_PREFIX} 循环检查 #${startedCount + 1}: activeCount=${activeCount}, queuedCount=${queuedCount}, maxConcurrent=${maxConcurrent}`);
      logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 当前状态`, {
        activeCount,
        queuedCount,
        maxConcurrent,
        startedCount,
      });
      
      // 发送队列处理事件
      emitQueueStatusChange({
        activeCount,
        queuedCount,
        maxConcurrent,
        trigger: 'processing',
      });
      
      // 如果没有空闲名额或没有排队评估，退出循环
      if (activeCount >= maxConcurrent || queuedCount === 0) {
        console.log(`${LOG_PREFIX} 退出循环条件: activeCount(${activeCount}) >= maxConcurrent(${maxConcurrent}) ? ${activeCount >= maxConcurrent} : queuedCount(${queuedCount}) === 0 ? ${queuedCount === 0}`);
        if (activeCount >= maxConcurrent) {
          console.log(`${LOG_PREFIX} 无空闲名额，退出循环`);
          logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 无空闲名额`, {
            activeCount,
            maxConcurrent,
          });
        }
        if (queuedCount === 0) {
          console.log(`${LOG_PREFIX} 没有排队评估，退出循环`);
          logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 没有排队评估`);
        }
        break;
      }
      
      // 获取最早的排队评估
      console.log(`${LOG_PREFIX} 查询最早的排队评估...`);
      // 使用 select 而非 include 避免 Prisma findMany bug
      const queuedEvaluation = await prisma.evaluationSession.findFirst({
        where: { status: 'queued' },
        orderBy: { startedAt: 'asc' },
        select: {
          id: true,
          projectId: true,
          startedAt: true,
          status: true,
        },
      });
      
      if (!queuedEvaluation) {
        console.log(`${LOG_PREFIX} 查询返回空，退出循环`);
        logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 没有排队评估`);
        break;
      }

      // 单独查询项目名称
      const project = await prisma.project.findUnique({
        where: { id: queuedEvaluation.projectId },
        select: { id: true, name: true, projectPath: true },
      });
      const projectName = project?.name || '未知项目';
      console.log(`${LOG_PREFIX} 发现排队评估: ID=${queuedEvaluation.id}, 项目=${projectName}, projectId=${queuedEvaluation.projectId}`);
      logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 发现排队评估`, {
        evaluationId: queuedEvaluation.id,
        projectName,
      });
      
      // 发送队列处理事件（包含下一个要启动的评估）
      emitQueueProcessing({
        activeCount,
        maxConcurrent,
        nextEvaluation: {
          id: queuedEvaluation.id,
          projectName,
        },
      });
      
      // 触发排队评估的启动 - 直接调用服务函数（不走 HTTP）
      try {
        console.log(`${LOG_PREFIX} 直接调用 startQueuedEvaluation 服务函数...`);
        
        const result = await startQueuedEvaluation(queuedEvaluation.id);
        
        console.log(`${LOG_PREFIX} startQueuedEvaluation 结果: success=${result.success}, error=${result.error || '无'}`);
        
        if (result.success) {
          startedCount++;
          console.log(`${LOG_PREFIX} ✓ 排队评估启动成功! startedCount=${startedCount}`);
          
          // 计算等待时间
          const waitTime = Math.round((Date.now() - queuedEvaluation.startedAt.getTime()) / 1000);
          
          logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 排队评估已启动`, {
            evaluationId: queuedEvaluation.id,
            waitTimeSeconds: waitTime,
            startedCount,
          });
          
          // 发送出队事件
          emitEvaluationDequeued({
            evaluationId: queuedEvaluation.id,
            projectId: queuedEvaluation.projectId,
            projectName,
            waitTime,
          });
          
          // 发送队列状态变化事件
          const newActiveCount = await getRunningCount();
          const newQueuedCount = await getQueuedCount();
          emitQueueStatusChange({
            activeCount: newActiveCount,
            queuedCount: newQueuedCount,
            maxConcurrent,
            trigger: 'dequeue',
            evaluationId: queuedEvaluation.id,
            projectName,
          });
        } else {
          // 启动失败
          const errorMessage = result.error || '启动失败';
          
          logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 启动排队评估失败`, {
            evaluationId: queuedEvaluation.id,
            error: errorMessage,
          });
          
          // 发送队列错误事件
          emitQueueError({
            evaluationId: queuedEvaluation.id,
            projectName,
            error: errorMessage,
            errorDetails: errorMessage,
          });
          
          // 发送队列状态变化事件（失败）
          emitQueueStatusChange({
            activeCount: await getRunningCount(),
            queuedCount: await getQueuedCount(),
            maxConcurrent,
            trigger: 'fail',
            evaluationId: queuedEvaluation.id,
            projectName,
          });
          
          // 失败后继续尝试下一个排队评估（不中断循环）
          logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 继续尝试下一个排队评估`);
        }
      } catch (startError) {
        const errorMessage = startError instanceof Error ? startError.message : String(startError);
        const errorStack = startError instanceof Error ? startError.stack : '';
        
        logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 启动排队评估异常`, {
          evaluationId: queuedEvaluation.id,
          error: errorMessage,
          stack: errorStack,
        });
        
        // 发送队列错误事件
        emitQueueError({
          evaluationId: queuedEvaluation.id,
          projectName,
          error: errorMessage,
          errorDetails: errorStack || '无堆栈信息',
        });
        
        // 标记为失败
        await prisma.evaluationSession.update({
          where: { id: queuedEvaluation.id },
          data: {
            status: 'failed',
            errorMessage: `队列启动异常: ${errorMessage}`,
            endReason: 'queue_start_exception',
            endMessage: `调度队列启动异常详情:\n错误: ${errorMessage}\n堆栈: ${errorStack || '无'}\n时间: ${new Date().toISOString()}`,
            completedAt: new Date(),
          },
        });
        
        // 释放项目锁
        await unlockProject(queuedEvaluation.projectId);
        
        // 异常后继续尝试下一个排队评估
        logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 继续尝试下一个排队评估`);
      }
    }
    
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 队列处理完成`, {
      startedCount,
      maxConcurrent,
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 处理队列异常`, { error: errorMessage });
  }
}

/**
 * 获取队列状态信息（供前端显示）
 */
export async function getQueueStatus(): Promise<{
  activeCount: number;
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
  const activeCount = await getRunningCount();
  const queuedCount = await getQueuedCount();
  const maxConcurrent = await getMaxConcurrent();
  
  // 使用 select 而非 include 避免 Prisma findMany bug
  const queuedEvaluations = await prisma.evaluationSession.findMany({
    where: { status: 'queued' },
    orderBy: { startedAt: 'asc' },
    take: 50,
    select: {
      id: true,
      projectId: true,
      startedAt: true,
    },
  });

  // 单独查询项目名称
  const qProjectIds = [...new Set(queuedEvaluations.map(e => e.projectId))];
  const qProjects = qProjectIds.length > 0
    ? await prisma.project.findMany({ where: { id: { in: qProjectIds } }, select: { id: true, name: true } })
    : [];
  const qProjectMap = new Map(qProjects.map(p => [p.id, p]));

  // 计算队列位置
  const queueList = queuedEvaluations.map((evaluation, index) => ({
    id: evaluation.id,
    projectId: evaluation.projectId,
    projectName: qProjectMap.get(evaluation.projectId)?.name || '未知项目',
    createdAt: evaluation.startedAt,
    queuePosition: index + 1,
  }));
  
  return {
    activeCount,
    queuedCount,
    maxConcurrent,
    queuedEvaluations: queueList,
  };
}