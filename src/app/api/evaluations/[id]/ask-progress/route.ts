// src/app/api/evaluations/[id]/ask-progress/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { createClaudeAgentService, ClaudeAgentCallbacks } from '@/services/ai';
import { logger, LOG_MODULES } from '@/lib/logger';

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
    const userIsAdmin = isAdmin(payload);

    // 获取评估会话并验证所有权
    let where: any = { id };
    
    const evaluation = await prisma.evaluationSession.findFirst({
      where,
      select: {
        id: true,
        projectId: true,
        status: true,
        opencodeSessionId: true,
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // Separate query for Project
    const project = evaluation.projectId ? await prisma.project.findUnique({
      where: { id: evaluation.projectId },
      include: { ProjectFile: true, OpencodeConfig: true, User: true },
    }) : null;

    // 归属校验（管理员绕过）
    if (!userIsAdmin && project?.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    if (evaluation.status !== 'running') {
      return NextResponse.json({ error: '评估会话不在运行中' }, { status: 400 });
    }

    // 获取进展询问消息（全局配置，不区分用户）
    let progressQuestion = '';
    
    // 方法1: 从项目的关联配置中获取 progressQuestion
    if (project?.OpencodeConfig?.progressQuestion) {
      progressQuestion = project.OpencodeConfig.progressQuestion;
      logger.debug(LOG_MODULES.EVALUATION, '使用项目关联配置的进展询问消息');
    }
    
    // 方法2: 如果项目没有关联配置或配置没有 progressQuestion，从全局激活配置获取
    if (!progressQuestion || !progressQuestion.trim()) {
      try {
        // 获取全局激活配置（不按用户过滤）
        const globalConfig = await prisma.opencodeConfig.findFirst({
          where: {
            isActive: true,
          },
          select: { progressQuestion: true },
        });
        
        if (globalConfig?.progressQuestion && globalConfig.progressQuestion.trim()) {
          progressQuestion = globalConfig.progressQuestion;
          logger.debug(LOG_MODULES.EVALUATION, '使用全局激活配置的进展询问消息');
        }
      } catch (e) {
        logger.warn(LOG_MODULES.CONFIG, '获取全局配置失败:', { details: { error: String(e) } });
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
      cwd: project?.projectPath || undefined,
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
              logger.errorNoUser(LOG_MODULES.EVALUATION, '更新评估会话失败:', { details: { error: String(e) } });
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
          logger.debug(LOG_MODULES.EVALUATION, '发送询问进展消息');
          await agentService.sendPrompt(progressQuestion, callbacks);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          logger.errorNoUser(LOG_MODULES.EVALUATION, '发送失败:', { details: { error: errorMessage } });
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
    logger.errorNoUser(LOG_MODULES.EVALUATION, '询问进展错误:', { details: { error: String(error) } });
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