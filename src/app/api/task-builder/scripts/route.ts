import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import * as fs from 'fs';
import * as path from 'path';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 });
    }

    const allowedExtensions = ['.sh', '.py', '.js', '.ts'];
    const ext = path.extname(file.name).toLowerCase();
    
    if (!allowedExtensions.includes(ext)) {
      return NextResponse.json(
        { error: `不支持的文件类型，仅支持: ${allowedExtensions.join(', ')}` },
        { status: 400 }
      );
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ error: '文件大小不能超过 10MB' }, { status: 400 });
    }

    const scriptsDir = path.join(process.cwd(), 'data', 'scripts');
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true });
    }

    const filePath = path.join(scriptsDir, file.name);
    if (fs.existsSync(filePath)) {
      return NextResponse.json({ error: '同名脚本已存在' }, { status: 409 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({
      message: '脚本上传成功',
      filename: file.name,
      size: file.size,
      type: ext,
    });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '上传脚本失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '上传脚本失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  try {
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get('filename');

    if (!filename) {
      return NextResponse.json({ error: '未提供文件名' }, { status: 400 });
    }

    const scriptsDir = path.join(process.cwd(), 'data', 'scripts');
    const filePath = path.join(scriptsDir, filename);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: '脚本文件不存在' }, { status: 404 });
    }

    fs.unlinkSync(filePath);

    return NextResponse.json({ message: '脚本已删除' });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '删除脚本失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '删除脚本失败' }, { status: 500 });
  }
}