import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/app/providers - 获取可用的 AI 提供商和模型列表
export async function GET(request: Request) {
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

    // 获取用户的默认配置
    const config = await prisma.opencodeConfig.findFirst({
      where: {
        userId: payload.userId,
        isActive: true,
      },
    });

    if (!config) {
      return NextResponse.json(
        { error: '未找到活动 AI4WEB 配置' },
        { status: 404 }
      );
    }

    // 初始化 AI4WEB SDK
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: config.baseURL });

    // 获取提供商列表 - 使用 config.providers()
    const providers = await client.config.providers();

    return NextResponse.json({ providers });
  } catch (error) {
    console.error('Get providers error:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
