// src/app/api/evaluations/[id]/results/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

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

    // 权限检查
    if (!hasPermission(payload.permissions, PERMISSIONS.EVALUATION_READ)) {
      return NextResponse.json({ error: '无权限查看评估结果' }, { status: 403 });
    }

    const { id } = await params;

    // 先查询评估会话以验证归属
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    });

    if (!evaluation) {
      return NextResponse.json({ result: null });
    }

    // Separate query for Project
    const resProject = evaluation.projectId ? await prisma.project.findUnique({
      where: { id: evaluation.projectId },
      select: { userId: true },
    }) : null;

    // 归属校验
    if (resProject?.userId !== payload.userId) {
      return NextResponse.json({ error: '无权查看此评估结果' }, { status: 403 });
    }

    const result = await prisma.evaluationResult.findUnique({
      where: { evaluationId: id },
    });
 
    if (!result) {
      return NextResponse.json({ result: null });
    }
 
    // 解析 skillsUsed JSON
    const skillsUsed = result.skillsUsed ? JSON.parse(result.skillsUsed) : [];
    
    // 从 rawReport 中提取 TODO 数据
    let todos: any[] = [];
    if (result.rawReport) {
      try {
        const rawReport = JSON.parse(result.rawReport);
        
        // 尝试从不同位置提取 TODO
        if (rawReport.todos && Array.isArray(rawReport.todos)) {
          todos = rawReport.todos;
        } else if (rawReport.summary?.todos && Array.isArray(rawReport.summary.todos)) {
          todos = rawReport.summary.todos;
        } else if (rawReport.tasks && Array.isArray(rawReport.tasks)) {
          todos = rawReport.tasks;
        }
        
        logger.debug(LOG_MODULES.EVALUATION, '提取到 TODO 数量:', { details: { count: todos.length } });
      } catch (error) {
        logger.errorNoUser(LOG_MODULES.EVALUATION, '解析 rawReport 失败:', { details: { error: String(error) } });
      }
    }
 
    return NextResponse.json({
      result: {
        ...result,
        skillsUsed,
        todos, // 添加从报告中提取的 TODO
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '获取评估结果错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
