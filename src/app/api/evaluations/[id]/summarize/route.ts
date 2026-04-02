import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOrCreateServer } from '@/lib/opencode-manager';

// 总结评估会话
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
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
    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取评估会话
    const { id } = await params;
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        project: true,
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '未找到评估会话' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 检查是否有 opencodeSessionId
    if (!evaluation.opencodeSessionId) {
      return NextResponse.json({ error: '该评估会话没有关联的 AI 会话' }, { status: 400 });
    }

    // 获取请求体中的 modelID 和 providerID
    const body = await request.json();
    const { modelID, providerID } = body;

    if (!modelID || !providerID) {
      return NextResponse.json({ error: '缺少 modelID 或 providerID' }, { status: 400 });
    }

    // 获取 OpenCode 客户端
    console.log('[Summarize API] Getting OpenCode client for evaluation:', evaluation.id);
    const { client } = await getOrCreateServer(evaluation.id);

    // 调用 SDK 总结会话
    const result = await client.session.summarize({
      path: { id: evaluation.opencodeSessionId },
      body: {
        providerID,
        modelID,
      },
    });
    
    if (result.error) {
      console.error('Summarize evaluation error:', result.error);
      return NextResponse.json({ error: '总结失败', details: result.error }, { status: 500 });
    }

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'evaluation_summarize',
        resource: evaluation.id,
        details: JSON.stringify({
          projectId: evaluation.projectId,
          opencodeSessionId: evaluation.opencodeSessionId,
          modelID,
          providerID,
        }),
      },
    });

    return NextResponse.json({
      message: '总结完成',
      result,
    });
  } catch (error) {
    console.error('Summarize evaluation error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
