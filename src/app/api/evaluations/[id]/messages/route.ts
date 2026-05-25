// src/app/api/evaluations/[id]/messages/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { createNodeStreamStore } from '@/services/node-stream-store';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/evaluations/[id]/messages - 获取评估会话的消息列表
// 从 stream.jsonl 读取（新架构：一个 SSE 流对应一个文件）
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
    const userIsAdmin = isAdmin(payload);

    // 获取评估会话
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
    const msgProject = evaluation.projectId ? await prisma.project.findUnique({
      where: { id: evaluation.projectId },
      select: { userId: true },
    }) : null;

    // 归属校验
    if (!userIsAdmin && msgProject?.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 解析 URL 参数
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId');

    // 如果没有 nodeId，返回空（必须指定节点）
    if (!nodeId) {
      return NextResponse.json({ messages: [], source: 'stream' });
    }

    // 从 stream.jsonl 读取
    try {
      const store = createNodeStreamStore(evaluation.projectId, id);
      const events = await store.readStream(nodeId);
      
      // 格式化消息
      const messages = events.map((event, index) => ({
        id: `msg-${nodeId}-${index}`,
        role: event.event === 'user' ? 'user' :
              event.event === 'text' || event.event === 'thinking' ? 'assistant' :
              event.event === 'tool_use' ? 'tool_call' :
              event.event === 'tool_result' ? 'tool_result' :
              event.event,
        content: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
        createdAt: event.timestamp,
        workflowNodeId: nodeId,
        nodeId: nodeId,
        event: event.event,
      }));
      
      return NextResponse.json({
        messages,
        total: messages.length,
        source: 'stream',
        nodeId,
      });
    } catch (error) {
      logger.error(LOG_MODULES.EVALUATION, '从 stream.jsonl 读取错误', { details: { error: error instanceof Error ? error.message : String(error) } });
      return NextResponse.json({ messages: [], source: 'stream' });
    }
  } catch (error) {
    logger.error(LOG_MODULES.EVALUATION, '获取错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}