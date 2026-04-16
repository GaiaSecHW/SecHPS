// src/app/api/skills/analyze-duplication/route.ts
// Skills 单对 LLM 分析 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { analyzeSkillDuplication, type SkillForLLMAnalysis } from '@/services/skill-llm-analysis';

/**
 * POST /api/skills/analyze-duplication
 * 使用 LLM 分析两个 Skill 是否真正重复
 * 
 * Body:
 * - skillIdA: string
 * - skillIdB: string
 * - saveResult: boolean - 是否保存结果到数据库（可选，默认 false）
 */
export async function POST(request: Request) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const body = await request.json();
    const { skillIdA, skillIdB, saveResult = false } = body;

    if (!skillIdA || !skillIdB) {
      return NextResponse.json({ 
        error: '缺少必需参数: skillIdA, skillIdB' 
      }, { status: 400 });
    }

    if (skillIdA === skillIdB) {
      return NextResponse.json({ 
        error: '不能分析同一个技能' 
      }, { status: 400 });
    }

    // 获取两个 Skill 的详细信息
    const [skillA, skillB] = await Promise.all([
      prisma.skill.findUnique({
        where: { id: skillIdA },
        select: {
          id: true,
          name: true,
          displayName: true,
          description: true,
          category: true,
          cwe: true,
          techStack: true,
          content: true,
          triggers: true,
        },
      }),
      prisma.skill.findUnique({
        where: { id: skillIdB },
        select: {
          id: true,
          name: true,
          displayName: true,
          description: true,
          category: true,
          cwe: true,
          techStack: true,
          content: true,
          triggers: true,
        },
      }),
    ]);

    if (!skillA || !skillB) {
      return NextResponse.json({ 
        error: '找不到指定的技能',
        missing: !skillA ? skillIdA : skillIdB,
      }, { status: 404 });
    }

    logger.info(LOG_MODULES.SKILL, '开始 LLM 分析');

    // 转换为分析格式
    const skillAForAnalysis: SkillForLLMAnalysis = {
      id: skillA.id,
      name: skillA.name,
      displayName: skillA.displayName || skillA.name,
      description: skillA.description || '',
      category: skillA.category,
      techStack: Array.isArray(skillA.techStack) ? skillA.techStack : [],
      cwe: skillA.cwe,
      content: skillA.content || undefined,
      triggers: Array.isArray(skillA.triggers) ? skillA.triggers : [],
    };

    const skillBForAnalysis: SkillForLLMAnalysis = {
      id: skillB.id,
      name: skillB.name,
      displayName: skillB.displayName || skillB.name,
      description: skillB.description || '',
      category: skillB.category,
      techStack: Array.isArray(skillB.techStack) ? skillB.techStack : [],
      cwe: skillB.cwe,
      content: skillB.content || undefined,
      triggers: Array.isArray(skillB.triggers) ? skillB.triggers : [],
    };

    // 执行 LLM 分析
    const analysis = await analyzeSkillDuplication(skillAForAnalysis, skillBForAnalysis);

    // 如果需要保存结果
    if (saveResult) {
      try {
        await prisma.skillNewImpactAnalysis.create({
          data: {
            id: `llm-pair-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            skillId: skillA.id,
            similarSkills: JSON.stringify([{
              skillId: skillB.id,
              skillName: skillB.name,
              displayName: skillB.displayName,
              similarity: analysis.confidence,
              overlapType: analysis.overlapType,
              isDuplicate: analysis.isDuplicate,
              reason: analysis.reason,
            }]),
            overlapScore: analysis.confidence,
            affectedWorkflows: null,
            recommendation: analysis.recommendation,
            recommendationReason: analysis.reason,
            status: 'pending',
            analyzedAt: new Date(),
          },
        });
      } catch (e) {
        // 忽略保存错误
        logger.warn(LOG_MODULES.SKILL, '保存分析结果失败');
      }
    }

    logger.info(LOG_MODULES.SKILL, 'LLM 分析完成');

    return NextResponse.json({
      data: {
        skillA: {
          id: skillA.id,
          name: skillA.name,
          displayName: skillA.displayName,
          category: skillA.category,
        },
        skillB: {
          id: skillB.id,
          name: skillB.name,
          displayName: skillB.displayName,
          category: skillB.category,
        },
        analysis: {
          isDuplicate: analysis.isDuplicate,
          overlapType: analysis.overlapType,
          confidence: analysis.confidence,
          recommendation: analysis.recommendation,
          reason: analysis.reason,
          keyDifferences: analysis.keyDifferences,
          sharedFunctionality: analysis.sharedFunctionality,
        },
      }
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, 'LLM 分析失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ 
      error: '服务器内部错误',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
