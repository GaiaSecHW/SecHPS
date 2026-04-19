// src/app/api/admin/skills-governance/duplicate-groups/[id]/route.ts
// Skills Governance - 重复组详情和审核 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/skills-governance/duplicate-groups/[id]
 * 获取重复组详情
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const { id } = await context.params;

    const group = await prisma.skillDuplicateGroup.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            skill: {
              select: {
                id: true,
                name: true,
                displayName: true,
                description: true,
                techStackId: true,
                vulnerabilityPatternId: true,
                content: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
                execCount: true,
                successRate: true,
              },
            },
          },
          orderBy: { similarityScore: 'desc' },
        },
      },
    });

    if (!group) {
      return NextResponse.json({ error: '重复组不存在' }, { status: 404 });
    }

    // 获取语言和漏洞类型信息
    const [techStack, vulnPattern] = await Promise.all([
      prisma.techStackOption.findUnique({
        where: { id: group.language },
        select: { id: true, name: true, displayName: true, category: true },
      }),
      prisma.vulnerabilityPattern.findUnique({
        where: { id: group.vulnerabilityType },
        select: { id: true, name: true, displayName: true, categoryId: true, cwe: true },
      }),
    ]);

    // 获取成员之间的分析结果
    const memberIds = group.members.map(m => m.skillId);
    const analyses = await prisma.skillAnalysis.findMany({
      where: {
        OR: memberIds.flatMap(id1 =>
          memberIds
            .filter(id2 => id2 !== id1)
            .map(id2 => ({
              skillId: id1,
              relatedSkillId: id2,
            }))
        ),
        analysisType: { in: ['duplication_check', 'full_analysis'] },
      },
      orderBy: { confidence: 'desc' },
    });

    // 组装响应
    const groupWithDetails = {
      ...group,
      languageInfo: techStack,
      vulnerabilityTypeInfo: vulnPattern,
      analyses: analyses.map(a => ({
        id: a.id,
        skillId: a.skillId,
        relatedSkillId: a.relatedSkillId,
        isDuplicate: a.isDuplicate,
        overlapType: a.overlapType,
        confidence: a.confidence,
        llmReason: a.llmReason,
        keyDifferences: a.keyDifferences ? JSON.parse(a.keyDifferences) : [],
        recommendation: a.recommendation,
        reviewStatus: a.reviewStatus,
        analyzedAt: a.analyzedAt,
      })),
    };

    return NextResponse.json({ data: groupWithDetails }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取重复组详情失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/skills-governance/duplicate-groups/[id]
 * 审核处理重复组
 * 
 * Body:
 * - action: 'merge' | 'keep_all' | 'delete_duplicates'
 * - primarySkillId: 保留的主 Skill ID（merge/delete_duplicates 时必填）
 * - deleteSkillIds: 要删除的 Skill ID 列表（delete_duplicates 时必填）
 * - notes: 审核备注
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const { id } = await context.params;
    const body = await request.json();
    const { action, primarySkillId, deleteSkillIds, notes } = body;

    // 验证 action
    if (!action || !['merge', 'keep_all', 'delete_duplicates'].includes(action)) {
      return NextResponse.json(
        { error: '无效的 action，必须是 merge/keep_all/delete_duplicates' },
        { status: 400 }
      );
    }

    // 获取重复组
    const group = await prisma.skillDuplicateGroup.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            skill: { select: { id: true, name: true, isActive: true } },
          },
        },
      },
    });

    if (!group) {
      return NextResponse.json({ error: '重复组不存在' }, { status: 404 });
    }

    if (group.status === 'resolved') {
      return NextResponse.json({ error: '重复组已处理，无法再次操作' }, { status: 400 });
    }

    let result: { message: string; affectedSkills: string[] } = { message: '', affectedSkills: [] };

    // 根据 action 执行不同操作
    switch (action) {
      case 'merge':
        // 合并：将其他 Skill 的内容合并到主 Skill
        if (!primarySkillId) {
          return NextResponse.json({ error: 'merge 操作需要指定 primarySkillId' }, { status: 400 });
        }

        const primaryMember = group.members.find(m => m.skillId === primarySkillId);
        if (!primaryMember) {
          return NextResponse.json({ error: 'primarySkillId 不在重复组成员中' }, { status: 400 });
        }

        const otherMembers = group.members.filter(m => m.skillId !== primarySkillId);

        // 创建合并记录
        for (const member of otherMembers) {
          await prisma.skillMergeRecord.create({
            data: {
              id: `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
              sourceSkillId: member.skillId,
              targetSkillId: primarySkillId,
              mergeReason: `重复组 ${group.id} 合并处理`,
              mergeDetails: JSON.stringify({ groupId: group.id, action: 'merge' }),
              status: 'pending',
              mergedBy: auth.payload.userId,
              updatedAt: new Date(),
            },
          });
        }

        result = {
          message: `已创建 ${otherMembers.length} 个合并记录，等待执行`,
          affectedSkills: otherMembers.map(m => m.skill.name),
        };
        break;

      case 'keep_all':
        // 保留全部：标记为已处理，不做任何合并/删除
        result = {
          message: '已标记为保留全部，无需合并或删除',
          affectedSkills: [],
        };
        break;

      case 'delete_duplicates':
        // 删除重复：直接删除指定的 Skill
        if (!deleteSkillIds || deleteSkillIds.length === 0) {
          return NextResponse.json({ error: 'delete_duplicates 操作需要指定 deleteSkillIds' }, { status: 400 });
        }

        // 验证 deleteSkillIds 都在组成员中
        const invalidIds = deleteSkillIds.filter(
          (sid: string) => !group.members.some(m => m.skillId === sid)
        );
        if (invalidIds.length > 0) {
          return NextResponse.json(
            { error: `以下 Skill ID 不在重复组成员中: ${invalidIds.join(', ')}` },
            { status: 400 }
          );
        }

        // 删除 Skill（软删除：标记为 inactive）
        await prisma.skill.updateMany({
          where: { id: { in: deleteSkillIds } },
          data: { isActive: false },
        });

        const deletedSkills = group.members.filter(m => deleteSkillIds.includes(m.skillId));

        result = {
          message: `已将 ${deletedSkills.length} 个 Skill 标记为 inactive`,
          affectedSkills: deletedSkills.map(m => m.skill.name),
        };
        break;
    }

    // 更新重复组状态
    await prisma.skillDuplicateGroup.update({
      where: { id },
      data: {
        status: 'resolved',
        resolution: action,
        resolvedBy: auth.payload.userId,
        resolvedAt: new Date(),
        resolutionNotes: notes || result.message,
      },
    });

    logger.info(LOG_MODULES.SKILL, '审核处理重复组', {
      userId: auth.payload.userId,
      groupId: group.id,
      action,
      affectedSkills: result.affectedSkills,
    });

    return NextResponse.json({
      data: {
        success: true,
        action,
        message: result.message,
        affectedSkills: result.affectedSkills,
      },
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '审核处理重复组失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/skills-governance/duplicate-groups/[id]
 * 删除重复组（仅删除组记录，不影响 Skill）
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_DELETE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const { id } = await context.params;

    const group = await prisma.skillDuplicateGroup.findUnique({
      where: { id },
    });

    if (!group) {
      return NextResponse.json({ error: '重复组不存在' }, { status: 404 });
    }

    // 删除组成员（级联删除）
    await prisma.skillDuplicateGroup.delete({
      where: { id },
    });

    logger.info(LOG_MODULES.SKILL, '删除重复组', {
      userId: auth.payload.userId,
      groupId: id,
    });

    return NextResponse.json({ data: { success: true, message: '重复组已删除' } }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '删除重复组失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}