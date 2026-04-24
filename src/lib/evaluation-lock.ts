// src/lib/evaluation-lock.ts
// 全局评估锁管理 - 使用 Map 存储正在评估的项目

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
 * @returns true 表示成功锁定，false 表示项目已被锁定
 */
export async function lockProject(projectId: string, evaluationId: string): Promise<boolean> {
  // 检查是否已被锁定
  if (projectLockMap.has(projectId)) {
    return false;
  }
  
  // 锁定项目
  projectLockMap.set(projectId, {
    evaluationId,
    startedAt: new Date(),
  });
  
  console.log(`[EvaluationLock] 项目已锁定: ${projectId} -> ${evaluationId}`);
  return true;
}

/**
 * 解锁项目（评估结束时调用）
 * @param projectId 项目 ID
 */
export async function unlockProject(projectId: string): Promise<void> {
  if (projectLockMap.has(projectId)) {
    projectLockMap.delete(projectId);
    console.log(`[EvaluationLock] 项目已解锁: ${projectId}`);
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
  console.log(`[EvaluationLock] 所有锁定已清理`);
}

/**
 * 恢复锁定状态（程序重启时调用）
 * 从数据库读取所有活跃评估，写回 Map
 * @param prismaClient Prisma 客户端实例
 */
export async function restoreLocksFromDatabase(prismaClient: any): Promise<void> {
  try {
    // 查询所有活跃评估（preparing, running, queued）
    const activeEvaluations = await prismaClient.evaluationSession.findMany({
      where: {
        status: { in: ['preparing', 'running', 'queued'] }
      },
      select: {
        id: true,
        projectId: true,
        startedAt: true,
      },
    });
    
    // 写回 Map
    for (const session of activeEvaluations) {
      projectLockMap.set(session.projectId, {
        evaluationId: session.id,
        startedAt: session.startedAt || new Date(),
      });
    }
    
    console.log(`[EvaluationLock] 已从数据库恢复 ${activeEvaluations.length} 个锁定`);
  } catch (error) {
    console.error('[EvaluationLock] 恢复锁定状态失败:', error);
  }
}