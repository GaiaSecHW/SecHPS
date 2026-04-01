import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/provider/auth - 获取认证方法
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

    // 调用 SDK 获取提供商列表（包含认证信息）- 使用 provider.list() 和 provider.auth()
    const [providersResult, authResult] = await Promise.all([
      client.provider.list(),
      client.provider.auth(),
    ]);
    
    if (providersResult.error) {
      console.error('Get providers error:', providersResult.error);
      return NextResponse.json({ error: '获取提供商失败', details: providersResult.error }, { status: 500 });
    }
    
    // 提取认证相关的信息
    const providersData = providersResult.data;
    const authMethods = providersData?.all?.map(p => ({
      id: p.id,
      name: p.name,
      env: p.env,
      api: p.api,
      npm: p.npm,
    })) || [];

    return NextResponse.json({ auth: authMethods, authData: authResult.data });
  } catch (error) {
    console.error('Get provider auth error:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
