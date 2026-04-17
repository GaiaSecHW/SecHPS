// src/app/api/code/[projectId]/dataflow/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/code/:projectId/dataflow - 获取数据流
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

    // 验证项目所有权
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        ...(isAdmin ? {} : { userId: payload.userId }),
      },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在或无权访问' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const userInputOnly = searchParams.get('userInputOnly') === 'true';
    const sensitiveOnly = searchParams.get('sensitiveOnly') === 'true';

    const where: Record<string, unknown> = { projectId };
    if (userInputOnly) where.isUserInput = true;
    if (sensitiveOnly) where.isSensitive = true;

    const dataFlows = await prisma.dataFlow.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      dataFlows: dataFlows.map(df => ({
        ...df,
        path: JSON.parse(df.path),
      })),
      total: dataFlows.length,
    });
  } catch (error) {
    console.error('获取数据流错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
