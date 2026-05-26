// src/lib/evaluation-lock.ts
// 全局评估锁管理 - 使用 Map 存储正在评估的项目

import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 全局 Map：存储正在评估的项目
 * key: projectId
 * value: { evaluationId: string; startedAt: Date }
 */
const projectLockMap = new Map<string, { evaluationId: string; startedAt: Date }>();

/**
 * 检查项目是否正在评估
 * @param projectId 项目 ID
 * @returns 如果正在评估，返回 evaluationId；否则返回 null
 */
export function isProjectLocked(projectId: string): string | null {
  const lock = projectLockMap.get(projectId);
  return lock ? lock.evaluationId : null;
}

/**
 * 锁定项目（开始评估时调用）
 * @param projectId 项目 ID
 * @param evaluationId 评估 ID
 * @returns true 表示成功锁定，false 表示项目已被其他评估锁定
 */
export async function lockProject(projectId: string, evaluationId: string): Promise<boolean> {
  // 检查是否已被锁定
  const existingLock = projectLockMap.get(projectId);
  if (existingLock) {
    // 如果锁定属于当前评估（恢复场景），允许继续
    if (existingLock.evaluationId === evaluationId) {
      logger.info(LOG_MODULES.EVALUATION, `项目已被当前评估锁定: ${projectId} -> ${evaluationId}（恢复场景）`);
      return true;
    }
    logger.info(LOG_MODULES.EVALUATION, `项目已被其他评估锁定: ${projectId} -> ${existingLock.evaluationId}（当前: ${evaluationId}）`);
    return false;
  }
  
  // 锁定项目
  projectLockMap.set(projectId, {
    evaluationId,
    startedAt: new Date(),
  });
  
  logger.info(LOG_MODULES.EVALUATION, `项目已锁定: ${projectId} -> ${evaluationId}`);
  return true;
}

/**
 * 解锁项目（评估结束时调用）
 * @param projectId 项目 ID
 */
export async function unlockProject(projectId: string): Promise<void> {
  if (projectLockMap.has(projectId)) {
    projectLockMap.delete(projectId);
    logger.info(LOG_MODULES.EVALUATION, `项目已解锁: ${projectId}`);
  }
}

/**
 * 获取所有锁定的项目
 */
export function getAllLockedProjects(): Map<string, { evaluationId: string; startedAt: Date }> {
  return new Map(projectLockMap);
}

/**
 * 清理所有锁定（用于异常恢复）
 */
export function clearAllLocks(): void {
  projectLockMap.clear();
  logger.info(LOG_MODULES.EVALUATION, '所有锁定已清理');
}

/**
 * 恢复锁定状态（程序重启时调用）
 * 从数据库读取所有活跃评估，写回 Map
 * 注意：如果同一项目有多个活跃评估，只保留最新的一个，并记录警告
 * @param prismaClient Prisma 客户端实例
 */
export async function restoreLocksFromDatabase(prismaClient: any): Promise<void> {
  try {
    // 查询所有活跃评估（preparing, running, queued）
    const activeEvaluations = await prismaClient.evaluationSession.findMany({
      where: {
        status: { in: ['preparing', 'running', 'queued'] }
      },
      take: 50,
      select: {
        id: true,
        projectId: true,
        startedAt: true,
        status: true,
      },
      orderBy: {
        startedAt: 'desc',  // 按启动时间降序，确保同一项目时保留最新的
      },
    });
    
    // 检测同一项目的多评估情况
    const projectEvalCounts = new Map<string, number>();
    for (const session of activeEvaluations) {
      const count = projectEvalCounts.get(session.projectId) || 0;
      projectEvalCounts.set(session.projectId, count + 1);
    }
    
    // 记录警告：同一项目有多个活跃评估
    for (const [projectId, count] of projectEvalCounts.entries()) {
      if (count > 1) {
        logger.warn(LOG_MODULES.EVALUATION, `项目 ${projectId} 有 ${count} 个活跃评估，将只锁定最新的一个`);
      }
    }

    // 写回 Map（由于已按 startedAt 降序排序，后面的同项目评估会跳过）
    const addedProjects = new Set<string>();
    for (const session of activeEvaluations) {
      if (addedProjects.has(session.projectId)) {
        // 该项目已添加，跳过（避免覆盖）
        continue;
      }
      projectLockMap.set(session.projectId, {
        evaluationId: session.id,
        startedAt: session.startedAt || new Date(),
      });
      addedProjects.add(session.projectId);
    }

    logger.info(LOG_MODULES.EVALUATION, `已从数据库恢复 ${addedProjects.size} 个锁定（共 ${activeEvaluations.length} 个评估）`);
  } catch (error) {
    logger.error(LOG_MODULES.EVALUATION, '恢复锁定状态失败', { details: { error: error instanceof Error ? error.message : String(error) } });
  }
}