// src/app/api/projects/[id]/start/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { createEvaluationCaller } from '@/services/evaluation';

// 启动项目评估（SSE 流式响应）
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

    // 获取项目信息（包括关联的配置）
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        files: true,
        config: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    if (project.status === 'running') {
      return NextResponse.json({ error: '项目已在运行中' }, { status: 400 });
    }

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json(
        { error: '请先配置模型或设置 ANTHROPIC_API_KEY 环境变量' },
        { status: 400 }
      );
    }

    // 更新项目状态为 running
    await prisma.project.update({
      where: { id },
      data: { status: 'running' },
    });

    // 创建评估会话
    const evaluation = await prisma.evaluationSession.create({
      data: {
        projectId: id,
        status: 'running',
      },
    });

    // 创建评估调用器
    const caller = createEvaluationCaller(modelConfig);

    // 获取任务描述（来自配置管理的 taskDescription）
    const taskDescription = project.config?.taskDescription || null;

    // 构建文件列表
    const files = project.files.map(f => ({
      name: f.fileName,
      type: f.fileType,
      size: f.fileSize,
    }));

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = '';

        try {
          await caller.startEvaluation(evaluation.id, {
            projectName: project.name,
            projectDescription: project.description || undefined,
            environmentUrl: project.environmentUrl || undefined,
            files,
            taskDescription: taskDescription || undefined,
          }, {
            onChunk: (text) => {
              fullResponse += text;
              const data = JSON.stringify({
                type: 'message',
                content: text,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
            },
            onComplete: async () => {
              // 更新评估状态
              await prisma.evaluationSession.update({
                where: { id: evaluation.id },
                data: {
                  status: 'completed',
                  completedAt: new Date(),
                },
              });

              await prisma.project.update({
                where: { id },
                data: { status: 'completed' },
              });

              // 发送完成事件
              const data = JSON.stringify({
                type: 'done',
                evaluationId: evaluation.id,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
            },
            onError: async (error) => {
              console.error('[Evaluation] 错误:', error);

              // 保存错误消息
              await prisma.sessionMessage.create({
                data: {
                  evaluationSessionId: evaluation.id,
                  role: 'assistant',
                  content: `评估失败: ${error.message}`,
                },
              }).catch(err => console.error('保存错误消息失败:', err));

              // 更新状态
              await prisma.evaluationSession.update({
                where: { id: evaluation.id },
                data: {
                  status: 'failed',
                  errorMessage: error.message,
                  completedAt: new Date(),
                },
              });

              await prisma.project.update({
                where: { id },
                data: { status: 'failed' },
              });

              // 发送错误事件
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
          console.error('[Evaluation] 启动失败:', error);
          const errorMessage = error instanceof Error ? error.message : '未知错误';

          // 发送错误事件
          const data = JSON.stringify({
            type: 'error',
            error: errorMessage,
            timestamp: Date.now(),
          });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          controller.close();

          // 更新状态
          await prisma.evaluationSession.update({
            where: { id: evaluation.id },
            data: {
              status: 'failed',
              errorMessage,
              completedAt: new Date(),
            },
          });

          await prisma.project.update({
            where: { id },
            data: { status: 'failed' },
          });
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
    console.error('启动项目错误:', error);
    return NextResponse.json({ error: '服务器内部错误', details: String(error) }, { status: 500 });
  }
}

/**
 * 获取模型配置
 */
async function getModelConfig() {
  // 优先使用环境变量
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

  // 使用数据库配置
  const defaultModel = await prisma.modelConfig.findFirst({
    where: {
      isActive: true,
      isDefault: true,
    },
  });

  if (!defaultModel) {
    const firstModel = await prisma.modelConfig.findFirst({
      where: { isActive: true },
    });
    return firstModel;
  }

  return defaultModel;
}
