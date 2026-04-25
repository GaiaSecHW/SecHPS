/**
 * 发送消息到 Claude 会话
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { SessionManager } from '@/services/session-manager';
import { ClaudeAgentService } from '@/services/ai/claude-agent';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

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
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { project: projectName } = await params;
    const body = await request.json();
    const { message, sessionId } = body;

    if (!message) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    const decodedProjectName = decodeURIComponent(projectName);
    const projectPath = decodedProjectName.replace(/-/g, '/');

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json({ error: '模型配置不存在' }, { status: 500 });
    }

    const sessionManager = new SessionManager(projectPath);
    const claudeAgent = new ClaudeAgentService({
      cwd: projectPath,
      apiKey: modelConfig.apiKey,
      model: modelConfig.model,
      contextWindow: modelConfig.contextWindow,
    });

    let currentSessionId = sessionId;

    if (!currentSessionId) {
      const newSession = await sessionManager.createSession({ cwd: projectPath });
      currentSessionId = newSession.id;
    }

    await sessionManager.addMessage(currentSessionId, {
      type: 'user',
      message: {
        role: 'user',
        content: message,
      },
    });

    const response = await claudeAgent.sendMessage(message, currentSessionId);

    return NextResponse.json({
      sessionId: currentSessionId,
      response: response,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '发送消息错误:', { details: error });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
