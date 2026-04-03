// src/app/api/agent/execute/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { createEvaluationCaller } from '@/services/evaluation';

// POST /api/agent/execute - 执行 Skill
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
    const { skillId, projectId, parameters } = body;

    if (!skillId || !projectId) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 获取 Skill
    const skill = await prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    if (!skill.isActive) {
      return NextResponse.json({ error: 'Skill 未启用' }, { status: 400 });
    }

    // 获取项目
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { files: true, config: true },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 创建执行记录
    const execution = await prisma.skillExecution.create({
      data: {
        skillId,
        projectId,
        input: JSON.stringify(parameters || {}),
        status: 'running',
        startedAt: new Date(),
      },
    });

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      await prisma.skillExecution.update({
        where: { id: execution.id },
        data: { status: 'failed', error: '模型配置不存在', completedAt: new Date() },
      });
      return NextResponse.json({ error: '模型配置不存在' }, { status: 500 });
    }

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        const caller = createEvaluationCaller(modelConfig);
        let fullResponse = '';

        try {
          // 构建 Prompt
          const systemPrompt = skill.systemPrompt;
          const userPrompt = skill.userPrompt
            .replace('{{filePath}}', parameters?.filePath || '')
            .replace('{{language}}', parameters?.language || 'unknown')
            .replace('{{code}}', parameters?.code || '');

          await caller.startEvaluation(execution.id, {
            projectName: project.name,
            projectDescription: project.description || undefined,
            environmentUrl: project.environmentUrl || undefined,
            files: project.files.map(f => ({
              name: f.fileName,
              type: f.fileType,
              size: f.fileSize,
            })),
            taskDescription: `System: ${systemPrompt}\n\nUser: ${userPrompt}`,
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
              await prisma.skillExecution.update({
                where: { id: execution.id },
                data: {
                  status: 'completed',
                  output: JSON.stringify({ response: fullResponse }),
                  completedAt: new Date(),
                  duration: Date.now() - execution.startedAt.getTime(),
                },
              });

              const data = JSON.stringify({
                type: 'done',
                executionId: execution.id,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
            },
            onError: async (error) => {
              await prisma.skillExecution.update({
                where: { id: execution.id },
                data: {
                  status: 'failed',
                  error: error.message,
                  completedAt: new Date(),
                },
              });

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
          await prisma.skillExecution.update({
            where: { id: execution.id },
            data: {
              status: 'failed',
              error: errorMessage,
              completedAt: new Date(),
            },
          });

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
    console.error('执行 Skill 错误:', error);
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
