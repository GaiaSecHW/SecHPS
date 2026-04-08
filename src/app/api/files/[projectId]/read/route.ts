import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readFile, stat } from 'fs/promises';
import { join, extname, basename } from 'path';
import { existsSync } from 'fs';

// 语言扩展名映射
const LANGUAGE_MAP: Record<string, string> = {
  '.js': 'JavaScript',
  '.jsx': 'JavaScript React',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript React',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.xml': 'XML',
  '.toml': 'TOML',
  '.ini': 'INI',
  '.env': 'Environment',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.go': 'Go',
  '.rs': 'Rust',
  '.c': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.h': 'C/C++ Header',
  '.hpp': 'C++ Header',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.scala': 'Scala',
  '.lua': 'Lua',
  '.r': 'R',
  '.sh': 'Shell',
  '.bash': 'Bash',
  '.zsh': 'Zsh',
  '.ps1': 'PowerShell',
  '.bat': 'Batch',
  '.cmd': 'Batch',
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.rst': 'reStructuredText',
  '.txt': 'Plain Text',
  '.sql': 'SQL',
  '.prisma': 'Prisma',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
};

// 二进制文件扩展名
const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.a', '.lib',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flv', '.wmv',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.jar', '.war', '.ear', '.class',
  '.pyc', '.pyo', '.o', '.obj',
  '.db', '.sqlite', '.sqlite3',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

// 最大文件大小（1MB）
const MAX_FILE_SIZE = 1024 * 1024;

// 编码检测
function detectEncoding(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'UTF-8 with BOM';
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return 'UTF-16 LE';
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return 'UTF-16 BE';
  }
  return 'UTF-8';
}

// 检查是否为二进制文件
function isBinaryFile(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // 验证认证
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, 'file:read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 获取项目信息
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        userId: true,
        projectPath: true,
        name: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 检查项目权限
    if (project.userId !== payload.userId) {
      const userRoles = payload.roles;
      if (!userRoles.includes('admin') && !userRoles.includes('manager')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // 检查项目路径
    if (!project.projectPath) {
      return NextResponse.json({ error: '项目未配置路径' }, { status: 400 });
    }

    // 获取文件路径参数
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ error: '缺少文件路径参数' }, { status: 400 });
    }

    // 安全检查：防止路径遍历攻击
    const normalizedPath = filePath.replace(/\.\./g, '').replace(/^[/\\]+/, '');
    const fullPath = join(project.projectPath, normalizedPath);

    // 确保路径在项目目录内
    if (!fullPath.startsWith(project.projectPath)) {
      return NextResponse.json({ error: '非法路径访问' }, { status: 403 });
    }

    // 检查文件是否存在
    if (!existsSync(fullPath)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    // 获取文件信息
    const stats = await stat(fullPath);

    if (!stats.isFile()) {
      return NextResponse.json({ error: '不是文件' }, { status: 400 });
    }

    // 检查文件大小
    if (stats.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        error: `文件过大（最大 ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB）`,
        size: stats.size,
        path: normalizedPath,
      }, { status: 413 });
    }

    const ext = extname(fullPath).toLowerCase();
    const fileName = basename(fullPath);
    const language = LANGUAGE_MAP[ext] || 'Unknown';

    // 检查是否为二进制文件
    if (isBinaryFile(ext)) {
      return NextResponse.json({
        content: null,
        size: stats.size,
        language,
        encoding: 'binary',
        path: normalizedPath,
        fileName,
        isBinary: true,
        message: '二进制文件，无法以文本形式显示',
      });
    }

    // 读取文件内容
    const buffer = await readFile(fullPath);
    const encoding = detectEncoding(buffer);

    // 尝试解码为文本
    let content: string;
    try {
      content = buffer.toString('utf-8');
    } catch {
      return NextResponse.json({
        content: null,
        size: stats.size,
        language,
        encoding: 'binary',
        path: normalizedPath,
        fileName,
        isBinary: true,
        message: '无法解码为文本',
      });
    }

    return NextResponse.json({
      content,
      size: stats.size,
      language,
      encoding,
      path: normalizedPath,
      fileName,
      isBinary: false,
    });
  } catch (error) {
    console.error('Read file error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
