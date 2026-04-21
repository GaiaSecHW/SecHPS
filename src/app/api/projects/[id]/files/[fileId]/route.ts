import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { readFile, unlink, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { logger, LOG_MODULES } from '@/lib/logger';

// 下载项目文件
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id, fileId } = await params;

    const file = await prisma.projectFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    // 验证文件属于该项目
    if (file.projectId !== id) {
      return NextResponse.json({ error: '文件不属于此项目' }, { status: 403 });
    }

    // 检查文件是否存在
    if (!file.filePath || !existsSync(file.filePath)) {
      return NextResponse.json({ error: '物理文件不存在' }, { status: 404 });
    }

    // 读取文件内容
    const fileBuffer = await readFile(file.filePath);
    
    // 返回文件流
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': file.fileType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.fileName)}"`,
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.FILE, '下载文件错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除项目文件
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id, fileId } = await params;

    // 获取文件信息
    const file = await prisma.projectFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    // 验证文件属于该项目
    if (file.projectId !== id) {
      return NextResponse.json({ error: '文件不属于此项目' }, { status: 403 });
    }

    // 删除物理文件
    if (file.filePath && existsSync(file.filePath)) {
      try {
        await unlink(file.filePath);
      } catch (unlinkError) {
        logger.errorNoUser(LOG_MODULES.FILE, '删除物理文件失败:', { details: { error: String(unlinkError) } });
        // 继续删除数据库记录，即使物理文件删除失败
      }
    }

    // 删除数据库记录
    await prisma.projectFile.delete({
      where: { id: fileId },
    });

    return NextResponse.json({ message: '文件已删除' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.FILE, '删除文件错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
