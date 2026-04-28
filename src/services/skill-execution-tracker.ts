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
  
  const status = params.error ? 'failed' : 'completed';
  
  // 更新执行记录
  await prisma.skillExecution.update({
    where: { id: params.executionId },
    data: {
      status,
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

  // 更新 Skill 的统计
  if (status === 'completed') {
    // 获取当前 Skill 统计
    const skill = await prisma.skill.findUnique({
      where: { id: params.skillId },
      select: { execCount: true, successExecCount: true },
    });
    
    const newSuccessExecCount = (skill?.successExecCount || 0) + 1;
    const newExecCount = skill?.execCount || 0;
    const successRate = newExecCount > 0 ? newSuccessExecCount / newExecCount : null;
    
    await prisma.skill.update({
      where: { id: params.skillId },
      data: {
        successExecCount: newSuccessExecCount,
        successRate,
        vulnerabilityCount: { increment: params.findingsCount || 0 },
        updatedAt: new Date(),
      },
    });
  }

  console.log(`[SkillExecution] 完成执行记录: execution=${params.executionId}, status=${status}, findings=${params.findingsCount || 0}, duration=${duration}ms`);
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
 * 为单个节点批量创建 Skill 执行记录（pending 状态）
 * 用于评估启动时为每个节点的每个 skill 创建 SkillExecution 记录
 * 
 * @param evaluationId 评估会话 ID
 * @param nodeId 节点 ID
 * @param skills Skill.id 数组
 * @param projectId 项目 ID
 * @returns 创建的执行记录 ID 数组
 * @throws 如果批量创建失败则抛出异常
 */
export async function createSkillExecutionsForNode(params: {
  evaluationId: string;
  nodeId: string;
  skills: string[];
  projectId: string;
}): Promise<string[]> {
  const { evaluationId, nodeId, skills, projectId } = params;
  
  if (!skills || skills.length === 0) {
    console.log(`[SkillExecution] 节点 ${nodeId} 没有 skills，跳过创建`);
    return [];
  }

  const executionIds: string[] = [];

  try {
    // 使用 $transaction 批量创建，确保原子性
    await prisma.$transaction(
      skills.map((skillId, index) => {
        // ID 格式: sklexec-{evaluationId}-{nodeId}-{skillId}-{index}
        const executionId = `sklexec-${evaluationId}-${nodeId}-${skillId}-${index}`;
        executionIds.push(executionId);

        return prisma.skillExecution.create({
          data: {
            id: executionId,
            skillId,
            projectId,
            evaluationId,
            nodeId,  // 设置 nodeId 字段
            order: index,  // 调用次序
            input: JSON.stringify({ mode: 'node_execution', nodeId }),
            status: 'pending',  // 初始状态为 pending
          },
        });
      })
    );

    console.log(`[SkillExecution] 为节点 ${nodeId} 批量创建 ${executionIds.length} 个 pending 执行记录`);
    return executionIds;
  } catch (error) {
    console.error(`[SkillExecution] 为节点 ${nodeId} 批量创建执行记录失败`, error);
    // 批量创建失败则整个评估失败（抛出异常）
    throw new Error(`Failed to create SkillExecutions for node ${nodeId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 获取评估会话的 Skill 执行记录
 * 按 skillId 去重，只保留每个 skill 的最新记录
 */
export async function getSkillExecutionsByEvaluation(evaluationId: string) {
  // 获取所有执行记录，按 order 排序
  const allExecutions = await prisma.skillExecution.findMany({
    where: { evaluationId, nodeId: { not: null } },
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
    orderBy: { order: 'asc' },
  });
  
  return allExecutions;
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
  
  // 按 skillId 分组统计
  const skillCounts = new Map<string, number>();
  for (const exec of pendingExecutions) {
    const count = skillCounts.get(exec.skillId) || 0;
    skillCounts.set(exec.skillId, count + 1);
  }
  
  // 批量更新执行记录
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
  
  // 如果标记为 completed，更新 Skill 的 successExecCount 和 successRate
  if (status === 'completed') {
    for (const [skillId, count] of skillCounts.entries()) {
      const skill = await prisma.skill.findUnique({
        where: { id: skillId },
        select: { execCount: true, successExecCount: true },
      });
      
      const newSuccessExecCount = (skill?.successExecCount || 0) + count;
      const newExecCount = skill?.execCount || 0;
      const successRate = newExecCount > 0 ? newSuccessExecCount / newExecCount : null;
      
      await prisma.skill.update({
        where: { id: skillId },
        data: {
          successExecCount: newSuccessExecCount,
          successRate,
          updatedAt: new Date(),
        },
      });
    }
  }
  
  console.log(`[SkillExecution] 已将 ${pendingExecutions.length} 个未完成的执行记录标记为 ${status}`);
  return pendingExecutions.length;
}

/**
 * 根据实际入库的漏洞更新 Skill 执行记录的 findingsCount
 * 在漏洞入库后调用，统计每个 Skill 发现的漏洞数量
 */
export async function updateSkillExecutionFindingsFromVulnerabilities(params: {
  evaluationId: string;
}): Promise<{ updated: number; totalVulns: number }> {
  // 1. 查询本次评估的所有漏洞，按 skill 字段分组统计
  const vulnerabilities = await prisma.vulnerability.findMany({
    where: {
      evaluationId: params.evaluationId,
      vulnerable: true,  // 只统计真实漏洞
    },
    select: {
      id: true,
      skill: true,
      skillExecutionId: true,
    },
  });
  
  if (vulnerabilities.length === 0) {
    console.log(`[SkillExecution] 评估 ${params.evaluationId} 没有发现漏洞`);
    return { updated: 0, totalVulns: 0 };
  }
  
  // 2. 按 skill 名称分组统计
  const skillVulnCounts = new Map<string, number>();
  for (const vuln of vulnerabilities) {
    const skillName = vuln.skill || 'unknown';
    const count = skillVulnCounts.get(skillName) || 0;
    skillVulnCounts.set(skillName, count + 1);
  }
  
  console.log(`[SkillExecution] 漏洞统计: 总数=${vulnerabilities.length}, Skills=${skillVulnCounts.size}`);
  skillVulnCounts.forEach((count, skill) => {
    console.log(`  - ${skill}: ${count} 个漏洞`);
  });
  
  // 3. 查询本次评估的所有 SkillExecution 记录
  const skillExecutions = await prisma.skillExecution.findMany({
    where: {
      evaluationId: params.evaluationId,
    },
    include: {
      Skill: {
        select: { name: true },
      },
    },
  });
  
  // 4. 创建 skill name -> skillExecution 的映射
  const skillNameToExecution = new Map<string, { id: string; skillId: string }>();
  for (const exec of skillExecutions) {
    const skillName = exec.Skill?.name || '';
    if (skillName) {
      skillNameToExecution.set(skillName, { id: exec.id, skillId: exec.skillId });
    }
  }
  
  // 5. 更新 SkillExecution 的 findingsCount，并更新漏洞的 skillExecutionId
  let updated = 0;
  
  for (const [skillName, vulnCount] of skillVulnCounts.entries()) {
    const executionInfo = skillNameToExecution.get(skillName);
    
    if (executionInfo) {
      // 更新 SkillExecution 的 findingsCount
      await prisma.skillExecution.update({
        where: { id: executionInfo.id },
        data: {
          findingsCount: vulnCount,
          confirmedCount: vulnCount,  // 默认全部确认
        },
      });
      
      // 更新该 Skill 发现的所有漏洞的 skillExecutionId
      await prisma.vulnerability.updateMany({
        where: {
          evaluationId: params.evaluationId,
          skill: skillName,
          vulnerable: true,
        },
        data: {
          skillExecutionId: executionInfo.id,
        },
      });
      
      // 更新 Skill 的 vulnerabilityCount
      await prisma.skill.update({
        where: { id: executionInfo.skillId },
        data: {
          vulnerabilityCount: { increment: vulnCount },
          updatedAt: new Date(),
        },
      });
      
      updated++;
      console.log(`[SkillExecution] 更新 Skill=${skillName}, findingsCount=${vulnCount}`);
    } else {
      console.warn(`[SkillExecution] 未找到 Skill=${skillName} 的执行记录`);
    }
  }
  
  console.log(`[SkillExecution] 完成: 更新了 ${updated} 个 Skill 执行记录，总漏洞数 ${vulnerabilities.length}`);
  return { updated, totalVulns: vulnerabilities.length };
}
