import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/config/info - 获取 Opencode 配置信息
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

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取用户的活跃配置
    const config = await prisma.opencodeConfig.findFirst({
      where: {
        userId: payload.userId,
        isActive: true,
      },
    });

    if (!config) {
      return NextResponse.json({ error: '未找到活动配置' }, { status: 404 });
    }

    // 初始化 Opencode SDK
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: config.baseURL });

    // 调用 SDK - SDK 返回 { data, error, request, response }
    const result = await client.config.get();
    
    if (result.error) {
      console.error('Get config info error:', result.error);
      return NextResponse.json({ error: '获取配置失败', details: result.error }, { status: 500 });
    }

    return NextResponse.json({ config: result.data });
  } catch (error) {
    console.error('Get config info error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
