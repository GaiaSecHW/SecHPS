import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { logger, LOG_MODULES } from '@/lib/logger';

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface DriveInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  label?: string;
}

const isWindows = process.platform === 'win32';

function getWindowsDrives(): DriveInfo[] {
  try {
    const output = execSync('wmic logicaldisk get name,volumename', { encoding: 'utf8' });
    const lines = output.trim().split('\n').slice(1);
    const drives: DriveInfo[] = [];
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] && parts[0].match(/^[A-Z]:$/)) {
        drives.push({
          name: parts[1] ? `${parts[0]} (${parts.slice(1).join(' ')})` : parts[0],
          path: parts[0] + '\\',
          isDirectory: true,
          label: parts.slice(1).join(' ') || undefined,
        });
      }
    }
    return drives;
  } catch {
    return ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']
      .map(letter => `${letter}:\\`)
      .filter(p => fs.existsSync(p))
      .map(p => ({ name: p.replace('\\', ''), path: p, isDirectory: true }));
  }
}

function getLinuxRootDirs(): DriveInfo[] {
  const commonDirs = ['/home', '/var', '/opt', '/usr', '/tmp', '/etc', '/root', '/data', '/srv'];
  const existingDirs: DriveInfo[] = [];
  
  existingDirs.push({
    name: '/ (根目录)',
    path: '/',
    isDirectory: true,
  });
  
  for (const dir of commonDirs) {
    if (fs.existsSync(dir)) {
      existingDirs.push({
        name: dir,
        path: dir,
        isDirectory: true,
      });
    }
  }
  
  return existingDirs;
}

function getRootEntries(): DriveInfo[] {
  if (isWindows) {
    return getWindowsDrives();
  } else {
    return getLinuxRootDirs();
  }
}

function isWindowsDriveRoot(p: string): boolean {
  return /^[A-Z]:\\?$/i.test(p);
}

function isLinuxRoot(p: string): boolean {
  return p === '/';
}

function isRootPath(p: string): boolean {
  if (isWindows) {
    return isWindowsDriveRoot(p);
  } else {
    return isLinuxRoot(p);
  }
}

function normalizePath(inputPath: string): string {
  if (isWindows) {
    return inputPath.replace(/\//g, '\\');
  } else {
    return inputPath.replace(/\\/g, '/');
  }
}

function getParentPath(currentPath: string): string | null {
  if (isRootPath(currentPath)) {
    return 'root://';
  }
  
  if (isWindows) {
    const parts = currentPath.split(/[\\/]/).filter(p => p);
    if (parts.length === 1 && parts[0].match(/^[A-Z]:$/i)) {
      return 'root://';
    }
    const parent = parts.slice(0, -1).join('\\');
    return parent ? (parent.match(/^[A-Z]:$/i) ? parent + '\\' : parent) : 'root://';
  } else {
    const parts = currentPath.split('/').filter(p => p);
    if (parts.length === 0) {
      return null;
    }
    const parent = '/' + parts.slice(0, -1).join('/');
    return parent === '/' ? 'root://' : parent;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const inputPath = searchParams.get('path') || '';
    const listRoots = searchParams.get('listRoots') === 'true';
    const platform = searchParams.get('platform');
    
    if (listRoots || !inputPath || inputPath === 'root://' || inputPath === 'drives://') {
      const rootEntries = getRootEntries();
      return NextResponse.json({
        entries: rootEntries,
        currentPath: 'root://',
        parentPath: null,
        isRootList: true,
        platform: isWindows ? 'windows' : 'linux',
      });
    }
    
    const normalizedPath = normalizePath(inputPath);
    
    if (!fs.existsSync(normalizedPath)) {
      return NextResponse.json({ 
        error: '路径不存在', 
        entries: [], 
        currentPath: normalizedPath,
        platform: isWindows ? 'windows' : 'linux',
      }, { status: 400 });
    }

    const stats = fs.statSync(normalizedPath);
    if (!stats.isDirectory()) {
      return NextResponse.json({ 
        error: '不是目录', 
        entries: [], 
        currentPath: normalizedPath,
        platform: isWindows ? 'windows' : 'linux',
      }, { status: 400 });
    }

    const entries: DirEntry[] = [];
    const items = fs.readdirSync(normalizedPath, { withFileTypes: true });
    
    for (const item of items) {
      try {
        const fullPath = path.join(normalizedPath, item.name);
        entries.push({
          name: item.name,
          path: fullPath,
          isDirectory: item.isDirectory(),
        });
      } catch {
        continue;
      }
    }

    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    const filteredEntries = entries.filter(e => {
      if (e.name.startsWith('.')) return false;
      if (isWindows && e.name.startsWith('$')) return false;
      if (isWindows && e.name === 'System Volume Information') return false;
      return true;
    });

    const isRoot = isRootPath(normalizedPath);
    const parentPath = getParentPath(normalizedPath);

    return NextResponse.json({
      entries: filteredEntries,
      currentPath: normalizedPath,
      parentPath,
      isRootPath: isRoot,
      platform: isWindows ? 'windows' : 'linux',
    });
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'BrowseDirs Error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error', entries: [], platform: isWindows ? 'windows' : 'linux' },
      { status: 500 }
    );
  }
}