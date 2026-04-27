// src/app/api/evaluations/[id]/start-queued/route.ts
// 启动排队评估的 API（内部调用）

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import { emitQueueError } from '@/lib/event-bus';
import { unlockProject } from '@/lib/evaluation-lock';

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
  
  console.log(`\n[Start-Queued] ========== 收到启动请求 ==========`);
  console.log(`[Start-Queued] evaluationId: ${id}`);
  logger.debug(LOG_MODULES.EVALUATION, '收到启动请求:', { details: { evaluationId: id } });
  
  // 检查是否为内部调用（支持两种方式：X-Internal-Token 或 X-Internal-Call）
  const internalToken = request.headers.get('X-Internal-Token');
  const internalCall = request.headers.get('X-Internal-Call') === 'true';
  const isValidInternal = internalToken === process.env.INTERNAL_API_SECRET || internalCall;
  
  console.log(`[Start-Queued] 内部调用检查: internalToken=${internalToken ? '有' : '无'}, internalCall=${internalCall}, isValid=${isValidInternal}`);
  
  if (!isValidInternal) {
    console.log(`[Start-Queued] ✗ 拒绝非内部调用`);
    logger.debug(LOG_MODULES.EVALUATION, '拒绝非内部调用');
    return NextResponse.json({ error: '仅允许内部调用' }, { status: 403 });
  }
  
  console.log(`[Start-Queued] ✓ 内部调用验证通过`);
  
  try {
    // 获取排队评估信息
    console.log(`[Start-Queued] 查询评估信息...`);
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
      console.log(`[Start-Queued] ✗ 评估不存在: ${id}`);
      logger.debug(LOG_MODULES.EVALUATION, '评估不存在:', { details: { id } });
      return NextResponse.json({ error: '评估不存在' }, { status: 404 });
    }
    
    const projectName = evaluation.Project?.name || '未知项目';
    console.log(`[Start-Queued] 评估信息: projectId=${evaluation.projectId}, projectName=${projectName}, status=${evaluation.status}`);
    
    if (evaluation.status !== 'queued') {
      console.log(`[Start-Queued] ✗ 评估状态不是 queued: ${evaluation.status}`);
      logger.debug(LOG_MODULES.EVALUATION, '评估状态不是 queued:', { details: { status: evaluation.status } });
      return NextResponse.json({ error: '评估不在排队状态', currentStatus: evaluation.status }, { status: 400 });
    }
    
    console.log(`[Start-Queued] ✓ 开始启动排队评估...`);
    logger.info(LOG_MODULES.EVALUATION, '启动排队评估:', { details: { id, projectId: evaluation.projectId, projectName } });
    
    // 注意：不在这里更新状态，让 start API 统一处理
    // 这样避免竞态条件：start API 检查发现"已有评估运行"但实际上是刚更新的
    
    // 通过调用项目的 start API 启动评估
    const startUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/projects/${evaluation.projectId}/start`;
    console.log(`[Start-Queued] 调用 start API: ${startUrl}`);
    
    // 获取全局配置中的模型信息
    const globalConfig = await prisma.opencodeConfig.findFirst({
      where: { isActive: true },
    });
    
    console.log(`[Start-Queued] 全局配置: ${globalConfig ? `找到 (maxConcurrent=${globalConfig.maxConcurrentEvaluations})` : '未找到'}`);
    
    // 获取一个可用的模型配置
    const modelConfig = await prisma.modelConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    
    console.log(`[Start-Queued] 模型配置: ${modelConfig ? `找到 (${modelConfig.name}, provider=${modelConfig.providerType})` : '未找到'}`);
    
    if (!modelConfig) {
      const errorMsg = '没有可用的模型配置';
      console.log(`[Start-Queued] ✗ ${errorMsg}`);
      logger.errorNoUser(LOG_MODULES.EVALUATION, errorMsg, { evaluationId: id });
      
      // 发送队列错误事件
      emitQueueError({
        evaluationId: id,
        projectName,
        error: errorMsg,
        errorDetails: '启动排队评估时无法找到活跃的模型配置',
      });
      
      await prisma.evaluationSession.update({
        where: { id },
        data: {
          status: 'failed',
          errorMessage: errorMsg,
          endReason: 'no_model_config',
          endMessage: `调度失败: 无法找到活跃的模型配置\n时间: ${new Date().toISOString()}`,
          completedAt: new Date(),
        },
      });
      
      // 释放项目锁
      await unlockProject(evaluation.projectId);
      
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }
    
    // 调用 start API（使用内部标记绕过并发检查和认证）
    console.log(`[Start-Queued] 构建请求体: workflowId=${evaluation.workflowId}, agentTeamId=${evaluation.agentTeamId}, modelId=${modelConfig.id}, queuedEvaluationId=${id}`);
    
    const requestBody = JSON.stringify({
      workflowId: evaluation.workflowId,  // 关键：传递 workflowId
      agentTeamId: evaluation.agentTeamId,
      modelId: modelConfig.id,
      queuedEvaluationId: id, // 传递排队评估ID，用于复用而不是创建新的
    });
    
    console.log(`[Start-Queued] 调用 start API...`);
    const response = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Queued-Start': 'true', // 标记为队列启动，绕过并发检查
        'X-Internal-Call': 'true', // 内部调用，绕过认证
      },
      body: requestBody,
    });
    
    console.log(`[Start-Queued] start API 响应: status=${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      // 解析完整错误响应
      let errorData: any;
      let errorDetails: string;
      try {
        errorData = await response.json();
        errorDetails = JSON.stringify(errorData, null, 2);
      } catch {
        errorData = { error: `HTTP ${response.status}` };
        errorDetails = `HTTP ${response.status}: ${response.statusText}`;
      }
      
      const errorMessage = errorData.error || errorData.details?.error || '启动失败';
      
      logger.errorNoUser(LOG_MODULES.EVALUATION, '启动评估失败:', {
        evaluationId: id,
        httpStatus: response.status,
        errorData,
      });
      
      // 发送队列错误事件
      emitQueueError({
        evaluationId: id,
        projectName,
        error: errorMessage,
        errorDetails: errorDetails,
      });
      
      // 恢复失败状态，记录详细错误
      await prisma.evaluationSession.update({
        where: { id },
        data: {
          status: 'failed',
          errorMessage: errorMessage,
          endReason: 'start_api_failed',
          endMessage: `start API 调用失败详情:\nHTTP状态: ${response.status}\n响应内容:\n${errorDetails}\n\n时间: ${new Date().toISOString()}`,
          completedAt: new Date(),
        },
      });
      
      await prisma.project.update({
        where: { id: evaluation.projectId },
        data: { status: 'idle' },
      });
      
      // 释放项目锁
      await unlockProject(evaluation.projectId);
      
      return NextResponse.json({ 
        error: errorMessage,
        details: errorData.details || errorData,
        httpStatus: response.status,
      }, { status: 500 });
    }
    
    const result = await response.json();
    console.log(`[Start-Queued] ✓ start API 返回成功: ${JSON.stringify(result, null, 2)}`);
    logger.info(LOG_MODULES.EVALUATION, '评估启动成功:', { details: { evaluationId: id, result } });
    
    console.log(`[Start-Queued] ========== 启动流程完成 ==========`);
    
    return NextResponse.json({
      message: '排队评估已启动',
      evaluationId: id,
      ...result,
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    
    logger.errorNoUser(LOG_MODULES.EVALUATION, '启动排队评估异常:', {
      evaluationId: id,
      error: errorMessage,
      stack: errorStack,
    });
    
    // 尝试发送队列错误事件并更新数据库状态
    try {
      const evaluation = await prisma.evaluationSession.findUnique({
        where: { id },
        include: { Project: { select: { name: true } } },
      });
      
      if (evaluation) {
        emitQueueError({
          evaluationId: id,
          projectName: evaluation.Project?.name || '未知项目',
          error: errorMessage,
          errorDetails: errorStack || '无堆栈信息',
        });
        
        await prisma.evaluationSession.update({
          where: { id },
          data: {
            status: 'failed',
            errorMessage: `启动异常: ${errorMessage}`,
            endReason: 'start_exception',
            endMessage: `启动排队评估时发生异常:\n错误: ${errorMessage}\n堆栈: ${errorStack || '无'}\n时间: ${new Date().toISOString()}`,
            completedAt: new Date(),
          },
        });
        
        await prisma.project.update({
          where: { id: evaluation.projectId },
          data: { status: 'idle' },
        });
        
        // 释放项目锁
        await unlockProject(evaluation.projectId);
      }
    } catch (dbError) {
      logger.errorNoUser(LOG_MODULES.EVALUATION, '更新失败状态时出错:', { error: String(dbError) });
    }
    
    return NextResponse.json({ 
      error: '服务器内部错误',
      details: errorMessage,
      stack: errorStack,
    }, { status: 500 });
  }
}