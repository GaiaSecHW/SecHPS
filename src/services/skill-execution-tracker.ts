// src/services/skill-execution-tracker.ts
/**
 * Skill 执行记录服务
 * 
 * 功能：
 * 1. 记录 Skill 的加载和执行情况
 * 2. 更新 Skill 的 execCount（执行次数）
 * 3. 更新 Skill 的 vulnerabilityCount（发现问题数）
 * 4. 关联到 EvaluationSession，方便后续查看
 */

import { prisma } from '@/lib/prisma';

/**
 * 创建 Skill 执行记录
 */
export async function createSkillExecution(params: {
  skillId: string;
  projectId: string;
  evaluationId: string;
  input?: string;
}): Promise<string> {
  const execution = await prisma.skillExecution.create({
    data: {
      id: `sklexec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      skillId: params.skillId,
      projectId: params.projectId,
      evaluationId: params.evaluationId,
      input: params.input || '{}',
      status: 'running',
      startedAt: new Date(),
    },
  });

  // 更新 Skill 的 execCount
  await prisma.skill.update({
    where: { id: params.skillId },
    data: {
      execCount: { increment: 1 },
      updatedAt: new Date(),
    },
  });

  console.log(`[SkillExecution] 创建执行记录: skill=${params.skillId}, execution=${execution.id}`);
  return execution.id;
}

/**
 * 更新 Skill 执行记录（完成）
 */
export async function completeSkillExecution(params: {
  executionId: string;
  skillId: string;
  output?: string;
  findingsCount?: number;
  confirmedCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}): Promise<void> {
  // 先获取原记录的 startedAt 时间
  const existing = await prisma.skillExecution.findUnique({
    where: { id: params.executionId },
    select: { startedAt: true },
  });
  
  const completedAt = new Date();
  const duration = existing?.startedAt 
    ? completedAt.getTime() - new Date(existing.startedAt).getTime()
    : 0;
  
  // 更新执行记录
  await prisma.skillExecution.update({
    where: { id: params.executionId },
    data: {
      status: params.error ? 'failed' : 'completed',
      output: params.output,
      findingsCount: params.findingsCount || 0,
      confirmedCount: params.confirmedCount || 0,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      error: params.error,
      completedAt,
      duration,
    },
  });

  // 更新 Skill 的 vulnerabilityCount
  if (params.findingsCount && params.findingsCount > 0) {
    await prisma.skill.update({
      where: { id: params.skillId },
      data: {
        vulnerabilityCount: { increment: params.findingsCount },
        updatedAt: new Date(),
      },
    });
  }

  console.log(`[SkillExecution] 完成执行记录: execution=${params.executionId}, findings=${params.findingsCount || 0}, duration=${duration}ms`);
}

/**
 * 批量创建 Skill 执行记录（pending 状态）
 * 用于评估开始时记录将要执行的 Skills
 */
export async function createSkillExecutionsForEvaluation(params: {
  skillIds: string[];
  projectId: string;
  evaluationId: string;
}): Promise<string[]> {
  const executionIds: string[] = [];

  for (const skillId of params.skillIds) {
    try {
      // 创建 pending 状态的执行记录，不增加 execCount
      const executionId = `sklexec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}-${skillId.substring(0, 8)}`;
      await prisma.skillExecution.create({
        data: {
          id: executionId,
          skillId,
          projectId: params.projectId,
          evaluationId: params.evaluationId,
          input: JSON.stringify({ mode: 'evaluation' }),
          status: 'pending',  // 初始状态为 pending
        },
      });
      executionIds.push(executionId);
    } catch (error) {
      console.error(`[SkillExecution] 创建执行记录失败: skill=${skillId}`, error);
    }
  }

  console.log(`[SkillExecution] 批量创建 ${executionIds.length} 个 pending 执行记录`);
  return executionIds;
}

/**
 * 获取评估会话的 Skill 执行记录
 * 按 skillId 去重，只保留每个 skill 的最新记录
 */
export async function getSkillExecutionsByEvaluation(evaluationId: string) {
  // 获取所有执行记录
  const allExecutions = await prisma.skillExecution.findMany({
    where: { evaluationId },
    include: {
      Skill: {
        select: {
          id: true,
          name: true,
          displayName: true,
          severity: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' }, // 按时间倒序，最新的在前
  });
  
  // 按 skillId 去重，只保留最新的记录
  const seenSkillIds = new Set<string>();
  const uniqueExecutions = allExecutions.filter(exec => {
    if (seenSkillIds.has(exec.skillId)) {
      return false; // 已存在，跳过
    }
    seenSkillIds.add(exec.skillId);
    return true;
  });
  
  // 按创建时间正序返回（保持原有顺序）
  return uniqueExecutions.reverse();
}

/**
 * 获取项目的 Skill 执行统计
 */
export async function getProjectSkillStats(projectId: string) {
  const executions = await prisma.skillExecution.findMany({
    where: { projectId },
    select: {
      skillId: true,
      findingsCount: true,
      status: true,
    },
  });

  const skillStats = new Map<string, {
    skillId: string;
    execCount: number;
    totalFindings: number;
    successCount: number;
    failedCount: number;
  }>();

  for (const exec of executions) {
    const existing = skillStats.get(exec.skillId) || {
      skillId: exec.skillId,
      execCount: 0,
      totalFindings: 0,
      successCount: 0,
      failedCount: 0,
    };

    existing.execCount++;
    existing.totalFindings += exec.findingsCount;
    if (exec.status === 'completed') existing.successCount++;
    if (exec.status === 'failed') existing.failedCount++;

    skillStats.set(exec.skillId, existing);
  }

  return Array.from(skillStats.values());
}

/**
 * 更新 Skill 执行记录的漏洞发现数
 * 用于评估完成后统计
 */
export async function updateSkillExecutionFindings(params: {
  evaluationId: string;
  skillFindings: Array<{
    skillId: string;
    findingsCount: number;
  }>;
}): Promise<void> {
  for (const { skillId, findingsCount } of params.skillFindings) {
    // 更新执行记录
    await prisma.skillExecution.updateMany({
      where: {
        evaluationId: params.evaluationId,
        skillId,
      },
      data: {
        findingsCount,
        confirmedCount: findingsCount, // 默认全部确认
      },
    });

    // 更新 Skill 的 vulnerabilityCount
    if (findingsCount > 0) {
      await prisma.skill.update({
        where: { id: skillId },
        data: {
          vulnerabilityCount: { increment: findingsCount },
          updatedAt: new Date(),
        },
      });
    }
  }

  console.log(`[SkillExecution] 更新 ${params.skillFindings.length} 个 Skill 的发现数`);
}

/**
 * 完成所有未完成的 Skill 执行记录
 * 用于评估结束时清理残留的 running/pending 状态
 */
export async function completeAllPendingSkillExecutions(params: {
  evaluationId: string;
  status?: 'completed' | 'failed' | 'cancelled';
  reason?: string;
}): Promise<number> {
  const status = params.status || 'completed';
  const reason = params.reason || '评估结束';
  
  // 查找所有未完成的执行记录
  const pendingExecutions = await prisma.skillExecution.findMany({
    where: {
      evaluationId: params.evaluationId,
      status: { in: ['pending', 'running'] },
    },
    select: { id: true, startedAt: true, skillId: true },
  });
  
  if (pendingExecutions.length === 0) {
    return 0;
  }
  
  const completedAt = new Date();
  
  // 批量更新
  for (const exec of pendingExecutions) {
    const duration = exec.startedAt 
      ? completedAt.getTime() - new Date(exec.startedAt).getTime()
      : 0;
    
    await prisma.skillExecution.update({
      where: { id: exec.id },
      data: {
        status,
        completedAt,
        duration,
        error: status !== 'completed' ? reason : undefined,
      },
    });
  }
  
  console.log(`[SkillExecution] 已将 ${pendingExecutions.length} 个未完成的执行记录标记为 ${status}`);
  return pendingExecutions.length;
}
