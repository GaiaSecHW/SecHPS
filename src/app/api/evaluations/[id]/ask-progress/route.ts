// src/app/api/evaluations/[id]/ask-progress/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { createClaudeAgentService, ClaudeAgentCallbacks } from '@/services/ai';

// POST /api/evaluations/[id]/ask-progress - 询问评估进展
// 数据隔离：普通用户只能询问自己项目评估的进展，管理员可以询问所有
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

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 获取评估会话并验证所有权
    let where: any = { id };
    
    const evaluation = await prisma.evaluationSession.findFirst({
      where,
      include: {
        Project: {
          include: { ProjectFile: true, OpencodeConfig: true, User: true },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 归属校验（管理员绕过）
    if (!isAdmin && evaluation.Project.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    if (evaluation.status !== 'running') {
      return NextResponse.json({ error: '评估会话不在运行中' }, { status: 400 });
    }

    // 获取用户的配置中的进展询问消息
    let progressQuestion = '';
    
    // 方法1: 从项目的关联配置中获取 progressQuestion
    if (evaluation.Project?.OpencodeConfig?.progressQuestion) {
      progressQuestion = evaluation.Project.OpencodeConfig.progressQuestion;
      console.log('[AskProgress] 使用项目关联配置的进展询问消息');
    }
    
    // 方法2: 如果项目没有关联配置或配置没有 progressQuestion，尝试从用户默认配置获取
    if (!progressQuestion || !progressQuestion.trim()) {
      try {
        // 获取用户的默认配置（isActive: true）
        const userDefaultConfig = await prisma.opencodeConfig.findFirst({
          where: {
            userId: evaluation.Project.User.id,
            isActive: true,
          },
          select: { progressQuestion: true },
        });
        
        if (userDefaultConfig?.progressQuestion && userDefaultConfig.progressQuestion.trim()) {
          progressQuestion = userDefaultConfig.progressQuestion;
          console.log('[AskProgress] 使用用户默认配置的进展询问消息');
        }
      } catch (e) {
        console.warn('获取用户默认配置失败:', e);
      }
    }

    // 如果没有配置进展询问消息，返回错误
    if (!progressQuestion || !progressQuestion.trim()) {
      return NextResponse.json({ 
        error: '未配置进展询问消息，请在系统配置中设置自定义进展询问消息' 
      }, { status: 400 });
    }

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json({ error: '模型配置不存在' }, { status: 500 });
    }

    // 创建 Claude Agent 服务
    const agentService = createClaudeAgentService({
      apiKey: modelConfig.apiKey,
      model: modelConfig.model,
      baseUrl: modelConfig.baseUrl,
      maxTokens: 4096,
      cwd: evaluation.Project?.projectPath || undefined,
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash'],
      resumeSession: evaluation.opencodeSessionId || undefined,
    });

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        const callbacks: ClaudeAgentCallbacks = {
          onChunk: (text) => {
            const data = JSON.stringify({
              type: 'message',
              content: text,
              timestamp: Date.now(),
            });
            controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          },
          onComplete: async (fullResponse) => {
            // 更新评估会话的最后活动时间
            try {
              await prisma.evaluationSession.update({
                where: { id },
                data: { lastActivity: new Date() },
              });
            } catch (e) {
              console.error('更新评估会话失败:', e);
            }

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
        };

        try {
          // 只发送配置的进展询问消息，不附加历史消息
          console.log('[AskProgress] 发送询问进展消息');
          await agentService.sendPrompt(progressQuestion, callbacks);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          console.error('[AskProgress] 发送失败:', errorMessage);
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
    console.error('Ask progress error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

async function getModelConfig() {
  // 使用数据库配置
  const defaultModel = await prisma.modelConfig.findFirst({
    where: {
      isActive: true,
      isDefault: true,
    },
  });

  if (defaultModel) {
    const models = JSON.parse(defaultModel.models || '[]');
    return {
      providerType: defaultModel.providerType,
      apiKey: defaultModel.apiKey,
      baseUrl: defaultModel.apiBaseUrl,
      model: models[0] || 'claude-sonnet-4-20250514',
    };
  }

  // 如果没有默认模型，找第一个活跃的
  const firstModel = await prisma.modelConfig.findFirst({
    where: { isActive: true },
  });

  if (firstModel) {
    const models = JSON.parse(firstModel.models || '[]');
    return {
      providerType: firstModel.providerType,
      apiKey: firstModel.apiKey,
      baseUrl: firstModel.apiBaseUrl,
      model: models[0] || 'claude-sonnet-4-20250514',
    };
  }

  return null;
}