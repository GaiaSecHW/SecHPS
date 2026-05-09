/**
 * Skill 版本创建服务
 * 基于改进建议创建 Skill 新版本，调用现有的版本管理逻辑，记录到 SkillEvolution 表
 */

import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import { saveSkillToDisk } from '@/services/skill-files';
import { getSkillOutputTemplate } from '@/lib/skill-template';
import { getImprovementDetail } from './improvement-generator';
import type { Skill } from '@prisma/client';

// ============================================================================
// Types
// ============================================================================

/**
 * 应用改进结果
 */
export interface ApplyImprovementResult {
  newSkillId: string;
  newVersion: number;
  oldVersion: number;
  evolutionId: string;
}

/**
 * 拒绝改进结果
 */
export interface RejectImprovementResult {
  improvementId: string;
  reason: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 构建 SkillEvolution 的 beforeData 和 afterData
 */
function buildEvolutionData(skill: Skill, newSkill: Skill): {
  beforeData: string;
  afterData: string;
} {
  const beforeData = {
    displayName: skill.displayName,
    description: skill.description,
    content: skill.content,
  };

  const afterData = {
    displayName: newSkill.displayName,
    description: newSkill.description,
    content: newSkill.content,
  };

  return {
    beforeData: JSON.stringify(beforeData),
    afterData: JSON.stringify(afterData),
  };
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * 应用改进建议，创建新的 Skill 版本
 *
 * @param improvementId - SkillImprovement 记录 ID
 * @param userId - 执行操作的用户 ID
 * @param reason - 应用原因（可选，默认使用改进描述）
 * @returns 应用结果，包含新 Skill ID 和版本信息
 */
export async function applyImprovement(
  improvementId: string,
  userId: string,
  reason?: string
): Promise<ApplyImprovementResult> {
  console.log(`[VersionCreator] 开始应用改进: improvementId=${improvementId}, userId=${userId}`);

  // 1. 获取改进详情
  const improvementDetail = await getImprovementDetail(improvementId);
  if (!improvementDetail) {
    throw new Error(`改进记录不存在: ${improvementId}`);
  }

  if (improvementDetail.status !== 'pending') {
    throw new Error(`改进记录状态不正确: ${improvementDetail.status}，期望 'pending'`);
  }

  // 2. 获取原始 Skill
  const originalSkill = await prisma.skill.findUnique({
    where: { id: improvementDetail.skillId },
  });

  if (!originalSkill) {
    throw new Error(`原始 Skill 不存在: ${improvementDetail.skillId}`);
  }

  if (!originalSkill.isLatest) {
    throw new Error(`原始 Skill 不是最新版本: ${improvementDetail.skillId}`);
  }

  // 3. 构建变更描述
  const changeDesc = improvementDetail.analysis.recommendations
    .map((r) => r.description)
    .join('; ') || 'Skill evolution based on false positive analysis';

  const finalReason = reason || 'Skill evolution based on false positive analysis';

  // 4. 将当前版本标记为非最新
  await prisma.skill.update({
    where: { id: originalSkill.id },
    data: { isLatest: false },
  });

  console.log(`[VersionCreator] 已将原版本标记为非最新: ${originalSkill.id}`);

  // 5. 创建新版本 Skill
  const newSkillId = generateId('skill');
  const newVersion = originalSkill.version + 1;

  const newSkill = await prisma.skill.create({
    data: {
      id: newSkillId,
      userId: originalSkill.userId,
      name: originalSkill.name,
      displayName: originalSkill.displayName,
      description: originalSkill.description,
      severity: originalSkill.severity,
      content: improvementDetail.improvedContent, // 使用改进后的内容
      cwe: originalSkill.cwe,
      isActive: originalSkill.isActive,
      isBuiltin: originalSkill.isBuiltin,
      isPublic: originalSkill.isPublic,
      version: newVersion,
      parentId: originalSkill.id,
      isLatest: true,
      successRate: originalSkill.successRate,
      avgDuration: originalSkill.avgDuration,
      execCount: originalSkill.execCount,
      referenceCount: originalSkill.referenceCount,
      vulnerabilityCount: originalSkill.vulnerabilityCount,
      successExecCount: originalSkill.successExecCount,
      categoryId: originalSkill.categoryId,
      vulnerabilityTreeId: originalSkill.vulnerabilityTreeId,
      updatedAt: new Date(),
    },
  });

  console.log(`[VersionCreator] 已创建新版本 Skill: ${newSkillId}, version=${newVersion}`);

  // 6. 记录进化历史
  const evolutionId = generateId('evol');
  const { beforeData, afterData } = buildEvolutionData(originalSkill, newSkill);

  await prisma.skillEvolution.create({
    data: {
      id: evolutionId,
      skillId: newSkill.id,
      fromVersion: originalSkill.version,
      toVersion: newSkill.version,
      changeType: 'evolution',
      changeDesc,
      beforeData,
      afterData,
      reason: finalReason,
      beforeRate: originalSkill.successRate,
      afterRate: newSkill.successRate,
    },
  });

  console.log(`[VersionCreator] 已记录进化历史: ${evolutionId}`);

  // 7. 更新 SkillImprovement 状态
  await prisma.skillImprovement.update({
    where: { id: improvementId },
    data: { status: 'applied' },
  });

  console.log(`[VersionCreator] 已更新改进记录状态为 'applied'`);

  // 8. 更新 SkillEvolutionTask（如果存在）
  const improvement = await prisma.skillImprovement.findUnique({
    where: { id: improvementId },
    select: { taskId: true },
  });

  if (improvement?.taskId) {
    await prisma.skillEvolutionTask.update({
      where: { id: improvement.taskId },
      data: {
        newVersionId: newSkillId,
        status: 'completed',
        completedAt: new Date(),
      },
    });

    console.log(`[VersionCreator] 已更新进化任务: taskId=${improvement.taskId}`);
  }

  // 9. 保存到磁盘
  try {
    const template = await getSkillOutputTemplate();
    await saveSkillToDisk(newSkill, template);
    console.log(`[VersionCreator] 已保存新版本到磁盘: ${newSkill.name} v${newVersion}`);
  } catch (err) {
    console.error(`[VersionCreator] 保存到磁盘失败: ${newSkill.id}`, err);
    // 不抛出错误，磁盘保存失败不影响数据库操作
  }

  return {
    newSkillId,
    newVersion,
    oldVersion: originalSkill.version,
    evolutionId,
  };
}

/**
 * 拒绝改进建议
 *
 * @param improvementId - SkillImprovement 记录 ID
 * @param userId - 执行操作的用户 ID
 * @param reason - 拒绝原因（必填）
 * @returns 拒绝结果
 */
export async function rejectImprovement(
  improvementId: string,
  userId: string,
  reason: string
): Promise<RejectImprovementResult> {
  console.log(`[VersionCreator] 开始拒绝改进: improvementId=${improvementId}, userId=${userId}, reason=${reason}`);

  if (!reason || reason.trim() === '') {
    throw new Error('拒绝原因不能为空');
  }

  // 1. 获取改进记录
  const improvement = await prisma.skillImprovement.findUnique({
    where: { id: improvementId },
    select: {
      id: true,
      status: true,
      taskId: true,
    },
  });

  if (!improvement) {
    throw new Error(`改进记录不存在: ${improvementId}`);
  }

  if (improvement.status !== 'pending') {
    throw new Error(`改进记录状态不正确: ${improvement.status}，期望 'pending'`);
  }

  // 2. 更新 SkillImprovement 状态
  await prisma.skillImprovement.update({
    where: { id: improvementId },
    data: { status: 'rejected' },
  });

  console.log(`[VersionCreator] 已更新改进记录状态为 'rejected'`);

  // 3. 更新 SkillEvolutionTask（如果存在）
  if (improvement.taskId) {
    await prisma.skillEvolutionTask.update({
      where: { id: improvement.taskId },
      data: {
        status: 'rejected',
        completedAt: new Date(),
      },
    });

    console.log(`[VersionCreator] 已更新进化任务状态为 'rejected': taskId=${improvement.taskId}`);
  }

  return {
    improvementId,
    reason,
  };
}

/**
 * 批量应用改进建议
 *
 * @param improvementIds - SkillImprovement 记录 ID 数组
 * @param userId - 执行操作的用户 ID
 * @param reason - 应用原因（可选）
 * @returns 应用结果列表
 */
export async function applyImprovementsBatch(
  improvementIds: string[],
  userId: string,
  reason?: string
): Promise<Array<ApplyImprovementResult | { improvementId: string; error: string }>> {
  console.log(`[VersionCreator] 开始批量应用改进: count=${improvementIds.length}`);

  const results: Array<ApplyImprovementResult | { improvementId: string; error: string }> = [];

  for (const improvementId of improvementIds) {
    try {
      const result = await applyImprovement(improvementId, userId, reason);
      results.push(result);
    } catch (error) {
      console.error(`[VersionCreator] 应用改进失败: ${improvementId}`, error);
      results.push({
        improvementId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const successCount = results.filter((r) => 'newSkillId' in r).length;
  const failCount = results.filter((r) => 'error' in r).length;

  console.log(`[VersionCreator] 批量应用完成: 成功=${successCount}, 失败=${failCount}`);

  return results;
}

/**
 * 批量拒绝改进建议
 *
 * @param improvementIds - SkillImprovement 记录 ID 数组
 * @param userId - 执行操作的用户 ID
 * @param reason - 拒绝原因（必填）
 * @returns 拒绝结果列表
 */
export async function rejectImprovementsBatch(
  improvementIds: string[],
  userId: string,
  reason: string
): Promise<Array<RejectImprovementResult | { improvementId: string; error: string }>> {
  console.log(`[VersionCreator] 开始批量拒绝改进: count=${improvementIds.length}`);

  if (!reason || reason.trim() === '') {
    throw new Error('拒绝原因不能为空');
  }

  const results: Array<RejectImprovementResult | { improvementId: string; error: string }> = [];

  for (const improvementId of improvementIds) {
    try {
      const result = await rejectImprovement(improvementId, userId, reason);
      results.push(result);
    } catch (error) {
      console.error(`[VersionCreator] 拒绝改进失败: ${improvementId}`, error);
      results.push({
        improvementId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const successCount = results.filter((r) => 'reason' in r).length;
  const failCount = results.filter((r) => 'error' in r).length;

  console.log(`[VersionCreator] 批量拒绝完成: 成功=${successCount}, 失败=${failCount}`);

  return results;
}

// ============================================================================
// Export
// ============================================================================

export default {
  applyImprovement,
  rejectImprovement,
  applyImprovementsBatch,
  rejectImprovementsBatch,
};