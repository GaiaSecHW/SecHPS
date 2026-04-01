import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { existsSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// 递归删除目录
function deleteDirectory(dirPath: string) {
  if (existsSync(dirPath)) {
    const files = readdirSync(dirPath);
    for (const file of files) {
      const filePath = join(dirPath, file);
      const stats = statSync(filePath);
      if (stats.isDirectory()) {
        deleteDirectory(filePath);
      } else {
        rmSync(filePath);
      }
    }
    rmSync(dirPath);
  }
}

// 获取项目详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取项目
    const { id } = await params;
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        config: true,
        files: true,
        evaluations: {
          orderBy: {
            startedAt: 'desc',
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: '未找到项目' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    return NextResponse.json({ project });
  } catch (error) {
    console.error('Get project error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除项目
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_DELETE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取项目
    const { id } = await params;
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        files: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: '未找到项目' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 删除项目目录和文件
    if (project.projectPath && existsSync(project.projectPath)) {
      deleteDirectory(project.projectPath);
    }

    // 删除数据库记录
    await prisma.project.delete({
      where: { id },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'project_delete',
        resource: id,
        details: JSON.stringify({
          projectPath: project.projectPath,
          fileCount: project.files.length,
        }),
      },
    });

    return NextResponse.json({ message: '项目删除成功' });
  } catch (error) {
    console.error('Delete project error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新项目信息
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取项目
    const { id } = await params;
    const project = await prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      return NextResponse.json({ error: '未找到项目' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 解析请求体
    const body = await request.json();
    const { name, description, environmentUrl, adminUsername, adminPassword, normalUsername, normalPassword } = body;

    // 更新项目
    const updatedProject = await prisma.project.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(environmentUrl !== undefined && { environmentUrl }),
        ...(adminUsername !== undefined && { adminUsername }),
        ...(adminPassword !== undefined && { adminPassword }),
        ...(normalUsername !== undefined && { normalUsername }),
        ...(normalPassword !== undefined && { normalPassword }),
      },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'project_update',
        resource: id,
        details: JSON.stringify({
          name,
          description,
        }),
      },
    });

    return NextResponse.json({
      message: '项目更新成功',
      project: updatedProject,
    });
  } catch (error) {
    console.error('Update project error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
