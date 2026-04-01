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

// 获取当前用户的项目列表
export async function GET(request: Request) {
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

    // 获取用户的项目
    const projects = await prisma.project.findMany({
      where: {
        userId: payload.userId,
      },
      include: {
        config: true,
        files: true,
        evaluations: {
          orderBy: {
            startedAt: 'desc',
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return NextResponse.json({ projects });
  } catch (error) {
    console.error('Get projects error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 创建新项目
export async function POST(request: Request) {
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
    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_CREATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 解析 FormData
    const formData = await request.formData();
    const name = formData.get('name') as string;
    const description = formData.get('description') as string | null;
    const environmentUrl = formData.get('environmentUrl') as string | null;
    const adminUsername = formData.get('adminUsername') as string | null;
    const adminPassword = formData.get('adminPassword') as string | null;
    const normalUsername = formData.get('normalUsername') as string | null;
    const normalPassword = formData.get('normalPassword') as string | null;
    const files = formData.getAll('files') as File[];

    // 验证必填字段
    if (!name) {
      return NextResponse.json({ error: '项目名称不能为空' }, { status: 400 });
    }

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

    // 获取用户的活跃配置
    const config = await prisma.opencodeConfig.findFirst({
      where: {
        userId: payload.userId,
        isActive: true,
      },
    });

    if (!config) {
      return NextResponse.json({ error: '未找到活跃的 AI4WEB 配置' }, { status: 404 });
    }

    if (!config.projectUploadDir) {
      return NextResponse.json(
        { error: '配置中未设置项目上传目录' },
        { status: 400 }
      );
    }

    // 生成项目 ID
    const projectId = crypto.randomUUID();

    // 创建项目目录
    const projectDir = join(config.projectUploadDir, projectId);
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }

    // 上传文件
    const uploadedFiles = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filePath = join(projectDir, file.name);
      writeFileSync(filePath, buffer);

      // 记录文件信息
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      uploadedFiles.push({
        fileName: file.name,
        filePath: filePath,
        fileSize: file.size,
        fileType: ext.replace('.', ''),
      });
    }

    // 在数据库中创建项目记录
    const project = await prisma.project.create({
      data: {
        userId: payload.userId,
        configId: config.id,
        name: name,
        description: description || undefined,
        projectPath: projectDir,
        status: 'idle', // 初始状态为待启动
        environmentUrl: environmentUrl || undefined,
        adminUsername: adminUsername || undefined,
        adminPassword: adminPassword || undefined,
        normalUsername: normalUsername || undefined,
        normalPassword: normalPassword || undefined,
        files: {
          create: uploadedFiles,
        },
      },
      include: {
        config: true,
        files: true,
      },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'project_create',
        resource: project.id,
        details: JSON.stringify({
          name,
          description,
          fileCount: files.length,
          projectDir,
        }),
      },
    });

    return NextResponse.json(
      {
        message: '项目创建成功',
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          projectPath: project.projectPath,
          files: project.files,
          createdAt: project.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create project error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
