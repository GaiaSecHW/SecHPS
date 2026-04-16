import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * POST /api/skills/predict
 * 保存 Skill 预测结果
 */
export async function POST(request: Request) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    const body = await request.json();
    const { taskName, taskDescription, matches, method } = body;

    // 验证必填字段
    if (!taskName || !taskDescription || !matches) {
      return NextResponse.json(
        { details: { error: '缺少必填字段：taskName, taskDescription, matches' } },
        { status: 400 }
      );
    }

    // 保存预测结果
    const prediction = await prisma.skillPrediction.create({
      data: {
        id: `pred-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: payload.userId,
        taskName,
        taskDescription,
        matches: JSON.stringify(matches),
        method: method || 'keyword',
        matchCount: Array.isArray(matches) ? matches.length : 0,
      },
    });

    return NextResponse.json({ prediction }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '保存 Skill 预测失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { details: { error: '服务器内部错误' } },
      { status: 500 }
    );
  }
}

/**
 * GET /api/skills/predict
 * 查询预测历史
 */
export async function GET(request: Request) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // 构建查询条件
    const where: any = { userId: payload.userId };

    // 查询预测记录
    const predictions = await prisma.skillPrediction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        taskName: true,
        taskDescription: true,
        matches: true,
        method: true,
        matchCount: true,
        createdAt: true,
      },
    });

    // 格式化返回数据
    const formattedPredictions = predictions.map(p => ({
      id: p.id,
      taskName: p.taskName,
      taskDescription: p.taskDescription,
      matches: JSON.parse(p.matches),
      method: p.method,
      matchCount: p.matchCount,
      createdAt: p.createdAt,
    }));

    return NextResponse.json({ predictions: formattedPredictions });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '查询 Skill 预测失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { details: { error: '服务器内部错误' } },
      { status: 500 }
    );
  }
}
