// src/app/api/evaluations/[id]/todos/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { createNodeStreamStore } from '@/services/node-stream-store';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/evaluations/[id]/todos - 获取评估会话的 TODO 列表
// 只从 stream.jsonl 解析 TodoWrite（不再从数据库快照读取）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params;
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId');

    const userIsAdmin = isAdmin(payload);

    // 获取评估会话（只需要 projectId 用于构建文件路径）
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { id },
      select: {
        projectId: true,
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // Separate query for Project
    const todoProject = evaluation.projectId ? await prisma.project.findUnique({
      where: { id: evaluation.projectId },
      select: { userId: true },
    }) : null;

    // 归属校验
    if (!userIsAdmin && todoProject?.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 必须指定 nodeId
    if (!nodeId) {
      return NextResponse.json({ todos: [], source: 'stream' });
    }

    // 从 stream.jsonl 解析 TodoWrite（唯一数据源）
    try {
      const store = createNodeStreamStore(evaluation.projectId, id);
      const todos = await store.getTodos(nodeId);
      
      return NextResponse.json({ todos, source: 'stream', nodeId });
    } catch (error) {
      logger.error(LOG_MODULES.EVALUATION, '从 stream.jsonl 读取错误', { details: { error: error instanceof Error ? error.message : String(error) } });
      return NextResponse.json({ todos: [], source: 'stream' });
    }
  } catch (error) {
    logger.error(LOG_MODULES.EVALUATION, '获取错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}