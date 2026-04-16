import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { AgentExecutor, AgentExecutionContext, AgentExecutionCallbacks } from '@/lib/agent-executor';
import { logger, LOG_MODULES } from '@/lib/logger';

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

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.AGENT_EXECUTE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
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

    // 更新 Skill 引用次数
    await prisma.skill.update({
      where: { id: skillId },
      data: { referenceCount: { increment: 1 } },
    });

    // 获取项目
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { files: true },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json({ error: '模型配置不存在，请先配置 AI 模型' }, { status: 500 });
    }

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        const context: AgentExecutionContext = {
          skillId,
          projectId,
          modelConfig: {
            providerType: modelConfig.providerType,
            apiKey: modelConfig.apiKey,
            apiBaseUrl: modelConfig.apiBaseUrl,
            model: JSON.parse(modelConfig.models)[0] || 'claude-sonnet-4-20250514',
          },
        };

        const callbacks: AgentExecutionCallbacks = {
          onChunk: (text) => {
            const data = JSON.stringify({
              type: 'chunk',
              content: text,
              timestamp: Date.now(),
            });
            controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          },
          onToolCall: (tool, parameters) => {
            const data = JSON.stringify({
              type: 'tool_call',
              tool,
              parameters,
              timestamp: Date.now(),
            });
            controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          },
          onVulnerability: (vuln) => {
            const data = JSON.stringify({
              type: 'vulnerability',
              vulnerability: vuln,
              timestamp: Date.now(),
            });
            controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          },
          onComplete: (result) => {
            const data = JSON.stringify({
              type: 'done',
              result: {
                executionId: result.executionId,
                status: result.status,
                summary: result.summary,
                vulnerabilitiesCount: result.vulnerabilities.length,
                toolCalls: result.toolCalls,
                duration: result.duration,
              },
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
          const executor = new AgentExecutor(context, callbacks);
          await executor.execute();
        } catch (error) {
          const data = JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : '未知错误',
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
    logger.errorNoUser(LOG_MODULES.AGENT, errorMessage, { action: 'agent-execute' });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

async function getModelConfig() {
  return prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });
}
