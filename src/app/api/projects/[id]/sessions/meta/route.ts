/**
 * 会话元数据 API
 * 获取和更新项目的会话统计信息
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// 获取会话元数据
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

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
        },
      });
    }

    return NextResponse.json(sessionMeta);
  } catch (error) {
    console.error('获取会话元数据错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新会话元数据
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

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
      },
    });

    return NextResponse.json(sessionMeta);
  } catch (error) {
    console.error('更新会话元数据错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
