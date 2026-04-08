/**
 * Claude 项目文件读取 API
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { readFile } from 'fs/promises';
import { stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export async function GET(
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
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ error: '缺少文件路径' }, { status: 400 });
    }

    const decodedProjectName = decodeURIComponent(projectName);
    const projectPath = decodedProjectName.replace(/-/g, '/');
    const fullPath = join(projectPath, filePath);

    // 安全检查：确保文件在项目目录内
    if (!fullPath.startsWith(projectPath)) {
      return NextResponse.json({ error: '非法路径' }, { status: 403 });
    }

    if (!existsSync(fullPath)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    const stats = await stat(fullPath);
    
    // 二进制文件检测
    const binaryExtensions = ['.exe', '.dll', '.so', '.dylib', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z', '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac', '.ttf', '.otf', '.woff', '.woff2'];
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    const isBinary = binaryExtensions.includes(ext);

    if (isBinary) {
      return NextResponse.json({
        content: null,
        size: stats.size,
        language: ext.substring(1) || 'binary',
        encoding: 'binary',
        path: filePath,
        fileName: filePath.split(/[\\/]/).pop() || filePath,
        isBinary: true,
        message: '二进制文件无法以文本形式显示',
      });
    }

    const content = await readFile(fullPath, 'utf-8');
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    
    // 根据扩展名推断语言
    const languageMap: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript',
      '.js': 'javascript', '.jsx': 'javascript',
      '.py': 'python', '.java': 'java', '.go': 'go',
      '.rs': 'rust', '.rb': 'ruby', '.php': 'php',
      '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c',
      '.css': 'css', '.scss': 'scss', '.html': 'html',
      '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
      '.md': 'markdown', '.sql': 'sql', '.sh': 'shell',
    };

    return NextResponse.json({
      content,
      size: stats.size,
      language: languageMap[ext] || 'plaintext',
      encoding: 'utf-8',
      path: filePath,
      fileName,
      isBinary: false,
    });
  } catch (error) {
    console.error('Read file error:', error);
    return NextResponse.json({ error: '读取失败' }, { status: 500 });
  }
}
