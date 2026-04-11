// src/app/api/admin/fix-paths/route.ts
// 批量修复旧项目的 WSL 路径为 Windows 路径

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// WSL 路径转 Windows 路径
function wslToWindowsPath(wslPath: string): string {
  if (!wslPath) return wslPath;
  
  // 检查是否是 WSL 路径格式 /mnt/x/...
  const wslPathRegex = /^\/mnt\/([a-z])\/(.+)$/i;
  const match = wslPath.match(wslPathRegex);
  
  if (match) {
    const drive = match[1].toUpperCase();
    const rest = match[2].replace(/\//g, '\\');
    return `${drive}:\\${rest}`;
  }
  
  return wslPath;
}

// 批量修复项目路径
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    // 获取所有项目
    const projects = await prisma.project.findMany({
      where: {
        projectPath: {
          startsWith: '/mnt/',
        },
      },
      select: {
        id: true,
        name: true,
        projectPath: true,
      },
    });

    console.log(`[Fix Paths] 找到 ${projects.length} 个需要修复的项目`);

    let updatedCount = 0;
    for (const project of projects) {
      if (project.projectPath) {
        const oldPath = project.projectPath;
        const newPath = wslToWindowsPath(oldPath);
        
        if (newPath !== oldPath) {
          await prisma.project.update({
            where: { id: project.id },
            data: { projectPath: newPath },
          });
          console.log(`[Fix Paths] ${project.name}: ${oldPath} -> ${newPath}`);
          updatedCount++;
        }
      }
    }

    return NextResponse.json({
      message: `修复完成，更新了 ${updatedCount} 个项目路径`,
      count: updatedCount,
    });
  } catch (error) {
    console.error('[Fix Paths] 错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误', details: String(error) },
      { status: 500 }
    );
  }
}

// 查询需要修复的项目数量
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const count = await prisma.project.count({
      where: {
        projectPath: {
          startsWith: '/mnt/',
        },
      },
    });

    return NextResponse.json({ count });
  } catch (error) {
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}