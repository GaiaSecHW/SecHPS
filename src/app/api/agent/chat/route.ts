// src/app/api/agent/chat/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { createEvaluationCaller } from '@/services/evaluation';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/agent/chat - 与 Agent 对话
export async function POST(request: Request) {
  try {
    // Authenticate and check permission
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_CHAT });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload } = auth;

    const body = await request.json();
    const { executionId, message } = body;

    if (!executionId || !message) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 获取执行记录
    const execution = await prisma.skillExecution.findUnique({
      where: { id: executionId },
      include: {
        Project: {
          include: { ProjectFile: true, OpencodeConfig: true },
        },
      },
    });

    if (!execution) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    if (execution.status !== 'completed') {
      return NextResponse.json({ error: '执行未完成，无法继续对话' }, { status: 400 });
    }

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json({ error: '模型配置不存在' }, { status: 500 });
    }

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        // 创建评估调用器，传递项目目录作为工作目录
        const caller = createEvaluationCaller(modelConfig, execution.Project?.projectPath || undefined);
        const project = execution.Project;

        try {
          await caller.continueConversation(executionId, message, {
            projectName: project.name,
            projectDescription: project.description || undefined,
            environmentUrl: project.environmentUrl || undefined,
            files: project.ProjectFile.map(f => ({
              name: f.fileName,
              type: f.fileType,
              size: f.fileSize,
            })),
          }, {
            onChunk: (text) => {
              const data = JSON.stringify({
                type: 'message',
                content: text,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
            },
            onComplete: () => {
              const data = JSON.stringify({
                type: 'done',
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
            },
            onError: (error) => {
              const data = JSON.stringify({
                type: 'error',
                error: error.message,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
            },
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          const data = JSON.stringify({
            type: 'error',
            error: errorMessage,
            timestamp: Date.now(),
          });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    logger.errorNoUser(LOG_MODULES.AGENT, errorMessage, { action: 'agent-chat' });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

async function getModelConfig() {
  return prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });
}
