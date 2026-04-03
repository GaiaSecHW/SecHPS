import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// 获取所有路由配置
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

    // 获取所有路由配置
    const routers = await prisma.routerConfig.findMany({
      orderBy: {
        routeType: 'asc',
      },
    });

    // 格式化返回数据
    const formattedRouters = routers.map(router => ({
      id: router.id,
      routeType: router.routeType,
      modelId: router.modelId,
      createdAt: router.createdAt,
      updatedAt: router.updatedAt,
    }));

    return NextResponse.json({ routers: formattedRouters });
  } catch (error) {
    console.error('获取路由配置错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新路由配置
export async function PUT(request: Request) {
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

    const body = await request.json();
    const { routes } = body;

    // 验证输入
    if (!routes || typeof routes !== 'object') {
      return NextResponse.json(
        { error: '缺少必填字段：routes' },
        { status: 400 }
      );
    }

    // 验证路由类型
    const validRouteTypes = ['default', 'background', 'think', 'longContext', 'webSearch'];
    for (const routeType in routes) {
      if (!validRouteTypes.includes(routeType)) {
        return NextResponse.json(
          { error: `无效的路由类型：${routeType}` },
          { status: 400 }
        );
      }

      // 验证 modelId 是否存在
      const modelId = routes[routeType];
      const model = await prisma.modelConfig.findUnique({
        where: { id: modelId },
      });

      if (!model) {
        return NextResponse.json(
          { error: `模型配置不存在：${modelId}` },
          { status: 400 }
        );
      }
    }

    // 使用事务更新路由配置
    const updatedRouters = await prisma.$transaction(async (tx) => {
      const results = [];

      for (const routeType in routes) {
        const modelId = routes[routeType];

        // 使用 upsert 更新或创建路由配置
        const router = await tx.routerConfig.upsert({
          where: { routeType },
          update: { modelId },
          create: { routeType, modelId },
        });

        results.push(router);
      }

      return results;
    });

    // 格式化返回数据
    const formattedRouters = updatedRouters.map(router => ({
      id: router.id,
      routeType: router.routeType,
      modelId: router.modelId,
      createdAt: router.createdAt,
      updatedAt: router.updatedAt,
    }));

    return NextResponse.json({ routers: formattedRouters });
  } catch (error) {
    console.error('更新路由配置错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误', details: String(error) },
      { status: 500 }
    );
  }
}
