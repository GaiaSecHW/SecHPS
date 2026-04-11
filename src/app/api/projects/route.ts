import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { mkdir, writeFile, readdir } from 'fs/promises';
import { join } from 'path';

// 获取项目列表
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const projects = await prisma.project.findMany({
      where,
      orderBy: {
        createdAt: 'desc',  // 按创建时间降序排列
      },
      include: {
        files: {
          orderBy: {
            uploadedAt: 'desc',
          },
        },
        evaluations: {
          orderBy: {
            startedAt: 'desc',
          },
          take: 1,
        },
        _count: {
          select: {
            vulnerabilities: {
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
      vulnerabilityCount: project._count?.vulnerabilities || 0,
    }));

    return NextResponse.json({ projects: projectsWithVulnCount });
  } catch (error) {
    console.error('获取项目列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 创建新项目
export async function POST(request: Request) {
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
      return NextResponse.json({ error: '项目名称是必需的' }, { status: 400 });
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: '请至少上传一个文件' }, { status: 400 });
    }

    // 获取系统配置中的项目上传目录
    const config = await prisma.opencodeConfig.findFirst({
      where: { isActive: true },
    });

    // 使用配置的目录或默认目录
    const uploadBaseDir = config?.projectUploadDir 
      ? config.projectUploadDir
      : join(process.cwd(), 'uploads');
    
    console.log('[Project] uploadBaseDir:', uploadBaseDir);
    
    // 创建项目目录
    const projectDir = join(uploadBaseDir, 'projects', Date.now().toString());
    console.log('[Project] projectDir:', projectDir);
    
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
        name: name.trim(),
        description: description || null,
        projectPath: projectDir,
        techStack: techStack.length > 0 ? JSON.stringify(techStack) : null,
        userId: payload.userId,
        status: 'idle',
      },
    });

    // 创建文件记录
    for (const file of savedFiles) {
      await prisma.projectFile.create({
        data: {
          projectId: project.id,
          fileName: file.name,
          filePath: file.path,
          fileSize: file.size,
          fileType: file.type,
        },
      });
    }

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error('创建项目错误:', error);
    return NextResponse.json({ error: '服务器内部错误', details: String(error) }, { status: 500 });
  }
}
