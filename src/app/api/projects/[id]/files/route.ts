import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { generateId } from '@/lib/id-generator';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { logger, LOG_MODULES } from '@/lib/logger';

// 上传文件到项目
// 数据隔离：普通用户只能向自己的项目上传文件，管理员可以向任何项目上传
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 验证项目所有权
    let projectWhere: any = { id };
    if (!userIsAdmin) {
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
            id: generateId('file'),
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
    logger.errorNoUser(LOG_MODULES.FILE, '上传文件错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误', details: String(error) }, { status: 500 });
  }
}