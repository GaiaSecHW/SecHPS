/**
 * Claude 项目文件写入 API
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ project: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { project: projectName } = await params;
    const body = await request.json();
    const { path: filePath, content, createBackup = false } = body;

    if (!filePath) {
      return NextResponse.json({ error: '缺少文件路径' }, { status: 400 });
    }

    if (content === undefined) {
      return NextResponse.json({ error: '缺少文件内容' }, { status: 400 });
    }

    const decodedProjectName = decodeURIComponent(projectName);
    const projectPath = decodedProjectName.replace(/-/g, '/');
    const fullPath = join(projectPath, filePath);

    // 安全检查：确保文件在项目目录内
    if (!fullPath.startsWith(projectPath)) {
      return NextResponse.json({ error: '非法路径' }, { status: 403 });
    }

    // 如果启用备份且文件存在，则创建备份
    if (createBackup && existsSync(fullPath)) {
      const backupPath = `${fullPath}.backup`;
      const fs = await import('fs/promises');
      await fs.copyFile(fullPath, backupPath);
    }

    // 确保目录存在
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf(/[\\/]/.test(fullPath) ? fullPath.match(/[\\/]/)?.[0] || '/' : '/'));
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
    }

    // 写入文件
    await writeFile(fullPath, content, 'utf-8');

    return NextResponse.json({
      success: true,
      path: filePath,
      size: content.length,
    });
  } catch (error) {
    console.error('Write file error:', error);
    return NextResponse.json({ error: '写入失败' }, { status: 500 });
  }
}
