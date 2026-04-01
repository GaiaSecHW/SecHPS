import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { existsSync, readFileSync } from 'fs';

// 下载文件
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
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

    // 获取项目和文件 ID
    const { id, fileId } = await params;

    // 获取项目
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

    // 获取文件
    const file = await prisma.projectFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      return NextResponse.json({ error: '未找到文件' }, { status: 404 });
    }

    // 检查文件是否属于当前项目
    if (file.projectId !== project.id) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 检查文件是否存在
    if (!existsSync(file.filePath)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    // 读取文件内容
    const fileBuffer = readFileSync(file.filePath);

    // 返回文件
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.fileName)}"`,
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Download file error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
