import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/auth';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { saveSkillToDisk, deleteSkillFromDisk } from '@/services/skill-files';
import { getSkillOutputTemplate } from '@/lib/skill-template';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';
import { buildTenantFilter } from '@/lib/tenant-filter';
import { gitSkillSync } from '@/services/git-skill-sync';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequestEnhanced(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    const { id } = await params;

    const skill = await prisma.skill.findUnique({
      where: { id },
      include: {
        SkillCategory: { select: { id: true, name: true, displayName: true, icon: true, hasSubDimension: true } },
        AttackPattern: {
          select: {
            id: true, name: true, level: true, parent_id: true, library_id: true,
          },
        },
        SkillProductTag: { select: { id: true, productTagId: true, ProductTag: { select: { id: true, name: true, displayName: true } } } },
        SkillExecution: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        SkillEvolution: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        Skill: true,
        other_Skill: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: { id: true, name: true, displayName: true, version: true, createdAt: true },
        },
      },
    });

    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    const isAdmin = hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE);
    const isOwner = skill.userId === payload.userId;
    const tenantFilter = buildTenantFilter(tenant, {
      tenantField: 'tenantId',
      isPublicField: 'isPublic',
    });
    const isTenantSkill = tenantFilter ? 
      (skill.tenantId === tenant.tenantId || skill.isPublic === true) : 
      skill.isPublic === true;

    if (!isAdmin && !isOwner && !isTenantSkill && skill.userId !== null) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    return NextResponse.json({ skill });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skill 详情错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequestEnhanced(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    const { id } = await params;

    const body = await request.json();
    const { 
      name, displayName, description, content, categoryId, vulnerabilityTreeId, 
      isActive, severity, cwe, productTagIds, isPublic, 
    } = body;

    const vulnerabilityTreeIdNum = vulnerabilityTreeId ? Number(vulnerabilityTreeId) : null;
    const vulnerabilityTreeIdStr = vulnerabilityTreeId || null;

    const skill = await prisma.skill.findUnique({ where: { id } });
    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    const isAdmin = hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE);
    if (!isAdmin) {
      if (skill.userId === null) {
        return NextResponse.json({ error: '禁止访问 - 修改公共 Skill 需要管理员权限' }, { status: 403 });
      }
      if (skill.userId !== payload.userId) {
        return NextResponse.json({ error: '禁止访问 - 只能修改自己的私有 Skill' }, { status: 403 });
      }
      if (!skill.isLatest) {
        return NextResponse.json({ error: '只能修改最新版本的 Skill' }, { status: 400 });
      }
    }

    let updatedSkill: Awaited<ReturnType<typeof prisma.skill.create>> | Awaited<ReturnType<typeof prisma.skill.update>> | undefined;

    if (content && content !== skill.content) {
      const currentSkill = await prisma.skill.findUnique({ where: { id } });
      if (!currentSkill) {
        return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
      }

      await prisma.skill.update({
        where: { id },
        data: { isLatest: false },
      });

      const newVersion = currentSkill.version + 1;
      updatedSkill = await prisma.skill.create({
        data: {
          id: generateId('skill'),
          name: currentSkill.name,
          displayName: displayName || currentSkill.displayName,
          description: description || currentSkill.description,
          categoryId: categoryId || currentSkill.categoryId,
          vulnerabilityTreeId: vulnerabilityTreeIdNum ?? currentSkill.vulnerabilityTreeId,
          cwe: cwe || currentSkill.cwe,
          content,
          userId: currentSkill.userId,
          tenantId: currentSkill.tenantId,
          isPublic: isPublic !== undefined ? isPublic : currentSkill.isPublic,
          isBuiltin: currentSkill.isBuiltin,
          version: newVersion,
          parentId: id,
          isLatest: true,
          severity: severity || currentSkill.severity,
          updatedAt: new Date(),
        },
      });

      await prisma.skillEvolution.create({
        data: {
          id: generateId('skev'),
          skillId: updatedSkill.id,
          toVersion: newVersion,
          fromVersion: currentSkill.version,
          changeType: 'content_update',
          changeDesc: '内容更新',
          beforeData: currentSkill.content,
          afterData: content,
          reason: '内容更新',
          createdAt: new Date(),
        },
      });
    } else {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (name) updateData.name = name;
      if (displayName) updateData.displayName = displayName;
      if (description) updateData.description = description;
      if (categoryId) updateData.categoryId = categoryId;
      if (vulnerabilityTreeId !== undefined) updateData.vulnerabilityTreeId = vulnerabilityTreeIdNum;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (severity !== undefined) updateData.severity = severity || null;
      if (cwe !== undefined) updateData.cwe = cwe || null;
      if (isPublic !== undefined) updateData.isPublic = isPublic;

      updatedSkill = await prisma.skill.update({
        where: { id },
        data: updateData,
      });
    }

    if (productTagIds !== undefined) {
      await prisma.skillProductTag.deleteMany({ where: { skillId: id } });
      if (productTagIds.length > 0) {
        await prisma.skillProductTag.createMany({
          data: productTagIds.map((tagId: string) => ({
            id: generateId('spt'),
            skillId: updatedSkill!.id,
            productTagId: tagId,
          })),
        });
      }
    }

    if (updatedSkill) {
      try {
        const template = await getSkillOutputTemplate();
        
        if (isActive === false) {
          await deleteSkillFromDisk(updatedSkill.name, updatedSkill.userId);
        } else {
          await saveSkillToDisk(updatedSkill, template);
        }
        
        // Git 同步更新
        if (content && content !== skill.content) {
          await gitSkillSync.updateSkillFile(updatedSkill.name, 'SKILL.md', content);
        }
      } catch (err) {
        logger.errorWithUser(LOG_MODULES.SKILL, payload, '同步磁盘/Git文件失败', updatedSkill!.id, { details: { error: err instanceof Error ? err.message : String(err) } });
      }
    }

    return NextResponse.json({ skill: updatedSkill });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '更新 Skill 错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequestEnhanced(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    const { id } = await params;

    const skill = await prisma.skill.findUnique({ where: { id } });
    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    const isAdmin = hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE);
    
    if (!isAdmin) {
      if (skill.userId === null) {
        return NextResponse.json({ error: '禁止访问 - 删除公共 Skill 需要管理员权限' }, { status: 403 });
      }
      if (skill.userId !== payload.userId) {
        return NextResponse.json({ error: '禁止访问 - 只能删除自己的私有 Skill' }, { status: 403 });
      }
    }

    if (skill.isBuiltin && !isAdmin) {
      return NextResponse.json({ error: '内置 Skill 只有管理员可以删除' }, { status: 400 });
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.skillEvolution.deleteMany({
          where: {
            OR: [
              { skillId: id },
              { Skill: { parentId: id } },
            ],
          },
        });

        await tx.skill.deleteMany({
          where: { parentId: id },
        });

        await tx.skill.delete({ where: { id } });
      });
    } catch (txError) {
      logger.errorNoUser(LOG_MODULES.SKILL, '删除事务失败', { details: { error: txError instanceof Error ? txError.message : String(txError) } });
      return NextResponse.json({ error: '删除失败: ' + (txError instanceof Error ? txError.message : String(txError)) }, { status: 500 });
    }

    // 删除磁盘文件
    deleteSkillFromDisk(skill.name, skill.userId).catch(err => {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, '删除磁盘文件失败', skill.id, { details: { skillName: skill.name, error: err instanceof Error ? err.message : String(err) } });
    });

    // Git 方式删除
    gitSkillSync.deleteSkill(skill.name).then(result => {
      if (!result.success) {
        logger.errorWithUser(LOG_MODULES.SKILL, payload, 'Git 删除文件失败', skill.id, { 
          details: { skillName: skill.name, error: result.message } 
        });
      } else {
        logger.info(LOG_MODULES.SKILL, `Git 删除成功: ${skill.name}`, { message: result.message });
      }
    }).catch(err => {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, 'Git 删除异常', skill.id, { 
        details: { skillName: skill.name, error: err instanceof Error ? err.message : String(err) } 
      });
    });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '删除 Skill 错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}