// src/app/api/skills/[id]/vulnerabilities/route.ts
// 获取 Skill 发现的漏洞列表

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';

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
    const skip = (page - 1) * limit;

    // 验证 Skill 存在
    const skill = await prisma.skill.findUnique({
      where: { id },
      select: { id: true, name: true, vulnerabilityCount: true },
    });

    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    // 获取 Skill 发现的漏洞列表（通过 SkillVulnerabilityMapping）
    const mappings = await prisma.skillVulnerabilityMapping.findMany({
      where: { skillId: id },
      include: {
        Vulnerability: {
          select: {
            id: true,
            title: true,
            type: true,
            severity: true,
            description: true,
            filePath: true,
            status: true,
            createdAt: true,
          },
        },
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
      orderBy: { matchedAt: 'desc' },
      skip,
      take: limit,
    });

    // 获取总数
    const total = await prisma.skillVulnerabilityMapping.count({
      where: { skillId: id },
    });

    // 格式化返回数据
    const vulnerabilities = mappings.map(m => ({
      mappingId: m.id,
      matchType: m.matchType,
      skillNameReported: m.skillNameReported,
      matchedAt: m.matchedAt,
      vulnerability: m.Vulnerability,
      evaluation: m.EvaluationSession ? {
        id: m.EvaluationSession.id,
        title: m.EvaluationSession.title,
        project: m.EvaluationSession.Project,
      } : null,
    }));

    return NextResponse.json({
      skill: {
        id: skill.id,
        name: skill.name,
        vulnerabilityCount: skill.vulnerabilityCount,
      },
      vulnerabilities,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[API] 获取 Skill 漏洞列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
