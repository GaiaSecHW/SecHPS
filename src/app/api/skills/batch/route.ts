import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponseNested } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { saveSkillToDisk, deleteSkillFromDisk } from '@/services/skill-files';
import { getSkillOutputTemplate } from '@/lib/skill-template';
import { logger, LOG_MODULES } from '@/lib/logger';
import { buildTenantFilter } from '@/lib/tenant-filter';
import { gitSkillSync } from '@/services/git-skill-sync';

export async function POST(request: Request) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const body = await request.json();
    const { action, skillIds } = body;

    if (!action || !skillIds || !Array.isArray(skillIds) || skillIds.length === 0) {
      return NextResponse.json({ details: { error: '参数错误' } }, { status: 400 });
    }

    const tenantFilter = buildTenantFilter(tenant, {
      tenantField: 'tenantId',
      isPublicField: 'isPublic',
    });

    const skills = await prisma.skill.findMany({
      where: {
        id: { in: skillIds },
        OR: [
          { userId: payload.userId },
          { userId: null },
          { ...tenantFilter },
        ],
      },
    });

    if (skills.length === 0) {
      return NextResponse.json({ details: { error: '未找到任何 Skill' } }, { status: 404 });
    }

    const isAdmin = hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE);

    if (!isAdmin) {
      const publicSkills = skills.filter(s => s.userId === null);
      if (publicSkills.length > 0) {
        return NextResponse.json({ details: { error: '修改公共 Skill 需要管理员权限' } }, { status: 403 });
      }

      const notOwnPrivate = skills.filter(s => s.userId !== payload.userId);
      if (notOwnPrivate.length > 0) {
        return NextResponse.json({ details: { error: '只能修改自己的私有 Skill' } }, { status: 403 });
      }

      const builtinSkills = skills.filter(s => s.isBuiltin);
      if (builtinSkills.length > 0) {
        return NextResponse.json({ details: { error: '内置 Skill 只有管理员可以修改' } }, { status: 400 });
      }

      const notLatestSkills = skills.filter(s => !s.isLatest);
      if (notLatestSkills.length > 0) {
        return NextResponse.json({ details: { error: '只能修改最新版本的 Skill' } }, { status: 400 });
      }
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
        const template = await getSkillOutputTemplate();
        for (const skill of skills) {
          saveSkillToDisk(skill, template).catch(err => {
            logger.errorWithUser(LOG_MODULES.SKILL, payload, '批量启用保存磁盘文件失败', skill.id, { details: { skillName: skill.name, error: err instanceof Error ? err.message : String(err) } });
          });
        }
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
        for (const skill of skills) {
          deleteSkillFromDisk(skill.name, skill.userId).catch(err => {
            logger.errorWithUser(LOG_MODULES.SKILL, payload, '批量禁用删除磁盘文件失败', skill.id, { details: { skillName: skill.name, error: err instanceof Error ? err.message : String(err) } });
          });
        }
        break;

      case 'delete':
        await prisma.$transaction(async (tx) => {
          await tx.skillEvolution.deleteMany({
            where: {
              OR: [
                { skillId: { in: skillIds } },
                { Skill: { parentId: { in: skillIds } } },
              ],
            },
          });

          await tx.skill.deleteMany({
            where: { parentId: { in: skillIds } },
          });

          await tx.skill.deleteMany({
            where: { id: { in: skillIds } },
          });
        });
        for (const skill of skills) {
          deleteSkillFromDisk(skill.name, skill.userId).catch(err => {
            logger.errorWithUser(LOG_MODULES.SKILL, payload, '批量删除磁盘文件失败', skill.id, { details: { skillName: skill.name, error: err instanceof Error ? err.message : String(err) } });
          });
          // Git 方式删除
          gitSkillSync.deleteSkill(skill.name).then(gitResult => {
            if (!gitResult.success) {
              logger.errorWithUser(LOG_MODULES.SKILL, payload, '批量删除 Git 文件失败', skill.id, { 
                details: { skillName: skill.name, error: gitResult.message } 
              });
            }
          }).catch(err => {
            logger.errorWithUser(LOG_MODULES.SKILL, payload, '批量删除 Git 异常', skill.id, { 
              details: { skillName: skill.name, error: err instanceof Error ? err.message : String(err) } 
            });
          });
        }
        result = { count: skillIds.length };
        break;

      default:
        return NextResponse.json({ details: { error: '不支持的操作' } }, { status: 400 });
    }

    return NextResponse.json({
      message: '操作成功',
      affected: result.count || skillIds.length,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '批量操作 Skills 错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}