import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOrCreateServer } from '@/lib/server-manager';

// 询问评估进展
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

    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            config: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '未找到评估会话' }, { status: 404 });
    }

    if (evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    if (evaluation.status !== 'running') {
      return NextResponse.json({ error: '只有运行中的会话才能询问进展' }, { status: 400 });
    }

    if (!evaluation.opencodeSessionId) {
      return NextResponse.json({ error: '该评估会话没有关联的 AI 会话' }, { status: 400 });
    }

    // 获取或创建 OpenCode 服务器
    console.log('[Ask Progress] Getting or creating server for evaluation:', evaluation.id);
    const server = await getOrCreateServer(evaluation.id);

    // 初始化 SDK
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: server.url });

    // 获取模型配置
    const modelStr = evaluation.project.config?.modelPreferences || 'openai/gpt-4';
    const [providerID, modelID] = modelStr.split('/');

    // 发送询问进展的消息
    console.log('[Ask Progress] Sending progress inquiry to session:', evaluation.opencodeSessionId);
    const promptResult = await client.session.prompt({
      path: { id: evaluation.opencodeSessionId },
      body: {
        model: { providerID: providerID || 'openai', modelID: modelID || 'gpt-4' },
        parts: [{ type: 'text' as const, text: '同意你的要求，请继续并反馈当前进展。' }],
      },
    });

    if (promptResult.error) {
      console.error('[Ask Progress] Failed to send prompt:', promptResult.error);
      return NextResponse.json({ error: '发送询问失败', details: promptResult.error }, { status: 500 });
    }

    console.log('[Ask Progress] Successfully sent progress inquiry');

    return NextResponse.json({
      message: '询问进展已发送',
      result: promptResult.data,
    });
  } catch (error) {
    console.error('Ask progress error:', error);
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
