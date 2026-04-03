// src/app/api/agent/chat/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { createEvaluationCaller } from '@/services/evaluation';

// POST /api/agent/chat - 与 Agent 对话
export async function POST(request: Request) {
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

    const body = await request.json();
    const { executionId, message } = body;

    if (!executionId || !message) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 获取执行记录
    const execution = await prisma.skillExecution.findUnique({
      where: { id: executionId },
      include: {
        project: {
          include: { files: true, config: true },
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
        const caller = createEvaluationCaller(modelConfig);
        const project = execution.project;

        try {
          await caller.continueConversation(executionId, message, {
            projectName: project.name,
            projectDescription: project.description || undefined,
            environmentUrl: project.environmentUrl || undefined,
            files: project.files.map(f => ({
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
    console.error('Agent 对话错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

async function getModelConfig() {
  const envApiKey = process.env.ANTHROPIC_API_KEY;
  const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const envModel = process.env.ANTHROPIC_MODEL;

  if (envApiKey) {
    return {
      providerType: 'claude',
      apiKey: envApiKey,
      apiBaseUrl: envBaseUrl || 'https://api.anthropic.com/v1/messages',
      models: JSON.stringify([envModel || 'claude-sonnet-4-20250514']),
    };
  }

  return prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });
}
