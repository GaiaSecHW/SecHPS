// src/app/api/admin/skills-governance/review/[id]/route.ts
// Skills Governance - 审核操作 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/skills-governance/review/[id]
 * 获取单个分析结果的详情
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_GOVERNANCE_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const { id } = await params;

    // 2. 获取分析记录
    const analysis = await prisma.skillAnalysis.findUnique({
      where: { id },
      include: {
        Skill: {
          select: {
            id: true,
            name: true,
            displayName: true,
            description: true,
            techStackId: true,
            vulnerabilityPatternId: true,
          },
        },
      },
    });

    if (!analysis) {
      return NextResponse.json({ error: '分析记录不存在' }, { status: 404 });
    }

    // 3. 获取关联的 TechStackOption 和 VulnerabilityPattern
    let techStackOption = null;
    let vulnerabilityPattern = null;

    if (analysis.inferredVulnPatternId) {
      vulnerabilityPattern = await prisma.vulnerabilityPattern.findUnique({
        where: { id: analysis.inferredVulnPatternId },
        select: { id: true, name: true, displayName: true, categoryId: true, VulnerabilityCategory: { select: { value: true } } },
      });
    }

    // 4. 组装响应
    const detail = {
      id: analysis.id,
      skillId: analysis.skillId,
      skill: analysis.Skill,
      analysisType: analysis.analysisType,
      isDuplicate: analysis.isDuplicate,
      overlapType: analysis.overlapType,
      confidence: analysis.confidence,
      llmReason: analysis.llmReason,
      keyDifferences: analysis.keyDifferences ? JSON.parse(analysis.keyDifferences) : null,
      sharedFunctionality: analysis.sharedFunctionality ? JSON.parse(analysis.sharedFunctionality) : null,
      recommendation: analysis.recommendation,
      inferredLanguage: analysis.inferredLanguage,
      inferredVulnPatternId: analysis.inferredVulnPatternId,
      inferredVulnPattern: vulnerabilityPattern,
      reviewStatus: analysis.reviewStatus,
      reviewedBy: analysis.reviewedBy,
      reviewedAt: analysis.reviewedAt,
      reviewNotes: analysis.reviewNotes,
      analyzedAt: analysis.analyzedAt,
      analyzedBy: analysis.analyzedBy,
    };

    logger.access(LOG_MODULES.SKILL, auth.payload, 'skills_review_detail', { analysisId: id });

    return NextResponse.json({ data: detail }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取审核详情失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/skills-governance/review/[id]
 * 审核单个分析结果
 * 
 * Body:
 * - status: 'approved' | 'rejected' - 审核状态
 * - notes?: string - 审核备注
 * - action?: 'merge' | 'keep' | 'override' - 执行动作
 * - overrideLanguageId?: string - 覆盖语言 ID
 * - overrideVulnPatternId?: string - 覆盖漏洞类型 ID
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_APPROVE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const { id } = await params;

    // 2. 解析请求体
    const body = await request.json();
    const {
      status,
      notes,
      action,
      overrideLanguageId,
      overrideVulnPatternId,
    } = body;

    // 3. 验证参数
    if (!status || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: '无效的审核状态' }, { status: 400 });
    }

    // 4. 获取分析记录
    const analysis = await prisma.skillAnalysis.findUnique({
      where: { id },
      include: {
        Skill: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!analysis) {
      return NextResponse.json({ error: '分析记录不存在' }, { status: 404 });
    }

    // 5. 更新分析记录
    const updatedAnalysis = await prisma.skillAnalysis.update({
      where: { id },
      data: {
        reviewStatus: status,
        reviewedBy: auth.payload.userId,
        reviewedAt: new Date(),
        reviewNotes: notes,
      },
    });

    // 6. 根据审核状态和动作更新 Skill
    if (status === 'approved') {
      // 确定最终的语言和漏洞类型
      const finalLanguageId = overrideLanguageId ?? analysis.inferredLanguage ?? null;
      const finalVulnPatternId = overrideVulnPatternId ?? analysis.inferredVulnPatternId ?? null;

      // 更新 Skill 状态
      await prisma.skill.update({
        where: { id: analysis.skillId },
        data: {
          techStackId: finalLanguageId,
          vulnerabilityPatternId: finalVulnPatternId,
          updatedAt: new Date(),
        },
      });

      // 如果是重复检测，处理合并动作
      if (analysis.analysisType === 'duplication_check' && action === 'merge') {
        // 创建合并记录
        if (analysis.relatedSkillId) {
          await prisma.skillMergeRecord.create({
            data: {
              id: generateId('merge'),
              sourceSkillId: analysis.skillId,
              targetSkillId: analysis.relatedSkillId,
              mergeReason: analysis.llmReason ?? 'LLM 分析判定为重复',
              mergeDetails: JSON.stringify({
                confidence: analysis.confidence,
                overlapType: analysis.overlapType,
              }),
              status: 'pending',
              mergedBy: auth.payload.userId,
              updatedAt: new Date(),
            },
          });
        }
      }

      logger.info(LOG_MODULES.SKILL, '审核批准', {
        userId: auth.payload.userId,
      });

    } else if (status === 'rejected') {
      await prisma.skill.update({
        where: { id: analysis.skillId },
        data: { updatedAt: new Date() },
      });

      logger.info(LOG_MODULES.SKILL, '审核拒绝', {
        userId: auth.payload.userId,
      });
    }

    // 7. 组装响应
    return NextResponse.json({
      data: {
        success: true,
        analysis: {
          id: updatedAnalysis.id,
          reviewStatus: updatedAnalysis.reviewStatus,
          reviewedBy: updatedAnalysis.reviewedBy,
          reviewedAt: updatedAnalysis.reviewedAt,
          reviewNotes: updatedAnalysis.reviewNotes,
        },
        skill: {
          id: analysis.skillId,
        },
      }
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '审核操作失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({
      error: '服务器内部错误',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/skills-governance/review/[id]
 * 删除分析记录（仅限 rejected 状态）
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_GOVERNANCE_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const { id } = await params;

    // 2. 获取分析记录
    const analysis = await prisma.skillAnalysis.findUnique({
      where: { id },
    });

    if (!analysis) {
      return NextResponse.json({ error: '分析记录不存在' }, { status: 404 });
    }

    // 3. 只允许删除 rejected 状态的记录
    if (analysis.reviewStatus !== 'rejected') {
      return NextResponse.json({
        error: '只能删除已拒绝的分析记录',
      }, { status: 400 });
    }

    // 4. 删除记录
    await prisma.skillAnalysis.delete({
      where: { id },
    });

    logger.info(LOG_MODULES.SKILL, '删除分析记录', {
      userId: auth.payload.userId,
    });

    return NextResponse.json({
      data: { success: true, deletedId: id },
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '删除分析记录失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}