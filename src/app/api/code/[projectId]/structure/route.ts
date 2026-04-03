// src/app/api/code/[projectId]/structure/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/code/:projectId/structure - 获取项目结构
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { projectId } = await params;

    const structure = await prisma.projectStructure.findUnique({
      where: { projectId },
    });

    if (!structure) {
      return NextResponse.json({ error: '项目结构不存在，请先分析项目' }, { status: 404 });
    }

    return NextResponse.json({
      structure: {
        id: structure.id,
        projectId: structure.projectId,
        structure: JSON.parse(structure.structure),
        fileCount: structure.fileCount,
        codeCount: structure.codeCount,
        languageStats: JSON.parse(structure.languageStats),
        status: structure.status,
        analyzedAt: structure.analyzedAt,
        createdAt: structure.createdAt,
        updatedAt: structure.updatedAt,
      },
    });
  } catch (error) {
    console.error('获取项目结构错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
