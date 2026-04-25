/**
 * SSE 流式发送消息
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { SessionManager } from '@/services/session-manager';
import { ClaudeAgentService } from '@/services/ai/claude-agent';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Get active model config */
async function getModelConfig() {
  const m = await prisma.modelConfig.findFirst({ where: { isActive: true, isDefault: true } }) || await prisma.modelConfig.findFirst({ where: { isActive: true } });
  if (!m) return null;
  const models = JSON.parse(m.models || '[]');
  return { id: m.id, apiKey: m.apiKey, model: models[0] || 'claude-sonnet-4-20250514', contextWindow: m.contextWindow ?? 0 };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ project: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return new NextResponse('未授权', { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return new NextResponse('无效的令牌', { status: 401 });
    }

    const { project: projectName } = await params;
    const body = await request.json();
    const { message, sessionId } = body;

    if (!message) {
      return new NextResponse('消息不能为空', { status: 400 });
    }

    const decodedProjectName = decodeURIComponent(projectName);
    const projectPath = decodedProjectName.replace(/-/g, '/');

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json({ error: '模型配置不存在' }, { status: 500 });
    }

    const sessionManager = new SessionManager(projectPath);
    let currentSessionId = sessionId;

    if (!currentSessionId) {
      const newSession = await sessionManager.createSession({ cwd: projectPath });
      currentSessionId = newSession.id;
    }

    // 添加用户消息
    await sessionManager.addMessage(currentSessionId, {
      type: 'user',
      message: {
        role: 'user',
        content: message,
      },
    });

    // 创建流式响应
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const claudeAgent = new ClaudeAgentService({ cwd: projectPath });

          // 发送会话信息
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'session', session: { id: currentSessionId } })}\n\n`));

          // 使用 sendPrompt 发送消息
          await claudeAgent.sendPrompt(message, {
            onChunk: (text) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: text })}\n\n`));
            },
            onToolUse: (name, input) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool_use', toolName: name, input })}\n\n`));
            },
            onToolResult: (name, result) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool_result', toolName: name, result })}\n\n`));
            },
            onComplete: () => {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            },
            onError: (error) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`));
              controller.close();
            },
          });
        } catch (error) {
          logger.errorNoUser(LOG_MODULES.SESSION, 'SSE错误:', { details: error });
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: '处理失败' })}\n\n`));
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '发送消息错误:', { details: error });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
