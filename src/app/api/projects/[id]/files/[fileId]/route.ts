import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { readFile, unlink, stat } from 'fs/promises';
import { existsSync } from 'fs';

// 下载项目文件
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
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
    console.error('下载文件错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除项目文件
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
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
        console.error('删除物理文件失败:', unlinkError);
        // 继续删除数据库记录，即使物理文件删除失败
      }
    }

    // 删除数据库记录
    await prisma.projectFile.delete({
      where: { id: fileId },
    });

    return NextResponse.json({ message: '文件已删除' });
  } catch (error) {
    console.error('删除文件错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
