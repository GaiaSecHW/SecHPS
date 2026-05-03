// src/services/evaluation-completion.ts
// 评估完成统一处理服务 - 所有编排类型的结束入口
//
// 功能：
// 1. 更新 EvaluationSession 状态为 completed/failed
// 2. 解析 vulnerabilities.json 并入库
// 3. 触发队列处理
//

import { prisma } from '@/lib/prisma';
import { parseAndSaveVulnerabilitiesFromDir, aggregateVulnerabilitiesFromOutputs } from '@/lib/vulnerability/parser';
import { logger, LOG_MODULES } from '@/lib/logger';
import { unlockProject } from '@/lib/evaluation-lock';
import { updateSkillExecutionFindingsFromVulnerabilities, completeAllPendingSkillExecutions } from '@/services/skill-execution-tracker';
import { regeneratePenTestReport } from '@/lib/reports/fsm-report-generator';

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

  // 2. 如果评估成功完成，从 vulnerabilities/ 目录读取漏洞文件入库
  if (status === 'completed') {
    const vulnDirPath = `${projectPath}/vulnerabilities`;
    
    // 2.1 从 vulnerabilities/ 目录逐个读取 {skill名称}-{UUID}.json
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 从 vulnerabilities/ 目录读取漏洞文件`, { path: vulnDirPath });
    
    try {
      const result = await parseAndSaveVulnerabilitiesFromDir(
        vulnDirPath,
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
      
      // 漏洞入库后，更新 Skill 执行记录的 findingsCount
      if (result.saved > 0) {
        try {
          const skillUpdateResult = await updateSkillExecutionFindingsFromVulnerabilities({
            evaluationId,
          });
          logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} Skill findingsCount 已更新`, {
            updatedSkills: skillUpdateResult.updated,
            totalVulns: skillUpdateResult.totalVulns,
          });
        } catch (skillUpdateError) {
          logger.warn(LOG_MODULES.EVALUATION, `${LOG_PREFIX} Skill findingsCount 更新失败`, { error: skillUpdateError });
        }
      }
    } catch (vulnError) {
      const errorMsg = vulnError instanceof Error ? vulnError.message : String(vulnError);
      vulnError = errorMsg;
      logger.warn(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 漏洞入库跳过`, { error: errorMsg });
    }
    
    // 清理未完成的 Skill 执行记录
    try {
      const cleanedCount = await completeAllPendingSkillExecutions({
        evaluationId,
        status: 'completed',
        reason: '评估正常结束',
      });
      if (cleanedCount > 0) {
        logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 清理了 ${cleanedCount} 个未完成的 Skill 执行记录`);
      }
    } catch (cleanupError) {
      logger.warn(LOG_MODULES.EVALUATION, `${LOG_PREFIX} Skill 执行记录清理失败`, { error: cleanupError });
    }
    
    // 重新生成渗透测试报告（包含实际漏洞数据）
    try {
      await regeneratePenTestReport(evaluationId, projectPath);
      logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 渗透测试报告已重新生成`);
    } catch (reportError) {
      logger.warn(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 渗透测试报告重新生成失败`, { error: reportError });
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

  // 4. 解锁项目（从全局 Map 中移除）
  try {
    await unlockProject(projectId);
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 项目已解锁`, { projectId });
  } catch (unlockError) {
    logger.warn(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 解锁项目失败`, { error: unlockError });
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