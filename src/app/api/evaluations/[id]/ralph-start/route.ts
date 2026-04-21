// src/app/api/evaluations/[id]/ralph-start/route.ts
//
// Ralph Loop Agent 启动端点
// 使用 Ralph Loop Agent 来解决任务结束时间不稳定的问题
//
// 数据隔离：普通用户只能启动自己项目评估的 Ralph Agent，管理员可以启动所有

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { createRalphLoopAgent, parseAndSaveResults } from '@/services/evaluation';
import { generateIndexedId } from '@/lib/id-generator';
import type { RalphLoopAgentConfig, RalphLoopAgentCallbacks } from '@/services/evaluation';
import { logger, LOG_MODULES } from '@/lib/logger';

// ============================================
// 日志工具
// ============================================

function logInfo(message: string, ...args: unknown[]) {
  logger.debug(LOG_MODULES.EVALUATION, message, { details: args.length > 0 ? args : undefined });
}

function logWarn(message: string, ...args: unknown[]) {
  logger.warn(LOG_MODULES.EVALUATION, message, { details: args.length > 0 ? args : undefined });
}

function logError(message: string, ...args: unknown[]) {
  logger.errorNoUser(LOG_MODULES.EVALUATION, message, { details: args.length > 0 ? args : undefined });
}

function logSuccess(message: string, ...args: unknown[]) {
  logger.info(LOG_MODULES.EVALUATION, message, { details: args.length > 0 ? args : undefined });
}

function logSeparator(title: string) {
  logger.debug(LOG_MODULES.EVALUATION, `${'='.repeat(50)} ${title} ${'='.repeat(50)}`);
}

/**
 * 从数据库获取模型配置（与其他 evaluation 路由保持一致）
 */
async function getModelConfig() {
  // 优先使用默认模型
  const defaultModel = await prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });

  if (defaultModel) {
    const models = JSON.parse(defaultModel.models || '[]');
    return {
      providerType: defaultModel.providerType,
      apiKey: defaultModel.apiKey,
      apiBaseUrl: defaultModel.apiBaseUrl,
      models: defaultModel.models,
      model: models[0] || 'claude-sonnet-4-20250514',
    };
  }

  // 无默认，取第一个激活的
  const firstModel = await prisma.modelConfig.findFirst({
    where: { isActive: true },
  });

  if (!firstModel) return null;

  const models = JSON.parse(firstModel.models || '[]');
  return {
    providerType: firstModel.providerType,
    apiKey: firstModel.apiKey,
    apiBaseUrl: firstModel.apiBaseUrl,
    models: firstModel.models,
    model: models[0] || 'claude-sonnet-4-20250514',
  };
}

