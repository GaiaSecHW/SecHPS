/**
 * 会话元数据 API
 * 获取和更新项目的会话统计信息
 */

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取会话元数据
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 查询会话元数据
    let sessionMeta = await prisma.sessionMeta.findUnique({
      where: { projectId: id },
    });

    // 如果不存在，创建并计算初始统计
    if (!sessionMeta) {
      // 计算各提供者的会话数
      const sessions = await prisma.evaluationSession.findMany({
        where: { projectId: id },
        select: { provider: true, status: true },
      });

      const claudeCount = sessions.filter(s => s.provider === 'claude').length;
      const cursorCount = sessions.filter(s => s.provider === 'cursor').length;
      const codexCount = sessions.filter(s => s.provider === 'codex').length;
      const geminiCount = sessions.filter(s => s.provider === 'gemini').length;
      
      const runningCount = sessions.filter(s => s.status === 'running').length;
      const completedCount = sessions.filter(s => s.status === 'completed').length;
      const failedCount = sessions.filter(s => s.status === 'failed').length;

      sessionMeta = await prisma.sessionMeta.create({
        data: {
          id: generateId('meta'),
          projectId: id,
          total: sessions.length,
          hasMore: false,
          claudeCount,
          cursorCount,
          codexCount,
          geminiCount,
          runningCount,
          completedCount,
          failedCount,
          updatedAt: new Date(),
        },
      });
    }

    return NextResponse.json(sessionMeta);
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '获取会话元数据错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新会话元数据
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 重新计算会话统计
    const sessions = await prisma.evaluationSession.findMany({
      where: { projectId: id },
      select: { provider: true, status: true },
    });

    const claudeCount = sessions.filter(s => s.provider === 'claude').length;
    const cursorCount = sessions.filter(s => s.provider === 'cursor').length;
    const codexCount = sessions.filter(s => s.provider === 'codex').length;
    const geminiCount = sessions.filter(s => s.provider === 'gemini').length;
    
    const runningCount = sessions.filter(s => s.status === 'running').length;
    const completedCount = sessions.filter(s => s.status === 'completed').length;
    const failedCount = sessions.filter(s => s.status === 'failed').length;

    const sessionMeta = await prisma.sessionMeta.upsert({
      where: { projectId: id },
      update: {
        total: sessions.length,
        claudeCount,
        cursorCount,
        codexCount,
        geminiCount,
        runningCount,
        completedCount,
        failedCount,
      },
      create: {
        id: generateId('meta'),
        projectId: id,
        total: sessions.length,
        hasMore: false,
        claudeCount,
        cursorCount,
        codexCount,
        geminiCount,
        runningCount,
        completedCount,
        failedCount,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(sessionMeta);
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '更新会话元数据错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
