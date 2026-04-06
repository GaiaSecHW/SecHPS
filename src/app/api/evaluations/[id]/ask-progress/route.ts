// src/app/api/evaluations/[id]/ask-progress/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { createClaudeAgentService, ClaudeAgentCallbacks } from '@/services/ai';
import { SessionManager } from '@/services/session-manager';

// POST /api/evaluations/[id]/ask-progress - 询问评估进展
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

    // 获取评估会话
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        project: {
          include: { files: true, config: true },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    if (evaluation.status !== 'running') {
      return NextResponse.json({ error: '评估会话不在运行中' }, { status: 400 });
    }

    // 获取用户的配置中的进展询问消息
    let progressQuestion = '';
    
    // 尝试从用户的 OpencodeConfig 中获取 progressQuestion
    if (evaluation.project?.configId) {
      try {
        const userConfig = await prisma.opencodeConfig.findUnique({
          where: { id: evaluation.project.configId },
          select: { progressQuestion: true },
        });
        
        if (userConfig?.progressQuestion && userConfig.progressQuestion.trim()) {
          progressQuestion = userConfig.progressQuestion;
          console.log('[AskProgress] 使用用户配置的进展询问消息');
        }
      } catch (e) {
        console.warn('获取用户配置失败:', e);
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

    // 获取会话历史（从 JSONL 文件）
    let historyMessages: string[] = [];
    const sessionId = evaluation.opencodeSessionId || id;
    
    if (evaluation.project?.projectPath) {
      try {
        const sessionManager = new SessionManager(evaluation.project.projectPath);
        const result = await sessionManager.getSessionMessages(sessionId, 100, 0);
        
        // 将消息转换为 prompt 格式
        historyMessages = result.messages.map(msg => {
          if (msg.type === 'tool_use') {
            return `[工具调用: ${msg.tool_name}]\n${JSON.stringify(msg.tool_input, null, 2)}`;
          } else if (msg.type === 'tool_result') {
            return `[工具结果: ${msg.tool_name}]\n${JSON.stringify(msg.tool_result, null, 2)}`;
          } else if (msg.message?.content) {
            const content = typeof msg.message.content === 'string' 
              ? msg.message.content 
              : JSON.stringify(msg.message.content);
            const role = msg.message.role === 'assistant' ? 'Assistant' : 'Human';
            return `${role}: ${content}`;
          }
          return '';
        }).filter(Boolean);
      } catch (error) {
        console.warn('从 JSONL 获取历史消息失败:', error);
      }
    }

    // 添加进展询问消息
    historyMessages.push(`Human: ${progressQuestion}`);

    // 创建 Claude Agent 服务
    const agentService = createClaudeAgentService({
      apiKey: modelConfig.apiKey,
      model: modelConfig.model,
      baseUrl: modelConfig.baseUrl, // CCR 代理地址
      maxTokens: 4096,
      cwd: evaluation.project?.projectPath || undefined,
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash'],
      resumeSession: evaluation.opencodeSessionId || undefined, // 尝试恢复会话
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
          // 将历史消息连接成完整的 prompt
          const prompt = historyMessages.join('\n\n');
          console.log('[AskProgress] 发送询问进展，消息数量:', historyMessages.length);
          await agentService.sendPrompt(prompt, callbacks);
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
