import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readdir, stat } from 'fs/promises';
import { join, extname, relative } from 'path';
import { existsSync } from 'fs';

// 语言扩展名映射
const LANGUAGE_MAP: Record<string, string> = {
  // JavaScript/TypeScript
  '.js': 'JavaScript',
  '.jsx': 'JavaScript React',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript React',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  // Web
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  // Data/Config
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.xml': 'XML',
  '.toml': 'TOML',
  '.ini': 'INI',
  '.env': 'Environment',
  // Backend
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
  // Shell/Script
  '.sh': 'Shell',
  '.bash': 'Bash',
  '.zsh': 'Zsh',
  '.ps1': 'PowerShell',
  '.bat': 'Batch',
  '.cmd': 'Batch',
  // Markup/Docs
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.rst': 'reStructuredText',
  '.txt': 'Plain Text',
  '.adoc': 'AsciiDoc',
  // Database
  '.sql': 'SQL',
  '.prisma': 'Prisma',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  // Other
  '.dockerfile': 'Dockerfile',
  '.makefile': 'Makefile',
  '.cmake': 'CMake',
  '.gradle': 'Gradle',
  '.maven': 'Maven',
  '.log': 'Log',
  '.lock': 'Lock File',
};

// 排除的目录
const EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.next',
  '.nuxt',
  '.output',
  'dist',
  'build',
  'out',
  'target',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'venv',
  '.venv',
  'env',
  '.env',
  '.idea',
  '.vscode',
  '.vs',
  'coverage',
  '.nyc_output',
  '.cache',
  'tmp',
  'temp',
  '.temp',
  '.tmp',
  'logs',
  '.logs',
];

// 文件树节点接口
interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  language?: string;
  children?: FileTreeNode[];
}

// 递归扫描目录
async function scanDirectory(
  dirPath: string,
  basePath: string,
  maxDepth: number,
  currentDepth: number,
  entryCount: { count: number },
  maxEntries: number
): Promise<FileTreeNode[]> {
  const result: FileTreeNode[] = [];

  if (currentDepth > maxDepth || entryCount.count >= maxEntries) {
    return result;
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    // 排序：目录在前，文件在后，按名称排序
    const sortedEntries = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sortedEntries) {
      if (entryCount.count >= maxEntries) break;

      const fullPath = join(dirPath, entry.name);
      const relativePath = relative(basePath, fullPath);

      if (entry.isDirectory()) {
        // 排除特定目录
        if (EXCLUDED_DIRS.includes(entry.name) || entry.name.startsWith('.')) {
          continue;
        }

        entryCount.count++;
        const node: FileTreeNode = {
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children: await scanDirectory(
            fullPath,
            basePath,
            maxDepth,
            currentDepth + 1,
            entryCount,
            maxEntries
          ),
        };
        result.push(node);
      } else if (entry.isFile()) {
        entryCount.count++;
        const stats = await stat(fullPath);
        const ext = extname(entry.name).toLowerCase();
        const node: FileTreeNode = {
          name: entry.name,
          path: relativePath,
          type: 'file',
          size: stats.size,
          language: LANGUAGE_MAP[ext] || undefined,
        };
        result.push(node);
      }
    }
  } catch (error) {
    // 忽略无法访问的目录
    console.error(`Error scanning directory ${dirPath}:`, error);
  }

  return result;
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
      // 检查用户是否有管理员权限
      const userRoles = payload.roles;
      if (!userRoles.includes('admin') && !userRoles.includes('manager')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // 检查项目路径
    if (!project.projectPath) {
      return NextResponse.json({
        files: [],
        message: '项目未配置路径',
      });
    }

    const projectPath = project.projectPath;

    // 检查路径是否存在
    if (!existsSync(projectPath)) {
      return NextResponse.json({
        files: [],
        message: '项目路径不存在',
      });
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const maxDepth = parseInt(searchParams.get('depth') || '10', 10);
    const maxEntries = parseInt(searchParams.get('maxEntries') || '1000', 10);

    // 扫描目录
    const entryCount = { count: 0 };
    const files = await scanDirectory(
      projectPath,
      projectPath,
      Math.min(maxDepth, 15), // 限制最大深度
      0,
      entryCount,
      Math.min(maxEntries, 2000) // 限制最大条目数
    );

    return NextResponse.json({
      files,
      projectPath,
      projectName: project.name,
      totalEntries: entryCount.count,
      truncated: entryCount.count >= Math.min(maxEntries, 2000),
    });
  } catch (error) {
    console.error('Browse error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
