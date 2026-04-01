import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// POST /api/app/init - 初始化应用
export async function POST(request: Request) {
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
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
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

    // 新 SDK 中没有 app.init() 方法
    // 使用 config.get() 获取当前配置作为初始化状态
    const configResult = await client.config.get();
    
    if (configResult.error) {
      console.error('App init error:', configResult.error);
      return NextResponse.json({ error: '初始化失败', details: configResult.error }, { status: 500 });
    }

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'app_init',
        resource: 'app',
        details: JSON.stringify({ success: true }),
      },
    });

    return NextResponse.json({ success: true, config: configResult.data });
  } catch (error) {
    console.error('App init error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
