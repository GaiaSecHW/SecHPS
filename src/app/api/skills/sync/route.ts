import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/auth';
import { gitSkillSync } from '@/services/git-skill-sync';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import { saveSkillToDisk } from '@/services/skill-files';
import { getSkillOutputTemplate } from '@/lib/skill-template';
import * as fs from 'fs';
import * as path from 'path';

interface ParsedSkill {
  name: string;
  displayName: string;
  description: string;
  content: string;
  cwe?: string;
}

function parseSkillMarkdown(content: string): ParsedSkill | null {
  try {
    let name = '';
    let description = '';
    let bodyContent = content;

    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const nameMatch = frontmatter.match(/name:\s*(.+)/);
      const descMatch = frontmatter.match(/description:\s*(?:\n([\s\S]*?)\n\s*\S|$)|description:\s*(.+)/);
      
      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) {
        description = descMatch[1] ? descMatch[1].trim() : (descMatch[2] ? descMatch[2].trim() : '');
      }
      
      bodyContent = content.substring(frontmatterMatch[0].length);
    }

    const titleMatch = bodyContent.match(/^#\s+(.+)\s*\n/);
    let displayName = '';
    if (titleMatch) {
      displayName = titleMatch[1].trim();
    }

    if (!name) {
      const firstLine = bodyContent.split('\n')[0];
      name = firstLine.replace(/^#\s+/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || 'imported-skill';
    }

    if (!displayName) {
      displayName = name;
    }

    if (!description) {
      const lines = bodyContent.split('\n');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('>')) {
          description = line.substring(0, 200);
          break;
        }
      }
      if (!description) description = displayName;
    }

    const cweMatch = content.match(/CWE-(\d+)/i);
    const cwe = cweMatch ? `CWE-${cweMatch[1]}` : undefined;

    return {
      name,
      displayName,
      description,
      content,
      cwe,
    };
  } catch (e) {
    console.error('解析 Skill 文件失败:', e);
    return null;
  }
}

async function importSkillsFromGitRepo(userId: string): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}> {
  const result = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [] as string[],
  };

  const repoPath = gitSkillSync.getLocalPath();
  if (!fs.existsSync(repoPath)) {
    result.errors.push('Git 仓库目录不存在');
    return result;
  }

  const skillDirs = fs.readdirSync(repoPath).filter(item => {
    const itemPath = path.join(repoPath, item);
    return fs.statSync(itemPath).isDirectory() && 
           item !== '.git' &&
           fs.existsSync(path.join(itemPath, 'SKILL.md'));
  });

  logger.info(LOG_MODULES.SKILL, '开始导入 Git 仓库中的 Skills', { count: skillDirs.length });

  const defaultCategory = await prisma.skillCategory.findFirst();
  if (!defaultCategory) {
    result.errors.push('未找到默认分类，请先创建 Skill 分类');
    return result;
  }

  for (const skillName of skillDirs) {
    try {
      const skillPath = path.join(repoPath, skillName);
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      
      const skillContent = fs.readFileSync(skillMdPath, 'utf-8');
      const parsed = parseSkillMarkdown(skillContent);
      
      if (!parsed) {
        result.errors.push(`解析失败: ${skillName}`);
        result.skipped++;
        continue;
      }

      const existing = await prisma.skill.findFirst({
        where: {
          name: skillName,
          userId: null,
          tenantId: null,
        },
      });

      if (existing) {
        await prisma.skill.update({
          where: { id: existing.id },
          data: {
            displayName: parsed.displayName,
            description: parsed.description,
            content: skillContent,
            cwe: parsed.cwe || null,
            updatedAt: new Date(),
          },
        });
        result.updated++;
        logger.debug(LOG_MODULES.SKILL, '更新 Skill', { skillName });
      } else {
        await prisma.skill.create({
          data: {
            id: generateId('skill'),
            name: skillName,
            displayName: parsed.displayName,
            description: parsed.description,
            categoryId: defaultCategory.id,
            cwe: parsed.cwe || null,
            content: skillContent,
            userId: null,
            tenantId: null,
            isPublic: true,
            isBuiltin: false,
            version: 1,
            isLatest: true,
            updatedAt: new Date(),
          },
        });
        result.imported++;
        logger.debug(LOG_MODULES.SKILL, '导入 Skill', { skillName });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`${skillName}: ${errorMsg}`);
      result.skipped++;
      logger.errorNoUser(LOG_MODULES.SKILL, '导入 Skill 失败', { skillName, error: errorMsg });
    }
  }

  logger.info(LOG_MODULES.SKILL, 'Git 仓库 Skills 导入完成', {
    imported: result.imported,
    updated: result.updated,
    skipped: result.skipped,
    errorCount: result.errors.length,
  });

  return result;
}

