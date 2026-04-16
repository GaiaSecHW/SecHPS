import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { mkdir, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取项目列表
export async function GET(request: Request) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PROJECT_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where: any = { userId: payload.userId };
    if (status) {
      where.status = status;
    }

    const projects = await prisma.project.findMany({
      where,
      orderBy: {
        createdAt: 'desc',  // 按创建时间降序排列
      },
      include: {
        ProjectFile: {
          orderBy: {
            uploadedAt: 'desc',
          },
        },
        EvaluationSession: {
          orderBy: {
            startedAt: 'desc',
          },
          take: 1,
        },
        _count: {
          select: {
            Vulnerability: {
              where: {
                status: { notIn: ['false-positive', 'closed'] }
              }
            }
          }
        }
      },
    });

    // 转换数据格式，添加漏洞数量
    const projectsWithVulnCount = projects.map(project => ({
      ...project,
      vulnerabilityCount: project._count?.Vulnerability || 0,
    }));

    return NextResponse.json({ projects: projectsWithVulnCount });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, '获取项目列表错误', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// 创建新项目
export async function POST(request: Request) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PROJECT_CREATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const formData = await request.formData();
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const techStackStr = formData.get('techStack') as string;
    const files = formData.getAll('files') as File[];

    // 解析技术栈（JSON 字符串）
    let techStack: string[] = [];
    if (techStackStr) {
      try {
        techStack = JSON.parse(techStackStr);
      } catch {
        // 解析失败，忽略
      }
    }

    if (!name || !name.trim()) {
      return NextResponse.json({ details: { error: '项目名称是必需的' } }, { status: 400 });
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ details: { error: '请至少上传一个文件' } }, { status: 400 });
    }

    // 获取系统配置中的项目上传目录
    const config = await prisma.opencodeConfig.findFirst({
      where: { isActive: true },
    });

    // 使用配置的目录或默认目录
    const uploadBaseDir = config?.projectUploadDir 
      ? config.projectUploadDir
      : join(process.cwd(), 'uploads');
    
    logger.debug(LOG_MODULES.PROJECT, `上传目录: ${uploadBaseDir}`, { userId: payload.userId });
    
    // 创建项目目录
    const projectDir = join(uploadBaseDir, 'projects', Date.now().toString());
    logger.debug(LOG_MODULES.PROJECT, `项目目录: ${projectDir}`, { userId: payload.userId });
    
    await mkdir(projectDir, { recursive: true });

    // 保存文件
    const savedFiles = [];
    for (const file of files) {
      if (file instanceof File) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = join(projectDir, file.name);
        await writeFile(filePath, buffer);
        savedFiles.push({
          name: file.name,
          size: file.size,
          type: file.type,
          path: filePath,
        });
      }
    }

    // 创建项目记录
    const project = await prisma.project.create({
      data: {
        id: `proj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: name.trim(),
        description: description || null,
        projectPath: projectDir,
        techStack: techStack.length > 0 ? JSON.stringify(techStack) : null,
        userId: payload.userId,
        status: 'idle',
        updatedAt: new Date(),
      },
    });

    // 创建文件记录
    for (const file of savedFiles) {
      await prisma.projectFile.create({
        data: {
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          projectId: project.id,
          fileName: file.name,
          filePath: file.path,
          fileSize: file.size,
          fileType: file.type,
        },
      });
    }

    // 继承全局默认工具权限配置
    if (config?.defaultToolPermissions) {
      try {
        const defaultPermissions = JSON.parse(config.defaultToolPermissions);
        if (Array.isArray(defaultPermissions) && defaultPermissions.length > 0) {
          for (const perm of defaultPermissions) {
            if (perm.toolPattern && perm.permission) {
              await prisma.toolPermission.create({
                data: {
                  id: `toolperm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  projectId: project.id,
                  toolPattern: perm.toolPattern,
                  permission: perm.permission,
                  description: perm.description || `继承全局默认配置`,
                  updatedAt: new Date(),
                },
              });
            }
          }
          logger.debug(LOG_MODULES.PROJECT, `已继承默认工具权限: ${defaultPermissions.length}条`, { userId: payload.userId });
        }
      } catch (err) {
        logger.warn(LOG_MODULES.PROJECT, `继承默认工具权限失败: ${err}`, { userId: payload.userId });
      }
    }

    // 记录创建成功日志
    logger.create(LOG_MODULES.PROJECT, payload, project.id, { name, techStack, files: files.length });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, `创建项目错误: ${error}`);
    return NextResponse.json({ details: { error: '服务器内部错误', details: String(error) } }, { status: 500 });
  }
}
