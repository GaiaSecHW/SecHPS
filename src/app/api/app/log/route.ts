import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// POST /api/app/log - 写入日志
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

    // 解析请求体
    const body = await request.json();
    const { level, message, service, extra } = body;

    // 验证必需参数
    if (!level || !message || !service) {
      return NextResponse.json(
        { error: '缺少必填字段：level, message, service' },
        { status: 400 }
      );
    }

    // 验证 level 值
    const validLevels = ['debug', 'info', 'error', 'warn'];
    if (!validLevels.includes(level)) {
      return NextResponse.json(
        { error: '无效的 level 值，必须是：debug, info, error, warn 之一' },
        { status: 400 }
      );
    }

    // 初始化 Opencode SDK
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: config.baseURL });

    // 调用 SDK 写入日志 - 参数格式: { body: { level, message, service, extra? } }
    const result = await client.app.log({
      body: {
        level,
        message,
        service,
        ...(extra && { extra }),
      },
    });
    
    if (result.error) {
      console.error('Write log error:', result.error);
      return NextResponse.json({ error: '写入日志失败', details: result.error }, { status: 500 });
    }

    return NextResponse.json({
      message: '日志写入成功',
      success: result.data,
    });
  } catch (error) {
    console.error('Write log error:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
