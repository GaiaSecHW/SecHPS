// src/app/api/evaluations/[id]/start-queued/route.ts
// 启动排队评估的 API（内部调用）

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * POST /api/evaluations/[id]/start-queued
 * 启动排队等待的评估
 * 
 * 此 API 仅供内部队列处理服务调用
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  logger.debug(LOG_MODULES.EVALUATION, '收到启动请求:', { details: { evaluationId: id } });
  
  // 检查是否为内部调用（支持两种方式：X-Internal-Token 或 X-Internal-Call）
  const internalToken = request.headers.get('X-Internal-Token');
  const internalCall = request.headers.get('X-Internal-Call') === 'true';
  const isValidInternal = internalToken === process.env.INTERNAL_API_SECRET || internalCall;
  
  if (!isValidInternal) {
    logger.debug(LOG_MODULES.EVALUATION, '拒绝非内部调用');
    return NextResponse.json({ error: '仅允许内部调用' }, { status: 403 });
  }
  
  try {
    // 获取排队评估信息
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        Project: {
          include: {
            User: { select: { id: true } },
          },
        },
      },
    });
    
    if (!evaluation) {
      logger.debug(LOG_MODULES.EVALUATION, '评估不存在:', { details: { id } });
      return NextResponse.json({ error: '评估不存在' }, { status: 404 });
    }
    
    if (evaluation.status !== 'queued') {
      logger.debug(LOG_MODULES.EVALUATION, '评估状态不是 queued:', { details: { status: evaluation.status } });
      return NextResponse.json({ error: '评估不在排队状态' }, { status: 400 });
    }
    
    logger.debug(LOG_MODULES.EVALUATION, '启动排队评估:', { details: { id, projectId: evaluation.projectId } });
    
    // 更新评估状态为 running
    await prisma.evaluationSession.update({
      where: { id },
      data: {
        status: 'running',
        startedAt: new Date(),
      },
    });
    
    // 更新项目状态为 running
    await prisma.project.update({
      where: { id: evaluation.projectId },
      data: { status: 'running' },
    });
    
    // 通过调用项目的 start API 启动评估
    // 注意：这里需要重新触发完整的评估流程
    const startUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/projects/${evaluation.projectId}/start`;
    
    // 获取全局配置中的模型信息
    const globalConfig = await prisma.opencodeConfig.findFirst({
      where: { isActive: true },
    });
    
    // 获取一个可用的模型配置
    const modelConfig = await prisma.modelConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    
    if (!modelConfig) {
      logger.debug(LOG_MODULES.EVALUATION, '没有可用的模型配置');
      await prisma.evaluationSession.update({
        where: { id },
        data: {
          status: 'failed',
          errorMessage: '没有可用的模型配置',
          completedAt: new Date(),
        },
      });
      return NextResponse.json({ error: '没有可用的模型配置' }, { status: 400 });
    }
    
    // 调用 start API（使用内部标记绕过并发检查）
    const response = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Queued-Start': 'true', // 标记为队列启动，绕过并发检查
      },
      body: JSON.stringify({
        agentTeamId: evaluation.agentTeamId,
        modelId: modelConfig.id,
        queuedEvaluationId: id, // 传递排队评估ID，用于复用而不是创建新的
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      logger.errorNoUser(LOG_MODULES.EVALUATION, '启动评估失败:', { details: { error: errorData } });
      
      // 恢复排队状态
      await prisma.evaluationSession.update({
        where: { id },
        data: {
          status: 'failed',
          errorMessage: errorData.error || '启动失败',
          completedAt: new Date(),
        },
      });
      
      await prisma.project.update({
        where: { id: evaluation.projectId },
        data: { status: 'idle' },
      });
      
      return NextResponse.json({ error: errorData.error || '启动失败' }, { status: 500 });
    }
    
    const result = await response.json();
    logger.debug(LOG_MODULES.EVALUATION, '评估启动成功:', { details: { result } });
    
    return NextResponse.json({
      message: '排队评估已启动',
      evaluationId: id,
      ...result,
    });
    
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '启动排队评估异常:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}