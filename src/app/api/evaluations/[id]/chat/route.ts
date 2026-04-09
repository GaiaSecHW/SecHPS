// src/app/api/evaluations/[id]/chat/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { createEvaluationCaller } from '@/services/evaluation';
import { loadActiveSkills } from '@/services/skills';

interface ChatRequest {
  message: string;
}

export async function POST(
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
    const body: ChatRequest = await request.json();

    if (!body.message?.trim()) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    // 获取评估会话
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            files: true,
            config: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    if (evaluation.status !== 'completed') {
      return NextResponse.json({ error: '评估会话未完成，无法继续对话' }, { status: 400 });
    }

    // 构建上下文
    const project = evaluation.project;
    const files = project.files.map(f => ({
      name: f.fileName,
      type: f.fileType,
      size: f.fileSize,
    }));

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json({ error: '模型配置不存在' }, { status: 500 });
    }

    // 加载激活的 Skills
    const skills = await loadActiveSkills();
    console.log(`[Chat] 加载了 ${skills.length} 个激活的 Skills`);

    // Skill 不再包含工具定义，直接使用空数组
    const allowedTools: string[] = [];
    console.log(`[Chat] Skills 不包含工具定义，使用默认工具`);

    // 创建评估调用器，传递项目目录作为工作目录和允许的工具
    const caller = createEvaluationCaller(modelConfig, project.projectPath || undefined, allowedTools);

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await caller.continueConversation(id, body.message, {
            projectName: project.name,
            projectDescription: project.description || undefined,
            environmentUrl: project.environmentUrl || undefined,
            files,
            taskDescription: project.config?.taskDescription || undefined,
            // 添加 Skills
            skills,
            skillsContext: {
              projectPath: project.projectPath || undefined,
            },
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
    console.error('继续对话错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

async function getModelConfig() {
  return prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });
}
