// src/app/api/admin/skills-governance/analysis-review/[id]/route.ts
// Skills 分析结果详情和审核操作 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';

/**
 * GET /api/admin/skills-governance/analysis-review/[id]
 * 获取分析结果详情
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const { id } = await params;

    const analysis = await prisma.skillAnalysis.findUnique({
      where: { id },
      include: {
        Skill: {
          select: {
            id: true,
            name: true,
            displayName: true,
            description: true,
            categoryId: true,
            vulnerabilityTreeId: true,
            content: true,
          },
        },
      },
    });

    if (!analysis) {
      return NextResponse.json({ error: '分析结果不存在' }, { status: 404 });
    }

    // 获取关联的 Skill
    let skillB = null;
    if (analysis.relatedSkillId) {
      skillB = await prisma.skill.findUnique({
        where: { id: analysis.relatedSkillId },
        select: {
          id: true,
          name: true,
          displayName: true,
          description: true,
          categoryId: true,
          vulnerabilityTreeId: true,
          content: true,
        },
      });
    }

    return NextResponse.json({
      data: {
        id: analysis.id,
        skillA: analysis.Skill,
        skillB,
        isDuplicate: analysis.isDuplicate,
        overlapType: analysis.overlapType,
        confidence: analysis.confidence,
        llmReason: analysis.llmReason,
        keyDifferences: analysis.keyDifferences ? JSON.parse(analysis.keyDifferences) : null,
        sharedFunctionality: analysis.sharedFunctionality ? JSON.parse(analysis.sharedFunctionality) : null,
        recommendation: analysis.recommendation,
        entryPointComparison: analysis.entryPointComparison 
          ? JSON.parse(analysis.entryPointComparison) 
          : null,
        reviewStatus: analysis.reviewStatus,
        reviewedBy: analysis.reviewedBy,
        reviewedAt: analysis.reviewedAt,
        reviewNotes: analysis.reviewNotes,
        createdAt: analysis.createdAt,
      },
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取分析详情失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * PUT /api/admin/skills-governance/analysis-review/[id]
 * 审核分析结果
 * 
 * Body:
 * - action: 'confirm_duplicate' | 'keep_both' | 'pending'
 * - notes: 审核备注
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const { id } = await params;
    const body = await request.json();
    const { action, notes } = body;

    if (!['confirm_duplicate', 'keep_both', 'pending'].includes(action)) {
      return NextResponse.json({ error: '无效的操作类型' }, { status: 400 });
    }

    // 获取分析结果
    const analysis = await prisma.skillAnalysis.findUnique({
      where: { id },
    });

    if (!analysis) {
      return NextResponse.json({ error: '分析结果不存在' }, { status: 404 });
    }

    // 更新审核状态
    let reviewStatus = 'pending';
    if (action === 'confirm_duplicate') {
      reviewStatus = 'approved';
    } else if (action === 'keep_both') {
      reviewStatus = 'rejected';
    }

    const updated = await prisma.skillAnalysis.update({
      where: { id },
      data: {
        reviewStatus,
        reviewedBy: auth.payload.userId,
        reviewedAt: new Date(),
        reviewNotes: notes || null,
      },
    });

    // 如果确认重复，创建重复组
    if (action === 'confirm_duplicate' && analysis.relatedSkillId) {
      // 检查是否已有重复组
      const existingGroup = await prisma.skillDuplicateGroup.findFirst({
        where: {
          SkillDuplicateGroupMember: {
            some: { skillId: analysis.skillId },
          },
        },
      });

      if (!existingGroup) {
        // 获取技能信息
        const skillA = await prisma.skill.findUnique({
          where: { id: analysis.skillId },
          select: { categoryId: true, vulnerabilityTreeId: true },
        });

        const groupId = generateId('group');

        await prisma.skillDuplicateGroup.create({
          data: {
            id: groupId,
            language: skillA?.categoryId || 'unknown',
            vulnerabilityType: skillA?.vulnerabilityTreeId || 'unknown',
            status: 'pending_review',
            updatedAt: new Date(),
            skillCount: 2,
            SkillDuplicateGroupMember: {
              create: [
                { id: generateId('sdgm'), groupId, skillId: analysis.skillId, role: 'primary', similarityScore: 1.0 },
                { id: generateId('sdgm'), groupId, skillId: analysis.relatedSkillId!, role: 'member', similarityScore: analysis.confidence },
              ],
            },
          },
        });

        logger.info(LOG_MODULES.SKILL, '人工审核确认重复，创建重复组', {
          userId: auth.payload.userId,
          analysisId: id,
          groupId,
        });
      }
    }

    logger.info(LOG_MODULES.SKILL, '审核分析结果', {
      userId: auth.payload.userId,
      analysisId: id,
      action,
      reviewStatus,
    });

    return NextResponse.json({
      data: {
        success: true,
        reviewStatus,
      },
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '审核分析结果失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
