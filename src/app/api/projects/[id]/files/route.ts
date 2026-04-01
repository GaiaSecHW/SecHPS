import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// 支持的文件类型
const ALLOWED_FILE_TYPES = [
  // 压缩包格式
  '.zip', '.jar', '.war', '.ear', '.tar', '.gz', '.rar', '.7z',
  // 文档格式
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
  // 其他常见格式
  '.md', '.csv', '.json', '.xml', '.yaml', '.yml'
];
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

// 获取项目文件列表
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

    return NextResponse.json({ files: project.files });
  } catch (error) {
    console.error('Get files error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 上传新文件
export async function POST(
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
      include: {
        config: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: '未找到项目' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 解析 FormData
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: '请至少上传一个文件' }, { status: 400 });
    }

    // 验证文件类型和大小
    for (const file of files) {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!ALLOWED_FILE_TYPES.includes(ext)) {
        return NextResponse.json(
          { error: `不支持的文件类型: ${ext}。支持的类型: ${ALLOWED_FILE_TYPES.join(', ')}` },
          { status: 400 }
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `文件 ${file.name} 超过大小限制 (最大 5GB)` },
          { status: 400 }
        );
      }
    }

    // 获取项目目录
    if (!project.projectPath) {
      return NextResponse.json({ error: '项目目录未设置' }, { status: 400 });
    }

    // 确保项目目录存在
    if (!existsSync(project.projectPath)) {
      mkdirSync(project.projectPath, { recursive: true });
    }

    // 上传文件
    const uploadedFiles = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filePath = join(project.projectPath, file.name);
      writeFileSync(filePath, buffer);

      // 记录文件信息
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      const projectFile = await prisma.projectFile.create({
        data: {
          projectId: project.id,
          fileName: file.name,
          filePath: filePath,
          fileSize: file.size,
          fileType: ext.replace('.', ''),
        },
      });
      uploadedFiles.push(projectFile);
    }

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'project_file_upload',
        resource: project.id,
        details: JSON.stringify({
          fileCount: files.length,
          files: files.map(f => f.name),
        }),
      },
    });

    return NextResponse.json({
      message: '文件上传成功',
      files: uploadedFiles,
    });
  } catch (error) {
    console.error('Upload files error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
