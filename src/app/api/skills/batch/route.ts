// src/app/api/skills/batch/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// POST /api/skills/batch - 批量操作
export async function POST(request: Request) {
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

    const body = await request.json();
    const { action, skillIds } = body;

    if (!action || !skillIds || !Array.isArray(skillIds) || skillIds.length === 0) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    // 获取所有指定的 Skills
    const skills = await prisma.skill.findMany({
      where: {
        id: { in: skillIds },
      },
    });

    if (skills.length === 0) {
      return NextResponse.json({ error: '未找到任何 Skill' }, { status: 404 });
    }

    // 检查权限
    const publicSkills = skills.filter(s => s.userId === null);
    const privateSkills = skills.filter(s => s.userId !== null);

    // 如果有公共 Skill，需要管理员权限
    if (publicSkills.length > 0) {
      if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
        return NextResponse.json({ error: '修改公共 Skill 需要管理员权限' }, { status: 403 });
      }
    }

    // 如果有私有 Skill，只能修改自己的
    const notOwnPrivate = privateSkills.filter(s => s.userId !== payload.userId);
    if (notOwnPrivate.length > 0) {
      return NextResponse.json({ error: '只能修改自己的私有 Skill' }, { status: 403 });
    }

    // 检查内置 Skill 和版本
    const builtinSkills = skills.filter(s => s.isBuiltin);
    if (builtinSkills.length > 0) {
      return NextResponse.json({ error: '内置 Skill 不能修改' }, { status: 400 });
    }

    const notLatestSkills = skills.filter(s => !s.isLatest);
    if (notLatestSkills.length > 0) {
      return NextResponse.json({ error: '只能修改最新版本的 Skill' }, { status: 400 });
    }

    let result;

    switch (action) {
      case 'enable':
        result = await prisma.skill.updateMany({
          where: {
            id: { in: skillIds },
          },
          data: {
            isActive: true,
          },
        });
        break;

      case 'disable':
        result = await prisma.skill.updateMany({
          where: {
            id: { in: skillIds },
          },
          data: {
            isActive: false,
          },
        });
        break;

      case 'delete':
        await prisma.$transaction(async (tx) => {
          // 删除所有进化记录
          await tx.skillEvolution.deleteMany({
            where: {
              OR: [
                { skillId: { in: skillIds } },
                { skill: { parentId: { in: skillIds } } },
              ],
            },
          });

          // 删除所有子版本
          await tx.skill.deleteMany({
            where: { parentId: { in: skillIds } },
          });

          // 删除当前版本
          await tx.skill.deleteMany({
            where: { id: { in: skillIds } },
          });
        });
        result = { count: skillIds.length };
        break;

      default:
        return NextResponse.json({ error: '不支持的操作' }, { status: 400 });
    }

    return NextResponse.json({
      message: '操作成功',
      affected: result.count || skillIds.length,
    });
  } catch (error) {
    console.error('批量操作 Skills 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
