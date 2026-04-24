// src/services/evaluation-completion.ts
// 评估完成统一处理服务 - 所有编排类型的结束入口
//
// 功能：
// 1. 更新 EvaluationSession 状态为 completed/failed
// 2. 解析 vulnerabilities.json 并入库
// 3. 触发队列处理
//

import { prisma } from '@/lib/prisma';
import { parseAndSaveVulnerabilities } from '@/lib/vulnerability/parser';
import { logger, LOG_MODULES } from '@/lib/logger';

const LOG_PREFIX = '[EvaluationCompletion]';

/**
 * 评估完成数据
 */
export interface EvaluationCompletionData {
  evaluationId: string;
  projectId: string;
  projectPath: string;
  status: 'completed' | 'failed' | 'cancelled';
  summary?: string;
  errorMessage?: string;
  endReason?: string;
  endMessage?: string;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

/**
 * 完成评估会话（统一入口）
 * 
 * 所有编排类型（FSM、DAG、Ralph）结束时都应调用此函数
 * 
 * @param data - 评估完成数据
 * @returns Promise<{ success: boolean; vulnSaved: number; error?: string }>
 */
export async function completeEvaluation(
  data: EvaluationCompletionData
): Promise<{ success: boolean; vulnSaved: number; error?: string }> {
  const { evaluationId, projectId, projectPath, status, summary, errorMessage, endReason, endMessage, totalInputTokens, totalOutputTokens } = data;
  
  logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 开始处理评估完成`, {
    evaluationId,
    projectId,
    status,
    projectPath,
  });

  let vulnSaved = 0;
  let vulnError: string | undefined;

  // 1. 更新 EvaluationSession 状态
  try {
    await prisma.evaluationSession.update({
      where: { id: evaluationId },
      data: {
        status,
        completedAt: new Date(),
        summary,
        errorMessage,
        endReason,
        endMessage,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: (totalInputTokens || 0) + (totalOutputTokens || 0),
      },
    });
    
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 状态已更新: ${status}`);
  } catch (dbError) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 更新状态失败`, { error: dbError });
    return { success: false, vulnSaved: 0, error: `更新状态失败: ${dbError}` };
  }

  // 2. 如果评估成功完成，解析并入库漏洞
  if (status === 'completed') {
    const vulnerabilitiesPath = `${projectPath}/vulnerabilities.json`;
    
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 检查漏洞文件`, { path: vulnerabilitiesPath });
    
    try {
      const result = await parseAndSaveVulnerabilities(
        vulnerabilitiesPath,
        projectId,
        evaluationId
      );
      
      vulnSaved = result.saved;
      
      logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 漏洞入库完成`, {
        saved: result.saved,
        skipped: result.skipped,
        errors: result.errors.length,
      });
      
      if (result.errors.length > 0) {
        logger.warn(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 漏洞入库错误`, { errors: result.errors });
      }
    } catch (vulnError) {
      // vulnerabilities.json 不存在或解析失败 - 不阻塞流程
      const errorMsg = vulnError instanceof Error ? vulnError.message : String(vulnError);
      vulnError = errorMsg;
      logger.warn(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 漏洞入库跳过`, { error: errorMsg });
    }
  }

  // 3. 触发队列处理（启动下一个排队评估）
  try {
    const { processQueue } = await import('./evaluation-queue');
    processQueue().catch(err => 
      logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 处理队列失败`, { error: err })
    );
  } catch (queueError) {
    logger.warn(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 队列处理跳过`, { error: queueError });
  }

  logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估完成处理结束`, {
    evaluationId,
    status,
    vulnSaved,
  });

  return { success: true, vulnSaved, error: vulnError };
}

/**
 * 快捷方法：完成评估（成功）
 */
export async function completeEvaluationSuccess(
  evaluationId: string,
  projectId: string,
  projectPath: string,
  summary?: string,
  tokens?: { input: number; output: number }
): Promise<{ success: boolean; vulnSaved: number; error?: string }> {
  return completeEvaluation({
    evaluationId,
    projectId,
    projectPath,
    status: 'completed',
    summary,
    totalInputTokens: tokens?.input,
    totalOutputTokens: tokens?.output,
  });
}

/**
 * 快捷方法：完成评估（失败）
 */
export async function completeEvaluationFailed(
  evaluationId: string,
  projectId: string,
  projectPath: string,
  errorMessage: string,
  endReason?: string,
  endMessage?: string
): Promise<{ success: boolean; vulnSaved: number; error?: string }> {
  return completeEvaluation({
    evaluationId,
    projectId,
    projectPath,
    status: 'failed',
    errorMessage,
    endReason: endReason || 'error',
    endMessage,  // 传递详细的结束消息（包含失败节点详情）
  });
}