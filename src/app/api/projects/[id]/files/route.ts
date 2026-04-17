import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

// 上传文件到项目
// 数据隔离：普通用户只能向自己的项目上传文件，管理员可以向任何项目上传
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 验证项目所有权
    let projectWhere: any = { id };
    if (!isAdmin) {
      // 普通用户：只能向自己的项目上传文件
      projectWhere.userId = payload.userId;
    }

    const project = await prisma.project.findFirst({
      where: projectWhere,
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    const formData = await request.formData();
    const files = formData.getAll('files');

    if (!files || files.length === 0) {
      return NextResponse.json({ error: '没有选择文件' }, { status: 400 });
    }

    // 获取项目目录，如果没有则创建
    let projectDir = project.projectPath;
    
    if (!projectDir) {
      // 获取系统配置中的项目上传目录
      const config = await prisma.opencodeConfig.findFirst({
        where: { isActive: true },
      });

      const uploadBaseDir = config?.projectUploadDir 
        ? config.projectUploadDir
        : join(process.cwd(), 'uploads');
      
      projectDir = join(uploadBaseDir, 'projects', project.id);
      await mkdir(projectDir, { recursive: true });
      
      // 更新项目路径
      await prisma.project.update({
        where: { id },
        data: { projectPath: projectDir },
      });
    }

    // 保存文件并创建数据库记录
    const savedFiles = [];
    for (const file of files) {
      if (file instanceof File) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = join(projectDir, file.name);
        await writeFile(filePath, buffer);
        
        // 创建文件记录
        const projectFile = await prisma.projectFile.create({
          data: {
            id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            projectId: project.id,
            fileName: file.name,
            filePath: filePath,
            fileSize: file.size,
            fileType: file.type || 'unknown',
          },
        });
        
        savedFiles.push({
          id: projectFile.id,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
        });
      }
    }

    return NextResponse.json({ 
      message: '文件上传成功',
      files: savedFiles,
      count: savedFiles.length,
    });
  } catch (error) {
    console.error('上传文件错误:', error);
    return NextResponse.json({ error: '服务器内部错误', details: String(error) }, { status: 500 });
  }
}