async function syncToLocalDataDir(skillNames: string[]): Promise<{
  success: number;
  failed: number;
  deleted: number;
  errors: string[];
}> {
  const result = {
    success: 0,
    failed: 0,
    deleted: 0,
    errors: [] as string[],
  };

  const repoPath = gitSkillSync.getLocalPath();
  const dataDir = path.join(process.cwd(), 'data', 'skills');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const existingLocalSkills = fs.readdirSync(dataDir).filter(item => {
    const itemPath = path.join(dataDir, item);
    return fs.statSync(itemPath).isDirectory() && item !== '.git';
  });

  const skillsToDelete = existingLocalSkills.filter(name => !skillNames.includes(name));

  for (const skillName of skillsToDelete) {
    try {
      const dataSkillPath = path.join(dataDir, skillName);
      if (fs.existsSync(dataSkillPath)) {
        fs.rmSync(dataSkillPath, { recursive: true, force: true });
        result.deleted++;
        logger.info(LOG_MODULES.SKILL, '删除本地 Skill（仓库已不存在）', { skillName });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`删除本地失败: ${skillName} - ${errorMsg}`);
      result.failed++;
    }
  }

  for (const skillName of skillNames) {
    try {
      const repoSkillPath = path.join(repoPath, skillName);
      const dataSkillPath = path.join(dataDir, skillName);

      if (!fs.existsSync(repoSkillPath)) {
        result.errors.push(`Git 目录不存在: ${skillName}`);
        result.failed++;
        continue;
      }

      if (fs.existsSync(dataSkillPath)) {
        fs.rmSync(dataSkillPath, { recursive: true, force: true });
      }

      fs.mkdirSync(dataSkillPath, { recursive: true });

      const files = fs.readdirSync(repoSkillPath);
      for (const file of files) {
        const srcPath = path.join(repoSkillPath, file);
        const destPath = path.join(dataSkillPath, file);
        if (fs.statSync(srcPath).isFile()) {
          fs.copyFileSync(srcPath, destPath);
        }
      }

      result.success++;
      logger.debug(LOG_MODULES.SKILL, '同步到 data 目录', { skillName });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`${skillName}: ${errorMsg}`);
      result.failed++;
      logger.errorNoUser(LOG_MODULES.SKILL, '同步到 data 目录失败', { skillName, error: errorMsg });
    }
  }

  logger.info(LOG_MODULES.SKILL, 'data 目录同步完成', {
    success: result.success,
    failed: result.failed,
    deleted: result.deleted,
    errorCount: result.errors.length,
  });

  return result;
}

async function syncDatabaseWithRepo(repoSkillNames: string[]): Promise<{
  deleted: number;
  errors: string[];
}> {
  const result = {
    deleted: 0,
    errors: [] as string[],
  };

  const dbSkills = await prisma.skill.findMany({
    where: {
      userId: null,
      tenantId: null,
      isPublic: true,
      isLatest: true,
    },
    select: { id: true, name: true, displayName: true },
  });

  const skillsToDelete = dbSkills.filter(skill => !repoSkillNames.includes(skill.name));

  for (const skill of skillsToDelete) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.skillEvolution.deleteMany({
          where: {
            OR: [
              { skillId: skill.id },
              { Skill: { parentId: skill.id } },
            ],
          },
        });

        await tx.skill.deleteMany({
          where: { parentId: skill.id },
        });

        await tx.skillProductTag.deleteMany({
          where: { skillId: skill.id },
        });

        await tx.skill.delete({ where: { id: skill.id } });
      });

      result.deleted++;
      logger.info(LOG_MODULES.SKILL, '删除数据库中的 Skill（仓库已不存在）', { 
        skillName: skill.name, 
        skillId: skill.id 
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`${skill.name}: ${errorMsg}`);
      logger.errorNoUser(LOG_MODULES.SKILL, '删除数据库 Skill 失败', { 
        skillName: skill.name, 
        error: errorMsg 
      });
    }
  }

  logger.info(LOG_MODULES.SKILL, '数据库同步删除完成', {
    deleted: result.deleted,
    errorCount: result.errors.length,
  });

  return result;
}

export async function POST(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const isAdmin = hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE);
    if (!isAdmin) {
      return NextResponse.json(
        { error: '只有管理员可以同步 Skill 仓库' },
        { status: 403 }
      );
    }

    logger.info(LOG_MODULES.SKILL, '开始同步 Skill 仓库', { userId: payload.userId });

    const result = await gitSkillSync.syncFromRemote();

    if (result.success) {
      logger.info(LOG_MODULES.SKILL, 'Git pull 成功', { 
        userId: payload.userId, 
        message: result.message 
      });

      const localSkills = gitSkillSync.listLocalSkills();

      const dbSyncResult = await syncDatabaseWithRepo(localSkills);

      const importResult = await importSkillsFromGitRepo(payload.userId);

      const syncResult = await syncToLocalDataDir(localSkills);

      return NextResponse.json({
        success: true,
        message: `Git 同步成功: ${result.message}。DB删除: ${dbSyncResult.deleted}, 导入DB: ${importResult.imported}, 更新DB: ${importResult.updated}。本地删除: ${syncResult.deleted}, 同步: ${syncResult.success}, 失败: ${syncResult.failed}`,
        gitMessage: result.message,
        dbDeleted: dbSyncResult.deleted,
        dbDeleteErrors: dbSyncResult.errors,
        imported: importResult.imported,
        updated: importResult.updated,
        skipped: importResult.skipped,
        importErrors: importResult.errors,
        localDeleted: syncResult.deleted,
        localSyncSuccess: syncResult.success,
        localSyncFailed: syncResult.failed,
        syncErrors: syncResult.errors,
        localSkillsCount: localSkills.length,
        localSkills: localSkills.slice(0, 20),
      });
    } else {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, 'Skill 仓库同步失败', 'sync', {
        details: { error: result.message }
      });

      return NextResponse.json({
        success: false,
        error: result.message,
      }, { status: 500 });
    }
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, 'Skill 同步 API 错误', {
      details: { error: error instanceof Error ? error.message : String(error) }
    });

    return NextResponse.json({
      success: false,
      error: '服务器内部错误',
    }, { status: 500 });
  }
}