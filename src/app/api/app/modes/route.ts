import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/app/modes - 列出所有模式
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

    // 新 SDK 中 app.modes() 不存在，使用 app.agents() 获取可用的代理列表
    const result = await client.app.agents();
    
    if (result.error) {
      console.error('Get app agents error:', result.error);
      return NextResponse.json({ error: '获取代理列表失败', details: result.error }, { status: 500 });
    }

    // 将 agents 作为 modes 返回（代理即模式）
    return NextResponse.json({ modes: result.data });
  } catch (error) {
    console.error('Get app modes error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
