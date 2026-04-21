/**
 * Claude 项目文件浏览 API
 * 通过项目名称浏览文件
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { ProjectDiscovery } from '@/services/session-manager';
import { readdir, stat } from 'fs/promises';
import { join, extname, relative } from 'path';
import { existsSync } from 'fs';
import { logger, LOG_MODULES } from '@/lib/logger';

// 语言扩展名映射
const LANGUAGE_MAP: Record<string, string> = {
  '.js': 'JavaScript', '.jsx': 'JavaScript React',
  '.ts': 'TypeScript', '.tsx': 'TypeScript React',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS',
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
  '.py': 'Python', '.java': 'Java', '.go': 'Go',
  '.rs': 'Rust', '.sql': 'SQL', '.md': 'Markdown',
  '.sh': 'Shell', '.ps1': 'PowerShell',
};

const EXCLUDED_DIRS = [
  'node_modules', '.git', '.svn', '.next', '.nuxt',
  'dist', 'build', 'out', 'target', '__pycache__',
  'venv', '.venv', 'env', '.idea', '.vscode',
  'coverage', '.cache', 'tmp', 'temp', 'logs',
];

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  language?: string;
  children?: FileTreeNode[];
}

async function scanDirectory(
  dirPath: string,
  basePath: string,
  maxDepth: number,
  currentDepth: number
): Promise<FileTreeNode[]> {
  const result: FileTreeNode[] = [];

  if (currentDepth > maxDepth) return result;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (EXCLUDED_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;

      const fullPath = join(dirPath, entry.name);
      const relativePath = relative(basePath, fullPath);

      if (entry.isDirectory()) {
        const children = await scanDirectory(fullPath, basePath, maxDepth, currentDepth + 1);
        result.push({ name: entry.name, path: relativePath, type: 'directory', children });
      } else if (entry.isFile()) {
        const stats = await stat(fullPath);
        const ext = extname(entry.name).toLowerCase();
        result.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
          size: stats.size,
          language: LANGUAGE_MAP[ext],
        });
      }
    }
  } catch {
    // ignore
  }

  return result;
}

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
    const decodedProjectName = decodeURIComponent(projectName);
    const projectPath = decodedProjectName.replace(/-/g, '/');

    // 检查路径
    if (!existsSync(projectPath)) {
      return NextResponse.json({ files: [], projectPath, message: '路径不存在' });
    }

    // 扫描目录
    const files = await scanDirectory(projectPath, projectPath, 10, 0);

    return NextResponse.json({
      files,
      projectPath,
      projectName: projectPath.split(/[\\/]/).pop() || projectName,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.FILE, '浏览文件错误:', { details: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
