// src/app/api/sessions/[id]/todo/route.ts

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/sessions/[id]/todo - 获取会话的 TODO 列表
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;
    const sessionId = id;

    logger.access(LOG_MODULES.SESSION, payload, sessionId, { action: 'fetch_todos' });
    
    // 获取项目路径
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { opencodeSessionId: sessionId },
      include: {
        Project: {
          select: { projectPath: true }
        }
      }
    });

    const projectPath = evaluation?.Project?.projectPath;

    // 使用 SDK 获取消息
    const messages = await getSessionMessages(sessionId, projectPath ? { dir: projectPath } : undefined);

    logger.logNoUser(LOG_MODULES.SESSION, 'SDK returned messages', { details: { sessionId, count: messages.length } });
    
    // 从消息中查找 TodoWrite（最新的）
    let latestTodos: any[] = [];
    
    // 从后往前找最近的 TodoWrite
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as any;
      
      // 检查 message.content 数组中的 tool_use
      if (msg.message?.content && Array.isArray(msg.message.content)) {
        for (const part of msg.message.content) {
          if (part.type === 'tool_use' && part.name === 'TodoWrite' && part.input?.todos) {
            logger.logNoUser(LOG_MODULES.SESSION, 'Found TodoWrite in message', { details: { messageIndex: i, count: part.input.todos.length } });
            latestTodos = part.input.todos;
            break;
          }
        }
        if (latestTodos.length > 0) break;
      }
      
      // 兼容：检查顶层字段（旧格式）
      if (msg.type === 'tool_use' && (msg.name === 'TodoWrite' || msg.tool_name === 'TodoWrite')) {
        const todos = msg.input?.todos || msg.tool_input?.todos;
        if (todos && Array.isArray(todos)) {
          logger.logNoUser(LOG_MODULES.SESSION, 'Found TodoWrite (old format) in message', { details: { messageIndex: i, count: todos.length } });
          latestTodos = todos;
          break;
        }
      }
    }

    if (latestTodos.length > 0) {
      logger.logNoUser(LOG_MODULES.SESSION, 'Returning todos', { details: { sessionId, count: latestTodos.length } });
      return NextResponse.json({ todos: latestTodos });
    }

    logger.logNoUser(LOG_MODULES.SESSION, 'No TodoWrite found', { details: { sessionId } });
    return NextResponse.json({ todos: [] });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, 'Get todos error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
