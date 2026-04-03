// src/app/api/code/[projectId]/search/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/code/:projectId/search - 搜索代码实体
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
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const type = searchParams.get('type');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    if (!query) {
      return NextResponse.json({ error: '缺少搜索关键词' }, { status: 400 });
    }

    const where: Record<string, unknown> = { projectId };
    if (type) where.entityType = type;

    // 搜索名称或签名
    const results = await prisma.codeKnowledge.findMany({
      where: {
        ...where,
        OR: [
          { name: { contains: query } },
          { signature: { contains: query } },
          { docstring: { contains: query } },
          { code: { contains: query } },
        ],
      },
      orderBy: [{ filePath: 'asc' }, { lineStart: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const total = await prisma.codeKnowledge.count({
      where: {
        ...where,
        OR: [
          { name: { contains: query } },
          { signature: { contains: query } },
          { docstring: { contains: query } },
          { code: { contains: query } },
        ],
      },
    });

    return NextResponse.json({
      results: results.map(r => ({
        ...r,
        calls: r.calls ? JSON.parse(r.calls) : null,
        calledBy: r.calledBy ? JSON.parse(r.calledBy) : null,
      })),
      query,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('搜索代码错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
