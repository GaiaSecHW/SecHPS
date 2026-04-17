// src/app/api/messages/[id]/route.ts
// 数据隔离：普通用户只能查看自己项目评估的消息，管理员可以查看所有

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/messages/[id] - 获取消息详情
export async function GET(
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
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 构建查询条件
    let where: any = { id };
    if (!isAdmin) {
      // 普通用户：通过 SessionMessage.EvaluationSession.Project.userId 验证所有权
      where.EvaluationSession = { Project: { userId: payload.userId } };
    }

    // 查找消息
    const message = await prisma.sessionMessage.findFirst({
      where,
      include: {
        EvaluationSession: {
          select: {
            id: true,
            opencodeSessionId: true,
            status: true,
          },
        },
      },
    });

    if (!message) {
      return NextResponse.json({ error: '消息不存在' }, { status: 404 });
    }

    // 如果提供了 sessionId，验证消息属于该会话
    // sessionId 可能是 evaluationSession.id 或 opencodeSessionId
    if (sessionId) {
      const belongsToSession =
        message.EvaluationSession.id === sessionId ||
        (message.EvaluationSession.opencodeSessionId && message.EvaluationSession.opencodeSessionId === sessionId);

      if (!belongsToSession) {
        return NextResponse.json({ error: '消息不属于该会话' }, { status: 403 });
      }
    }

    // 解析 content（存储为 JSON 字符串）
    let parsedContent;
    try {
      parsedContent = JSON.parse(message.content);
    } catch {
      // 如果不是 JSON，作为纯文本处理
      parsedContent = [{ type: 'text', text: message.content }];
    }

    // 解析 metadata
    let parsedMetadata = null;
    if (message.metadata) {
      try {
        parsedMetadata = JSON.parse(message.metadata);
      } catch {
        parsedMetadata = message.metadata;
      }
    }

    return NextResponse.json({
      message: {
        id: message.id,
        role: message.role,
        content: parsedContent,
        metadata: parsedMetadata,
        createdAt: message.createdAt,
        session: message.EvaluationSession,
      },
    });
  } catch (error) {
    console.error('Get message error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}