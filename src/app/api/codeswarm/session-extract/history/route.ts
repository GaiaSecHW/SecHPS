import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const history = await prisma.sessionExtractHistory.findMany({
      take: limit,
      skip: offset,
      orderBy: { extractedAt: 'desc' },
      select: {
        id: true,
        sessionId: true,
        workspacePath: true,
        summary: true,
        skillsCount: true,
        toolsCount: true,
        messageCount: true,
        lastActivity: true,
        extractedAt: true,
      },
    });

    const total = await prisma.sessionExtractHistory.count();

    return NextResponse.json({ history, total, limit, offset });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '获取历史列表失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '获取历史失败' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const result = await prisma.sessionExtractHistory.deleteMany();
    
    logger.logNoUser(LOG_MODULES.SESSION, '清空 Session 解析历史', { count: result.count });
    
    return NextResponse.json({ success: true, deleted: result.count });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '清空历史失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '清空历史失败' }, { status: 500 });
  }
}