/**
 * POST /api/evaluations/[id]/ralph-start
 *
 * 使用 Ralph Loop Agent 启动评估任务
 *
 * 数据隔离：普通用户只能启动自己项目评估的 Ralph Agent，管理员可以启动所有
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. 验证授权
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 2. 获取评估会话信息并验证所有权
    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    let where: any = { id };
    
    const evaluation = await prisma.evaluationSession.findFirst({
      where,
      include: {
        Project: {
          include: {
            OpencodeConfig: true,
            ProjectFile: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 归属校验（管理员绕过）
    if (!userIsAdmin && evaluation.Project.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    if (evaluation.status === 'running') {
      return NextResponse.json({ error: '评估会话已在运行中' }, { status: 400 });
    }

    // 3. 获取模型配置（从 ModelConfig 表）
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json({ error: '未找到激活的模型配置' }, { status: 404 });
    }

    // 4. 获取项目的 OpencodeConfig（任务描述等）
    const opencodeConfig = evaluation.Project.OpencodeConfig;

    // 5. 解析请求体
    const body = await request.json();
    const {
      maxIterations = 15,
      maxTokens = 100000,
      maxCost = 5.00,
      verifyCompletionConfig,
    } = body;

    // 6. 构建验证函数
    let verifyCompletion: RalphLoopAgentConfig['verifyCompletion'] | undefined;

    if (verifyCompletionConfig) {
      if (verifyCompletionConfig.type === 'tool-call') {
        const { toolName } = verifyCompletionConfig as { toolName: string };
        verifyCompletion = async ({ result }) => {
          const text = result.text;
          if (text.includes(toolName)) {
            return { complete: true, reason: `检测到工具调用: ${toolName}` };
          }
          return { complete: false, reason: `未检测到工具调用: ${toolName}，请继续执行任务` };
        };
      } else if (verifyCompletionConfig.type === 'keyword') {
        const { keywords } = verifyCompletionConfig as { keywords: string[] };
        verifyCompletion = async ({ result }) => {
          const text = result.text.toLowerCase();
          for (const keyword of keywords) {
            if (text.includes(keyword.toLowerCase())) {
              return { complete: true, reason: `检测到关键词: ${keyword}` };
            }
          }
          return {
            complete: false,
            reason: `未检测到任何关键词: ${keywords.join(', ')}，请继续执行任务`,
          };
        };
      } else if (verifyCompletionConfig.type === 'custom') {
        return NextResponse.json({ error: '自定义验证类型暂未实现' }, { status: 501 });
      }
    }

    // 7. 创建 Ralph Loop Agent
    const agent = createRalphLoopAgent(
      {
        providerType: modelConfig.providerType,
        apiKey: modelConfig.apiKey,
        apiBaseUrl: modelConfig.apiBaseUrl,
        models: modelConfig.models,
      },
      evaluation.Project.projectPath || undefined,
      {
        maxIterations,
        maxTokens,
        maxCost,
        verifyCompletion,
        onIterationStart: (iteration) => {
          logger.debug(LOG_MODULES.EVALUATION, `开始第 ${iteration} 次迭代`);
        },
        onIterationEnd: async (iteration, duration) => {
          logger.debug(LOG_MODULES.EVALUATION, `第 ${iteration} 次迭代完成，耗时 ${duration}ms`);
          // 保存迭代记录到数据库
          try {
            await prisma.evaluationIteration.create({
              data: {
                id: generateIndexedId('iter', iteration),
                evaluationSessionId: id,
                iterationNumber: iteration,
                status: 'completed',
                duration,
                completedAt: new Date(),
                updatedAt: new Date(),
              },
            });
          } catch {
            // 表不存在时忽略（迁移后才可用）
          }
        },
        onContextSummarized: (data) => {
          logger.debug(LOG_MODULES.EVALUATION, `上下文已总结: ${data.summarizedIterations} 次迭代，节省 ${data.tokensSaved} tokens`);
        },
      }
    );

    // 8. 更新评估会话状态为运行中
    await prisma.evaluationSession.update({
      where: { id },
      data: {
        status: 'running',
        startedAt: new Date(),
      },
    });

    // 日志：评估开始
    logSeparator('评估开始');
    logInfo(`评估会话ID: ${id}`);
    logInfo(`项目ID: ${evaluation.projectId}`);
    logInfo(`项目名称: ${evaluation.Project.name}`);
    logInfo(`项目路径: ${evaluation.Project.projectPath || '未设置'}`);
    logInfo(`模型: ${modelConfig.model}`);
    logInfo(`最大迭代次数: ${maxIterations}`);
    logInfo(`最大Token数: ${maxTokens}`);
    logInfo(`最大成本: $${maxCost}`);
    logInfo(`任务描述: ${opencodeConfig?.taskDescription?.substring(0, 200) || '未设置'}...`);
    logSeparator('');

    // 9. 构建 context
    const context = {
      projectName: evaluation.Project.name,
      projectDescription: evaluation.Project.description || undefined,
      environmentUrl: evaluation.Project.environmentUrl || undefined,
      files: evaluation.Project.ProjectFile.map((f) => ({
        name: f.fileName,
        type: f.fileType,
        size: f.fileSize,
      })),
      taskDescription: opencodeConfig?.taskDescription || undefined,
      initialMessage: opencodeConfig?.taskDescription || undefined,
      workflowName: undefined,
    };

    // 10. 创建回调
    const callbacks: RalphLoopAgentCallbacks = {
      onChunk: (text) => {
        // 后台运行时不需要 SSE 推送
        void text;
      },
      onToolCall: (name, parameters) => {
        logger.debug(LOG_MODULES.EVALUATION, `工具调用: ${name}`, { details: { keys: Object.keys(parameters) } });
      },
      onToolResult: (name, result) => {
        logger.debug(LOG_MODULES.EVALUATION, `工具结果: ${name}`, { details: { result } });
      },
      onComplete: (fullResponse) => {
        logger.debug(LOG_MODULES.EVALUATION, '单次迭代完成，文本长度:', { details: { length: fullResponse.length } });
      },
      onError: (error) => {
        logger.errorNoUser(LOG_MODULES.EVALUATION, '错误:', { details: { error: error.message } });
        prisma.evaluationSession.update({
          where: { id },
          data: {
            status: 'failed',
            errorMessage: error.message,
            completedAt: new Date(),
          },
        }).catch((err) => {
          logger.errorNoUser(LOG_MODULES.EVALUATION, '更新失败状态出错:', { details: { error: String(err) } });
        });
      },
      onRalphComplete: async (result) => {
        // 日志：评估结束
        logSeparator('评估结束');
        logInfo(`评估会话ID: ${id}`);
        logInfo(`迭代次数: ${result.iterations}`);
        logInfo(`完成原因: ${result.completionReason}`);
        logInfo(`原因详情: ${result.reason || '无'}`);
        logInfo(`总Token数: ${result.totalUsage.totalTokens}`);
        logInfo(`输入Token: ${result.totalUsage.inputTokens}`);
        logInfo(`输出Token: ${result.totalUsage.outputTokens}`);
        
        // 尝试解析并保存结果
        logInfo('开始解析评估结果...');
        const fullResponse = result.text;
        
        try {
          const parseResult = await parseAndSaveResults(id, evaluation.projectId, fullResponse);
          
          if (parseResult.success) {
            logSuccess(`漏洞入库成功: ${parseResult.vulnCount} 个`);
          } else {
            logWarn(`漏洞入库失败: ${parseResult.error}`);
          }
        } catch (parseError) {
          logError('解析结果时发生异常:', parseError);
        }
        
        logSeparator('');

        await prisma.evaluationSession.update({
          where: { id },
          data: {
            status: result.completionReason === 'verified' ? 'completed' : 'failed',
            completedAt: new Date(),
            summary: `[Ralph] ${result.completionReason === 'verified' ? '验证完成' : '达到最大迭代次数'}。共迭代 ${result.iterations} 次。${result.reason || ''}`,
          },
        });
      },
    };

    // 11. 在后台启动循环，立即返回响应
    agent.loop({
      evaluationId: id,
      projectId: evaluation.projectId,
      context,
      callbacks,
    }).catch(async (error) => {
      logger.errorNoUser(LOG_MODULES.EVALUATION, '循环执行失败:', { details: { error: error instanceof Error ? error.message : String(error) } });
      await prisma.evaluationSession.update({
        where: { id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        },
      });
    });

    // 12. 立即返回启动成功响应
    return NextResponse.json({
      success: true,
      message: 'Ralph Loop Agent 已启动',
      evaluationId: id,
      config: {
        maxIterations,
        maxTokens,
        maxCost,
        hasVerifyCompletion: !!verifyCompletion,
        model: modelConfig.model,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, 'Ralph 启动错误:', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      {
        error: '服务器内部错误',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}