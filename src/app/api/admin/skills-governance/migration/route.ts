// src/app/api/admin/skills-governance/migration/route.ts
// Skills Governance - 存量迁移 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import {
  batchInferSkills,
  getSkillsForInference,
  applyInferenceResult,
  type SkillForInference,
  type InferenceResult,
} from '@/services/skill-migration-inference';

/**
 * GET /api/admin/skills-governance/migration
 * 获取迁移预览信息
 * 
 * Query params:
 * - skillIds: 指定 Skill ID 列表（逗号分隔）
 * - category: 指定类别
 * - limit: 限制数量
 */
export async function GET(request: Request) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_GOVERNANCE_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    // 2. 解析查询参数
    const url = new URL(request.url);
    const skillIdsParam = url.searchParams.get('skillIds');
    const category = url.searchParams.get('category');
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    // 3. 获取待迁移的 Skill 列表
    let skills: SkillForInference[];
    
    if (skillIdsParam) {
      // 指定 ID 列表
      const skillIds = skillIdsParam.split(',').map(id => id.trim());
      skills = await prisma.skill.findMany({
        where: {
          id: { in: skillIds },
        },
        select: {
          id: true,
          name: true,
          displayName: true,
          description: true,
          content: true,
          cwe: true,
        },
      });
    } else {
      skills = await getSkillsForInference({
        limit,
        status: 'pending',
      });
    }

    // 4. 获取统计
    const totalSkills = await prisma.skill.count({ where: { isLatest: true } });

    const preview = {
      skillsToMigrate: skills.length,
      skills: skills.slice(0, 20).map(s => ({
        id: s.id,
        name: s.name,
        displayName: s.displayName,
        cwe: s.cwe,
      })),
      stats: {
        total: totalSkills,
        pending: skills.length,
      },
      estimatedTime: `${Math.ceil(skills.length * 3 / 60)} 分钟`,
      estimatedCost: `${(skills.length * 0.002).toFixed(2)} USD`,
    };

    logger.access(LOG_MODULES.SKILL, auth.payload, 'skills_migration_preview', {
      skillCount: skills.length,
    });

    return NextResponse.json({ data: preview }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取迁移预览失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * POST /api/admin/skills-governance/migration
 * 执行存量迁移
 * 
 * Body:
 * - mode: 'preview' | 'execute' - 预览或执行
 * - skillIds?: string[] - 指定 Skill ID 列表
 * - category?: string - 指定类别
 * - limit?: number - 限制数量
 * - autoApprove?: boolean - 自动批准高置信度结果（默认 false）
 * - confidenceThreshold?: number - 自动批准的置信度阈值（默认 0.85）
 */
export async function POST(request: Request) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_GOVERNANCE_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    // 2. 解析请求体
    const body = await request.json();
    const {
      mode = 'preview',
      skillIds,
      category,
      limit,
      autoApprove = false,
      confidenceThreshold = 0.85,
    } = body;

    // 3. 获取待迁移的 Skill 列表
    let skills: SkillForInference[];
    
    if (skillIds && Array.isArray(skillIds)) {
      // 指定 ID 列表
      skills = await prisma.skill.findMany({
        where: {
          id: { in: skillIds },
        },
        select: {
          id: true,
          name: true,
          displayName: true,
          description: true,
          content: true,
          cwe: true,
        },
      });
    } else {
      // 按条件筛选
      skills = await getSkillsForInference({
        limit,
        status: 'pending',
      });
    }

    logger.info(LOG_MODULES.SKILL, '开始存量迁移', {
      userId: auth.payload.userId,
    });

    // 4. 预览模式：只返回预览信息，不执行
    if (mode === 'preview') {
      return NextResponse.json({
        data: {
          mode: 'preview',
          skillCount: skills.length,
          skills: skills.slice(0, 20).map(s => ({
            id: s.id,
            name: s.name,
            displayName: s.displayName,
          })),
          estimatedTime: `${Math.ceil(skills.length * 3 / 60)} 分钟`,
          estimatedCost: `${(skills.length * 0.002).toFixed(2)} USD`,
        }
      }, { status: 200 });
    }

    // 5. 执行模式：进行 LLM 推断
    const results = await batchInferSkills(skills, {
      concurrency: 3,
      skipAnalyzed: false, // 不跳过，因为已经筛选了
      onProgress: (current, total, result) => {
        logger.info(LOG_MODULES.SKILL, '迁移进度', {
          userId: auth.payload.userId,
        });
      },
    });

    // 6. 处理自动批准
    let autoApprovedCount = 0;
    let pendingReviewCount = 0;

    if (autoApprove) {
      for (const result of results.results) {
        if (!result.error && result.confidence >= confidenceThreshold) {
          // 高置信度自动批准
          await applyInferenceResult(result.skillId, result, 'migrated');
          autoApprovedCount++;
        } else if (!result.error) {
          // 低置信度需要人工审核
          await applyInferenceResult(result.skillId, result, 'pending_review');
          pendingReviewCount++;
        }
      }
    } else {
      // 不自动批准，全部进入待审核状态
      for (const result of results.results) {
        if (!result.error) {
          await applyInferenceResult(result.skillId, result, 'pending_review');
          pendingReviewCount++;
        }
      }
    }

    // 7. 创建分析记录
    for (const result of results.results) {
      if (!result.error) {
await prisma.skillAnalysis.create({
            data: {
              id: generateId('sa'),
              skillId: result.skillId,
              analysisType: 'migration_inference',
              confidence: result.confidence,
              llmReason: result.reason,
              inferredLanguage: result.language,
              inferredVulnPatternId: result.vulnerabilityPatternId,
              reviewStatus: result.confidence >= confidenceThreshold && autoApprove ? 'approved' : 'pending',
              analyzedBy: 'llm',
            },
          });
      }
    }

    logger.info(LOG_MODULES.SKILL, '存量迁移完成', {
      userId: auth.payload.userId,
    });

    // 8. 组装响应
    return NextResponse.json({
      data: {
        success: true,
        summary: {
          total: results.total,
          succeeded: results.succeeded,
          failed: results.failed,
          skipped: results.skipped,
          autoApproved: autoApprovedCount,
          pendingReview: pendingReviewCount,
        },
        results: results.results.slice(0, 50).map(r => ({
          skillId: r.skillId,
          language: r.language,
          languageId: r.languageId,
          vulnerabilityPatternId: r.vulnerabilityPatternId,
          vulnerabilityPatternName: r.vulnerabilityPatternName,
          confidence: r.confidence,
          reason: r.reason,
          error: r.error,
        })),
      }
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '存量迁移失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({
      error: '服务器内部错误',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}