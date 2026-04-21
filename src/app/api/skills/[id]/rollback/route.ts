// src/app/api/skills/[id]/rollback/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/skills/:id/rollback - 回滚 Skill 到指定版本
export async function POST(
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
    const body = await request.json();
    const { targetVersionId, reason } = body;

    if (!targetVersionId) {
      return NextResponse.json(
        { error: '缺少目标版本 ID' },
        { status: 400 }
      );
    }

    if (!reason) {
      return NextResponse.json(
        { error: '缺少回滚原因' },
        { status: 400 }
      );
    }

    // 获取目标版本
    const targetSkill = await prisma.skill.findUnique({
      where: { id: targetVersionId },
    });

    if (!targetSkill) {
      return NextResponse.json({ error: '目标 Skill 版本不存在' }, { status: 404 });
    }

    // 检查权限
    if (targetSkill.userId === null) {
      if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
        return NextResponse.json({ error: '禁止访问 - 回滚公共 Skill 需要管理员权限' }, { status: 403 });
      }
    } else if (targetSkill.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问 - 只能回滚自己的私有 Skill' }, { status: 403 });
    }

    // 获取当前最新版本
    const currentLatest = await prisma.skill.findFirst({
      where: {
        name: targetSkill.name,
        userId: targetSkill.userId,
        isLatest: true,
      },
    });

    if (!currentLatest) {
      return NextResponse.json({ error: '当前最新版本不存在' }, { status: 404 });
    }

    // 将当前最新版本标记为非最新
    await prisma.skill.update({
      where: { id: currentLatest.id },
      data: { isLatest: false },
    });

    // 创建新版本（基于目标版本）
    const newSkill = await prisma.skill.create({
      data: {
        id: generateId('skill'),
        name: targetSkill.name,
        displayName: targetSkill.displayName,
        description: targetSkill.description,
        vulnerabilityPatternId: targetSkill.vulnerabilityPatternId,
        cwe: targetSkill.cwe,
        severity: targetSkill.severity,
        content: targetSkill.content,
        userId: targetSkill.userId,
        isBuiltin: targetSkill.isBuiltin,
        isActive: targetSkill.isActive,
        version: currentLatest.version + 1,
        parentId: currentLatest.id,
        isLatest: true,
        successRate: targetSkill.successRate,
        avgDuration: targetSkill.avgDuration,
        execCount: targetSkill.execCount,
        updatedAt: new Date(),
      },
    });

    // 记录进化历史
    await prisma.skillEvolution.create({
      data: {
        id: generateId('evol'),
        skillId: newSkill.id,
        fromVersion: currentLatest.version,
        toVersion: newSkill.version,
        changeType: 'prompt-update',
        changeDesc: `回滚到版本 ${targetSkill.version}`,
        beforeData: JSON.stringify({
          displayName: currentLatest.displayName,
          description: currentLatest.description,
          content: currentLatest.content,
        }),
        afterData: JSON.stringify({
          displayName: targetSkill.displayName,
          description: targetSkill.description,
          content: targetSkill.content,
        }),
        reason: `回滚: ${reason}`,
        beforeRate: currentLatest.successRate,
        afterRate: targetSkill.successRate,
      },
    });

    return NextResponse.json({
      skill: newSkill,
      message: `成功回滚到版本 ${targetSkill.version}`,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '回滚 Skill 版本错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
