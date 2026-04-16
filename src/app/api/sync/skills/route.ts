// src/app/api/sync/skills/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { copySkillsToProject, syncAllSkillsToDisk, ensureSkillsDataDir } from '@/services/skill-files';
import { logger, LOG_MODULES } from '@/lib/logger';

interface SyncRequest {
  projectId?: string;
  action?: 'copy' | 'sync'; // copy: 拷贝到项目, sync: 从数据库同步到磁盘
}

export async function POST(request: NextRequest) {
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
    const { projectId, action = 'sync' } = body;

    // 同步数据库到磁盘
    if (action === 'sync') {
      logger.debug(LOG_MODULES.SKILL, '开始从数据库同步 Skills 到磁盘');
      
      // 获取系统配置中的标准输出模板
      const config = await prisma.opencodeConfig.findFirst({
        where: { isActive: true },
      });
      
      // 强制从数据库同步到磁盘
      const result = await syncAllSkillsToDisk(config?.skillOutputTemplate || undefined);
      
      const total = result.success + result.failed;
      
      logger.logNoUser(LOG_MODULES.SKILL, '同步完成', { details: { total, success: result.success, failed: result.failed } });
      
      return NextResponse.json({
        message: 'Skills 同步成功',
        total,
        success: result.success,
        failed: result.failed,
        errors: result.errors,
      });
    }

    // 拷贝到项目
    if (!projectId) {
      return NextResponse.json({ error: '缺少项目 ID' }, { status: 400 });
    }

    // 获取项目
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    if (!project.projectPath) {
      return NextResponse.json({ error: '项目路径未配置' }, { status: 400 });
    }

    // 解析项目技术栈
    let projectTechStack: string[] | null = null;
    if (project.techStack) {
      try {
        projectTechStack = JSON.parse(project.techStack);
        logger.debug(LOG_MODULES.SKILL, '项目技术栈', { details: projectTechStack?.join(', ') || '无' });
      } catch {
        logger.warn(LOG_MODULES.SKILL, '项目技术栈解析失败，将拷贝所有 Skills', { details: projectId });
        projectTechStack = null;
      }
    }

    // 获取系统配置中的标准输出模板
    const config = await prisma.opencodeConfig.findFirst({
      where: { isActive: true },
    });

    // 直接从磁盘拷贝 Skills（带技术栈过滤）
    const result = await copySkillsToProject(
      project.projectPath,
      payload.userId,
      config?.skillOutputTemplate || undefined,
      projectTechStack
    );

    logger.logNoUser(LOG_MODULES.SKILL, '同步完成', { details: { success: result.success, failed: result.failed, copiedSkills: result.copiedSkills.join(', ') } });

    return NextResponse.json({
      message: 'Skills 同步成功',
      success: result.success,
      failed: result.failed,
      errors: result.errors,
      copiedSkills: result.copiedSkills,
      projectTechStack: projectTechStack,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '同步失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
