import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { rm, stat } from 'fs/promises';

// 获取单个项目详情
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

    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        files: {
          orderBy: { uploadedAt: 'desc' },
        },
        evaluations: {
          orderBy: { startedAt: 'desc' },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch (error) {
    console.error('获取项目详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新项目
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

    const { id } = await params;
    const body = await request.json();

    const project = await prisma.project.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description,
        techStack: body.techStack,
      },
    });

    return NextResponse.json({ project });
  } catch (error) {
    console.error('更新项目错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 部分更新项目（PATCH）
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

    const { id } = await params;
    const body = await request.json();

    // 构建更新数据
    const updateData: any = {};
    
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.techStack !== undefined) updateData.techStack = body.techStack;
    if (body.environmentUrl !== undefined) updateData.environmentUrl = body.environmentUrl;
    if (body.adminUsername !== undefined) updateData.adminUsername = body.adminUsername;
    if (body.adminPassword !== undefined) updateData.adminPassword = body.adminPassword;
    if (body.normalUsername !== undefined) updateData.normalUsername = body.normalUsername;
    if (body.normalPassword !== undefined) updateData.normalPassword = body.normalPassword;

    const project = await prisma.project.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ project });
  } catch (error) {
    console.error('更新项目错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除项目
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

    const { id } = await params;

    // 获取项目信息（包括文件和评估会话）
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        files: true,
        evaluations: true,
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
        console.warn(`项目目录不存在或无法删除: ${project.projectPath}`, err);
      }
    }

    // 删除数据库记录（使用事务确保一致性）
    await prisma.$transaction(async (tx) => {
      // 删除文件记录
      if (project.files.length > 0) {
        await tx.projectFile.deleteMany({
          where: { projectId: id },
        });
      }

      // 删除评估会话（会级联删除 SessionMessage）
      if (project.evaluations.length > 0) {
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
    console.error('删除项目错误:', error);
    return NextResponse.json({ error: '服务器内部错误', details: String(error) }, { status: 500 });
  }
}
