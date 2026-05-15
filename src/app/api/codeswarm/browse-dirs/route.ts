import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const inputPath = searchParams.get('path') || 'E:\\';
    
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

    return NextResponse.json({
      entries: filteredEntries,
      currentPath: normalizedPath,
      parentPath: normalizedPath.split(/[\\/]/).slice(0, -1).join('\\') || normalizedPath,
    });
  } catch (error) {
    console.error('[BrowseDirs] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error', entries: [] },
      { status: 500 }
    );
  }
}