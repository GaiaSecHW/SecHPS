import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant } = auth as AuthSuccessResult;
  const { id } = await context.params;

  try {
    const pipeline = await prisma.agentFlowPipeline.findUnique({
      where: { id },
      include: {
        AgentApp: {
          select: {
            id: true,
            name: true,
            engine: true,
          },
        },
      },
    });

    if (!pipeline) {
      return NextResponse.json({ error: 'Pipeline 不存在' }, { status: 404 });
    }

    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant) {
      const canAccess = pipeline.isPublic || pipeline.userId === (auth as AuthSuccessResult).payload.userId;
      if (!canAccess) {
        return NextResponse.json({ error: '无权访问此 Pipeline' }, { status: 403 });
      }
    }

    return NextResponse.json({ pipeline });
  } catch (error) {
    logger.error(LOG_MODULES.WORKFLOW, '获取 Pipeline 失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: '获取 Pipeline 失败', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { payload } = auth as AuthSuccessResult;
  const { id } = await context.params;

  try {
    const existing = await prisma.agentFlowPipeline.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Pipeline 不存在' }, { status: 404 });
    }

    if (existing.userId !== payload.userId) {
      return NextResponse.json({ error: '只有创建者可以编辑 Pipeline' }, { status: 403 });
    }

    const body = await request.json();
    const { name, nodes, edges, thumbnail } = body;

    const pipeline = await prisma.agentFlowPipeline.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(nodes !== undefined && { nodes }),
        ...(edges !== undefined && { edges }),
        ...(thumbnail !== undefined && { thumbnail }),
      },
    });

    return NextResponse.json({ pipeline });
  } catch (error) {
    logger.error(LOG_MODULES.WORKFLOW, '更新 Pipeline 失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: '更新 Pipeline 失败', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { payload } = auth as AuthSuccessResult;
  const { id } = await context.params;

  try {
    const existing = await prisma.agentFlowPipeline.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Pipeline 不存在' }, { status: 404 });
    }

    if (existing.userId !== payload.userId) {
      return NextResponse.json({ error: '只有创建者可以删除 Pipeline' }, { status: 403 });
    }

    await prisma.agentFlowPipeline.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(LOG_MODULES.WORKFLOW, '删除 Pipeline 失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: '删除 Pipeline 失败', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
