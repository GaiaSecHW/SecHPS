// src/app/api/skills/[id]/vulnerabilities/route.ts
// 获取 Skill 发现的漏洞列表（通过 SkillExecution）

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/skills/:id/vulnerabilities - 获取 Skill 发现的漏洞列表
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status') || 'all'; // all, false-positive, confirmed, new
    const skip = (page - 1) * limit;

    // 验证 Skill 存在并检查所有权
    const userIsAdmin = isAdmin(auth.payload);
    const skill = await prisma.skill.findFirst({
      where: {
        id,
        ...(userIsAdmin ? {} : {
          OR: [
            { userId: auth.payload?.userId },
            { isPublic: true },
          ],
        }),
      },
      select: { id: true, name: true, vulnerabilityCount: true, userId: true, isPublic: true },
    });

    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在或无权访问' }, { status: 404 });
    }

    // 获取该 Skill 的所有执行记录 ID
    const executions = await prisma.skillExecution.findMany({
      where: { skillId: id },
      select: { id: true, evaluationId: true },
    });

    const executionIds = executions.map(e => e.id);

    if (executionIds.length === 0) {
      return NextResponse.json({
        skill: {
          id: skill.id,
          name: skill.name,
          vulnerabilityCount: skill.vulnerabilityCount,
          falsePositiveCount: 0,
          confirmedCount: 0,
        },
        vulnerabilities: [],
        pagination: {
          total: 0,
          page,
          limit,
          totalPages: 0,
        },
      });
    }

    // 统计各状态的漏洞数量
    const statusCounts = await prisma.vulnerability.groupBy({
      by: ['status'],
      where: { skillExecutionId: { in: executionIds } },
      _count: { id: true },
    });

    const falsePositiveCount = statusCounts.find(s => s.status === 'false-positive')?._count.id || 0;
    const confirmedCount = statusCounts.find(s => s.status === 'confirmed')?._count.id || 0;
    const newCount = statusCounts.find(s => s.status === 'new')?._count.id || 0;

    // 构建查询条件
    const whereClause: any = { skillExecutionId: { in: executionIds } };
    if (status === 'false-positive') {
      whereClause.status = 'false-positive';
    } else if (status === 'confirmed') {
      whereClause.status = 'confirmed';
    } else if (status === 'new') {
      whereClause.status = 'new';
    }

    // 获取漏洞总数（按筛选条件）
    const total = await prisma.vulnerability.count({ where: whereClause });

    // 获取漏洞列表
    const vulnerabilities = await prisma.vulnerability.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        type: true,
        severity: true,
        description: true,
        location: true,
        status: true,
        createdAt: true,
        skillExecutionId: true,
        SkillExecution: {
          select: {
            id: true,
            evaluationId: true,
            EvaluationSession: {
              select: {
                id: true,
                title: true,
                Project: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    // 格式化返回数据
    const formattedVulnerabilities = vulnerabilities.map(v => ({
      mappingId: v.id,
      matchType: 'exact',
      skillNameReported: skill.name,
      matchedAt: v.createdAt,
      vulnerability: {
        id: v.id,
        title: v.title,
        type: v.type,
        severity: v.severity,
        description: v.description,
        location: v.location,
        status: v.status,
        createdAt: v.createdAt,
      },
      evaluation: v.SkillExecution?.EvaluationSession ? {
        id: v.SkillExecution.EvaluationSession.id,
        title: v.SkillExecution.EvaluationSession.title,
        project: v.SkillExecution.EvaluationSession.Project,
      } : null,
    }));

    return NextResponse.json({
      skill: {
        id: skill.id,
        name: skill.name,
        vulnerabilityCount: skill.vulnerabilityCount,
        falsePositiveCount,
        confirmedCount,
        newCount,
      },
      vulnerabilities: formattedVulnerabilities,
      stats: {
        total: statusCounts.reduce((sum, s) => sum + s._count.id, 0),
        falsePositive: falsePositiveCount,
        confirmed: confirmedCount,
        new: newCount,
      },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skill 漏洞列表错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}