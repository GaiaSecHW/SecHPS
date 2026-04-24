// src/lib/evaluation-lock.ts
// 全局评估锁管理 - 使用 Map 存储正在评估的项目，配合互斥锁防止并发

/**
 * 全局 Map：存储正在评估的项目
 * key: projectId
 * value: { evaluationId: string, startedAt: Date }
 */
const projectLockMap = new Map<string, { evaluationId: string; startedAt: Date }>();

/**
 * 互斥锁：保证同一时间只有一个进程可以操作 Map
 * 使用 Promise 实现简单的互斥锁
 */
let lockPromise: Promise<void> | null = null;

/**
 * 获取锁（等待锁释放）
 */
async function acquireLock(): Promise<void> {
  while (lockPromise) {
    await lockPromise;
  }
  lockPromise = new Promise<void>((resolve) => {
    // 锁会在 releaseLock 时释放
    const release = () => {
      lockPromise = null;
      resolve();
    };
    // 存储释放函数，供 releaseLock 使用
    (lockPromise as any).release = release;
  });
}

/**
 * 释放锁
 */
function releaseLock(): void {
  if (lockPromise && (lockPromise as any).release) {
    (lockPromise as any).release();
  }
}

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
  await acquireLock();
  
  try {
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
  } finally {
    releaseLock();
  }
}

/**
 * 解锁项目（评估结束时调用）
 * @param projectId 项目 ID
 */
export async function unlockProject(projectId: string): Promise<void> {
  await acquireLock();
  
  try {
    if (projectLockMap.has(projectId)) {
      projectLockMap.delete(projectId);
      console.log(`[EvaluationLock] 项目已解锁: ${projectId}`);
    }
  } finally {
    releaseLock();
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
export async function clearAllLocks(): Promise<void> {
  await acquireLock();
  
  try {
    projectLockMap.clear();
    console.log(`[EvaluationLock] 所有锁定已清理`);
  } finally {
    releaseLock();
  }
}

/**
 * 恢复锁定状态（程序重启时调用）
 * 从数据库读取所有活跃评估，写回 Map
 * @param prisma Prisma 客户端实例
 */
export async function restoreLocksFromDatabase(prisma: any): Promise<void> {
  await acquireLock();
  
  try {
    // 查询所有活跃评估（preparing, running, queued）
    const activeEvaluations = await prisma.evaluationSession.findMany({
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
  } finally {
    releaseLock();
  }
}