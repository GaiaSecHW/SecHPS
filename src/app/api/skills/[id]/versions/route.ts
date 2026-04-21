// src/app/api/skills/[id]/versions/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/skills/:id/versions - 获取 Skill 的所有版本
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    // 获取当前 Skill
    const skill = await prisma.skill.findUnique({
      where: { id },
    });

    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    // 检查访问权限
    if (skill.userId && skill.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取所有版本
    const versions = await prisma.skill.findMany({
      where: {
        name: skill.name,
        userId: skill.userId,
      },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        isLatest: true,
        createdAt: true,
        displayName: true,
        description: true,
        severity: true,
      },
    });

    // 获取进化记录
    const evolutions = await prisma.skillEvolution.findMany({
      where: {
        skillId: { in: versions.map(v => v.id) },
      },
      select: {
        skillId: true,
        changeDesc: true,
        reason: true,
        changeType: true,
        fromVersion: true,
        toVersion: true,
      },
    });

    const evolutionMap = new Map(
      evolutions.map(e => [e.skillId, e])
    );

    const versionsWithEvolution = versions.map(v => ({
      ...v,
      evolution: evolutionMap.get(v.id) || null,
    }));

    return NextResponse.json({
      versions: versionsWithEvolution,
      currentVersion: skill.version,
      totalVersions: versions.length,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skill 版本列表错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
