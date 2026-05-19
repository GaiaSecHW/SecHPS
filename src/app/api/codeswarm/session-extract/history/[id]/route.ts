import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const history = await prisma.sessionExtractHistory.findUnique({
      where: { id },
    });

    if (!history) {
      return NextResponse.json({ error: '历史记录不存在' }, { status: 404 });
    }

    return NextResponse.json(history);
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '获取历史详情失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '获取历史失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await prisma.sessionExtractHistory.delete({
      where: { id },
    });

    logger.logNoUser(LOG_MODULES.SESSION, '删除 Session 解析历史', { id });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '删除历史失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '删除历史失败' }, { status: 500 });
  }
}