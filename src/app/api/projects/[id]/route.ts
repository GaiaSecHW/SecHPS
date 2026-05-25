import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { rm, stat } from 'fs/promises';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取单个项目详情
// 普通用户：只能查看自己的项目
// 管理员：可以查看所有项目
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PROJECT_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 构建查询条件
    let where: any = { id };
    if (!userIsAdmin) {
      // 普通用户：只能查看自己的项目
      where.userId = payload.userId;
    }

    const project = await prisma.project.findFirst({
      where,
      include: {
        ProjectFile: {
          orderBy: { uploadedAt: 'desc' },
        },
        EvaluationSession: {
          orderBy: { startedAt: 'desc' },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, '获取项目详情错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新项目
// 只能更新自己的项目，管理员可以更新所有项目
// 注意：userId 字段不允许修改（防止项目接管攻击）
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PROJECT_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 检查项目是否存在及所有权
    const existingProject = await prisma.project.findUnique({
      where: { id },
    });

    if (!existingProject) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 检查权限：只能更新自己的项目，管理员可以更新所有
    if (!userIsAdmin && existingProject.userId !== payload.userId) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    const body = await request.json();

    // 更新项目（userId 不允许修改）
    const project = await prisma.project.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description,
        techStack: body.techStack,
        // 注意：userId 不在更新字段中，防止项目接管攻击
      },
    });

    return NextResponse.json({ project });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, '更新项目错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 部分更新项目（PATCH）
// 只能更新自己的项目，管理员可以更新所有项目
// 注意：userId 字段不允许修改（防止项目接管攻击）
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PROJECT_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 检查项目是否存在及所有权
    const existingProject = await prisma.project.findUnique({
      where: { id },
    });

    if (!existingProject) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 检查权限：只能更新自己的项目，管理员可以更新所有
    if (!userIsAdmin && existingProject.userId !== payload.userId) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    const body = await request.json();

    // 构建更新数据（userId 不允许修改）
    const updateData: any = {};
    
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.techStack !== undefined) updateData.techStack = body.techStack;
    if (body.environmentUrl !== undefined) updateData.environmentUrl = body.environmentUrl;
    if (body.adminUsername !== undefined) updateData.adminUsername = body.adminUsername;
    if (body.adminPassword !== undefined) updateData.adminPassword = body.adminPassword;
    if (body.normalUsername !== undefined) updateData.normalUsername = body.normalUsername;
    if (body.normalPassword !== undefined) updateData.normalPassword = body.normalPassword;
    // 注意：userId 不在更新字段中，防止项目接管攻击

    const project = await prisma.project.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ project });
  } catch (error) {
    logger.error(LOG_MODULES.PROJECT, '更新项目错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除项目
// 只能删除自己的项目，管理员可以删除所有项目
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PROJECT_DELETE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 构建查询条件
    let where: any = { id };
    if (!userIsAdmin) {
      // 普通用户：只能删除自己的项目
      where.userId = payload.userId;
    }

    // 获取项目信息（包括文件和评估会话）
    const project = await prisma.project.findFirst({
      where,
      include: {
        ProjectFile: true,
        EvaluationSession: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 删除项目目录（如果存在）
    if (project.projectPath) {
      try {
        const dirStats = await stat(project.projectPath);
        if (dirStats.isDirectory()) {
          await rm(project.projectPath, { recursive: true, force: true });
        }
      } catch (err) {
        // 目录不存在或无法访问，忽略错误
        logger.warn(LOG_MODULES.PROJECT, '项目目录不存在或无法删除:', { details: { path: project.projectPath, error: String(err) } });
      }
    }

    // 删除数据库记录（使用事务确保一致性）
    await prisma.$transaction(async (tx) => {
      // 删除文件记录
      if (project.ProjectFile.length > 0) {
        await tx.projectFile.deleteMany({
          where: { projectId: id },
        });
      }

      // 删除评估会话（会级联删除 SessionMessage）
      if (project.EvaluationSession.length > 0) {
        await tx.evaluationSession.deleteMany({
          where: { projectId: id },
        });
      }

      // 删除项目
      await tx.project.delete({
        where: { id },
      });
    });

    return NextResponse.json({ message: '项目已删除' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, '删除项目错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误', details: String(error) }, { status: 500 });
  }
}