import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

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

function getDrives(): DriveInfo[] {
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

function isDriveRoot(p: string): boolean {
  return /^[A-Z]:\\?$/i.test(p);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const inputPath = searchParams.get('path') || '';
    const listDrives = searchParams.get('listDrives') === 'true';
    
    if (listDrives || !inputPath || inputPath === 'drives://') {
      const drives = getDrives();
      return NextResponse.json({
        entries: drives,
        currentPath: 'drives://',
        parentPath: null,
        isDrivesList: true,
      });
    }
    
    const normalizedPath = inputPath.replace(/\//g, '\\');
    
    if (!fs.existsSync(normalizedPath)) {
      return NextResponse.json({ error: '路径不存在', entries: [], currentPath: normalizedPath }, { status: 400 });
    }

    const stats = fs.statSync(normalizedPath);
    if (!stats.isDirectory()) {
      return NextResponse.json({ error: '不是目录', entries: [], currentPath: normalizedPath }, { status: 400 });
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

    const filteredEntries = entries.filter(e => 
      !e.name.startsWith('.') && 
      !e.name.startsWith('$') &&
      e.name !== 'System Volume Information'
    );

    const isRoot = isDriveRoot(normalizedPath);

    return NextResponse.json({
      entries: filteredEntries,
      currentPath: normalizedPath,
      parentPath: isRoot ? 'drives://' : (normalizedPath.split(/[\\/]/).slice(0, -1).join('\\') || normalizedPath),
      isDriveRoot: isRoot,
    });
  } catch (error) {
    console.error('[BrowseDirs] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error', entries: [] },
      { status: 500 }
    );
  }
}