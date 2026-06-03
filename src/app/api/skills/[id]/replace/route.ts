import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/auth';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { saveSkillToDisk } from '@/services/skill-files';
import { getSkillOutputTemplate } from '@/lib/skill-template';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';
import { gitSkillSync } from '@/services/git-skill-sync';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequestEnhanced(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload } = auth as AuthSuccessResult;

    const { id } = await params;

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const categoryId = formData.get('categoryId') as string;
    const vulnerabilityTreeId = formData.get('vulnerabilityTreeId') as string | null;
    const vulnerabilityTreeIdInt = vulnerabilityTreeId ? Number(vulnerabilityTreeId) : null;
    const productTagIdsStr = formData.get('productTagIds') as string;
    const skillName = formData.get('skillName') as string;
    const skillDisplayName = formData.get('skillDisplayName') as string;
    const skillDescription = formData.get('skillDescription') as string;
    const isPublic = formData.get('isPublic') as string;

    if (!file) {
      return NextResponse.json({ error: '缺少文件' }, { status: 400 });
    }

    if (!categoryId) {
      return NextResponse.json({ error: '请选择分类' }, { status: 400 });
    }

    const skillCategory = await prisma.skillCategory.findUnique({ where: { id: categoryId } });
    if (!skillCategory) {
      return NextResponse.json({ error: '分类不存在' }, { status: 400 });
    }

    if (skillCategory.hasSubDimension && !vulnerabilityTreeIdInt) {
      return NextResponse.json({ error: '请选择漏洞类型' }, { status: 400 });
    }

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

    let content: string;
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.zip')) {
      const arrayBuffer = await file.arrayBuffer();
      const zip = await import('jszip').then(jszip => jszip.loadAsync(arrayBuffer));

const skillMdPaths: string[] = [];
      zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir && relativePath.endsWith('SKILL.md') && relativePath.split('/').length <= 2) {
          skillMdPaths.push(relativePath);
        }
      });

      if (skillMdPaths.length === 0) {
        return NextResponse.json({ error: 'ZIP 中未找到 SKILL.md 文件（仅支持根目录或单层子目录内的 SKILL.md）' }, { status: 400 });
      }
      if (skillMdPaths.length > 1) {
        return NextResponse.json({ error: 'ZIP 包含多个 SKILL.md，请逐个上传' }, { status: 400 });
      }
      const skillMdPath = skillMdPaths[0];
      const skillFile = zip.file(skillMdPath);
      if (!skillFile) {
        return NextResponse.json({ error: 'ZIP 中未找到 SKILL.md 文件' }, { status: 400 });
      }
      content = await skillFile.async('string');
    } else if (fileName.endsWith('.md')) {
      content = await file.text();
    } else {
      return NextResponse.json({ error: '文件格式不支持，请上传 ZIP 或 .md 文件' }, { status: 400 });
    }

    content = content.replace(/^---\s*\n([\s\S]*?)\n---\s*\n/, '');

    const productTagIds: string[] = productTagIdsStr ? JSON.parse(productTagIdsStr) : [];

    await prisma.skill.update({
      where: { id },
      data: { isLatest: false },
    });

    const newVersion = skill.version + 1;
    const updatedSkill = await prisma.skill.create({
      data: {
        id: generateId('skill'),
        name: skillName || skill.name,
        displayName: skillDisplayName || skill.displayName,
        description: skillDescription || skill.description,
        categoryId,
        vulnerabilityTreeId: vulnerabilityTreeIdInt,
        content,
        userId: skill.userId,
        tenantId: skill.tenantId,
        isPublic: isPublic === 'true' ? true : skill.isPublic,
        isBuiltin: skill.isBuiltin,
        version: newVersion,
        parentId: id,
        isLatest: true,
        updatedAt: new Date(),
      },
    });

    await prisma.skillProductTag.deleteMany({ where: { skillId: id } });
    if (productTagIds.length > 0) {
      await prisma.skillProductTag.createMany({
        data: productTagIds.map((tagId) => ({
          id: generateId('spt'),
          skillId: updatedSkill.id,
          productTagId: tagId,
        })),
      });
    }

    await prisma.skillEvolution.create({
      data: {
        id: generateId('skev'),
        skillId: updatedSkill.id,
        toVersion: newVersion,
        fromVersion: skill.version,
        changeType: 'full_replace',
        changeDesc: '文件完全替换',
        beforeData: skill.content,
        afterData: content,
        reason: '通过上传文件完全替换',
        createdAt: new Date(),
      },
    });

    const template = await getSkillOutputTemplate();
    await saveSkillToDisk(updatedSkill, template);

    await gitSkillSync.updateSkillFile(updatedSkill.name, 'SKILL.md', content);

    logger.info(LOG_MODULES.SKILL, `Skill 完全替换成功: ${updatedSkill.name}`, { 
      userId: payload.userId, 
      skillId: updatedSkill.id,
      fromVersion: skill.version,
      toVersion: newVersion
    });

    return NextResponse.json({ 
      skill: updatedSkill,
      message: 'Skill 已完全替换'
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, 'Skill 完全替换错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}