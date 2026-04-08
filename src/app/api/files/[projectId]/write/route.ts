import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeFile, stat, mkdir, rename, unlink } from 'fs/promises';
import { join, extname, basename, dirname } from 'path';
import { existsSync } from 'fs';

// 最大文件大小（2MB）
const MAX_FILE_SIZE = 2 * 1024 * 1024;

// 请求体接口
interface WriteRequestBody {
  path: string;
  content: string;
  createBackup?: boolean;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // 验证认证
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, 'file:write')) {
      return NextResponse.json({ error: 'Forbidden - 需要 file:write 权限' }, { status: 403 });
    }

    // 获取项目信息
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        userId: true,
        projectPath: true,
        name: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 检查项目权限
    if (project.userId !== payload.userId) {
      const userRoles = payload.roles;
      if (!userRoles.includes('admin') && !userRoles.includes('manager')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // 检查项目路径
    if (!project.projectPath) {
      return NextResponse.json({ error: '项目未配置路径' }, { status: 400 });
    }

    // 解析请求体
    const body: WriteRequestBody = await request.json();
    const { path: filePath, content, createBackup = true } = body;

    if (!filePath) {
      return NextResponse.json({ error: '缺少文件路径参数' }, { status: 400 });
    }

    if (content === undefined || content === null) {
      return NextResponse.json({ error: '缺少文件内容' }, { status: 400 });
    }

    // 检查内容大小
    const contentSize = Buffer.byteLength(content, 'utf-8');
    if (contentSize > MAX_FILE_SIZE) {
      return NextResponse.json({
        error: `文件内容过大（最大 ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB）`,
        size: contentSize,
      }, { status: 413 });
    }

    // 安全检查：防止路径遍历攻击
    const normalizedPath = filePath.replace(/\.\./g, '').replace(/^[/\\]+/, '');
    const fullPath = join(project.projectPath, normalizedPath);

    // 确保路径在项目目录内
    if (!fullPath.startsWith(project.projectPath)) {
      return NextResponse.json({ error: '非法路径访问' }, { status: 403 });
    }

    // 检查文件是否存在
    const fileExists = existsSync(fullPath);
    let previousSize = 0;

    // 如果文件存在且需要备份
    if (fileExists && createBackup) {
      const stats = await stat(fullPath);
      previousSize = stats.size;
      
      // 创建备份文件
      const backupPath = `${fullPath}.bak`;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupWithPath = `${fullPath}.${timestamp}.bak`;
      
      // 读取原文件内容并创建备份
      const { readFile } = await import('fs/promises');
      try {
        const originalContent = await readFile(fullPath);
        await writeFile(backupWithPath, originalContent);
      } catch {
        // 如果备份失败，继续写入但记录警告
        console.warn(`Failed to create backup for ${fullPath}`);
      }
    }

    // 确保父目录存在
    const parentDir = dirname(fullPath);
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }

    // 写入文件
    await writeFile(fullPath, content, 'utf-8');

    // 获取新文件信息
    const newStats = await stat(fullPath);
    const ext = extname(fullPath).toLowerCase();
    const fileName = basename(fullPath);

    return NextResponse.json({
      success: true,
      path: normalizedPath,
      fileName,
      size: newStats.size,
      previousSize: fileExists ? previousSize : null,
      isNewFile: !fileExists,
      extension: ext,
      message: fileExists ? '文件已更新' : '文件已创建',
    });
  } catch (error) {
    console.error('Write file error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// 删除文件
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // 验证认证
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, 'file:write')) {
      return NextResponse.json({ error: 'Forbidden - 需要 file:write 权限' }, { status: 403 });
    }

    // 获取项目信息
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        userId: true,
        projectPath: true,
        name: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 检查项目权限
    if (project.userId !== payload.userId) {
      const userRoles = payload.roles;
      if (!userRoles.includes('admin') && !userRoles.includes('manager')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // 检查项目路径
    if (!project.projectPath) {
      return NextResponse.json({ error: '项目未配置路径' }, { status: 400 });
    }

    // 获取文件路径参数
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ error: '缺少文件路径参数' }, { status: 400 });
    }

    // 安全检查：防止路径遍历攻击
    const normalizedPath = filePath.replace(/\.\./g, '').replace(/^[/\\]+/, '');
    const fullPath = join(project.projectPath, normalizedPath);

    // 确保路径在项目目录内
    if (!fullPath.startsWith(project.projectPath)) {
      return NextResponse.json({ error: '非法路径访问' }, { status: 403 });
    }

    // 检查文件是否存在
    if (!existsSync(fullPath)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    // 获取文件信息
    const stats = await stat(fullPath);

    // 创建备份
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${fullPath}.${timestamp}.deleted`;
    const { readFile } = await import('fs/promises');
    try {
      const originalContent = await readFile(fullPath);
      await writeFile(backupPath, originalContent);
    } catch {
      console.warn(`Failed to create backup for deleted file ${fullPath}`);
    }

    // 删除文件
    await unlink(fullPath);

    return NextResponse.json({
      success: true,
      path: normalizedPath,
      previousSize: stats.size,
      message: '文件已删除',
    });
  } catch (error) {
    console.error('Delete file error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
