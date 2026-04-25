// src/lib/ralph-executor.ts
//
// Unified Ralph Loop execution logic
// Called by /api/projects/[id]/start (统一启动入口)
//

import { prisma } from '@/lib/prisma';
import { createRalphLoopAgent, parseAndSaveResults } from '@/services/evaluation';
import { generateIndexedId } from '@/lib/id-generator';
import type { RalphLoopAgentConfig, RalphLoopAgentCallbacks } from '@/services/evaluation';
import type { AppMcpServerConfig } from '@/services/ai';
import { logger, LOG_MODULES } from '@/lib/logger';

export interface RalphExecuteInput {
  evaluationId: string;
  projectId: string;
  projectPath?: string;
  projectName: string;
  projectDescription?: string;
  environmentUrl?: string;
  files: Array<{ name: string; type: string; size: number }>;
  taskDescription?: string;
  modelConfig: {
    providerType: string;
    apiKey: string;
    apiBaseUrl: string;
    models: string;
    model: string;
  };
  ralphConfig: {
    maxIterations?: number;
    maxTokens?: number;
    maxCost?: number;
    verifyCompletion?: RalphLoopAgentConfig['verifyCompletion'];
  };
  // MCP 服务器配置（传递给 Claude Agent SDK）
  mcpServers?: AppMcpServerConfig[];
  // 系统提示词（传递给 Claude Agent SDK）
  systemPrompt?: string;
}

export interface RalphExecuteResult {
  success: boolean;
  message: string;
  evaluationId: string;
  config: {
    maxIterations: number;
    maxTokens: number;
    maxCost: number;
    hasVerifyCompletion: boolean;
    model: string;
  };
}

/**
 * Get active model config from database
 */
export async function getRalphModelConfig() {
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
 * Execute Ralph Loop Agent
 * Core execution logic extracted from route
 */
export async function executeRalphLoop(input: RalphExecuteInput): Promise<RalphExecuteResult> {
  const { evaluationId, projectId, projectPath, projectName, projectDescription, environmentUrl, files, taskDescription, modelConfig, ralphConfig, mcpServers, systemPrompt } = input;

  const maxIterations = ralphConfig.maxIterations || 15;
  const maxTokens = ralphConfig.maxTokens || 100000;
  const maxCost = ralphConfig.maxCost || 5.00;

  // Create Ralph Loop Agent with MCP and systemPrompt
  const agent = createRalphLoopAgent(
    {
      providerType: modelConfig.providerType,
      apiKey: modelConfig.apiKey,
      apiBaseUrl: modelConfig.apiBaseUrl,
      models: modelConfig.models,
    },
    projectPath,
    {
      maxIterations,
      maxTokens,
      maxCost,
      verifyCompletion: ralphConfig.verifyCompletion,
      onIterationStart: (iteration) => {
        logger.debug(LOG_MODULES.EVALUATION, `开始第 ${iteration} 次迭代`);
      },
      onIterationEnd: async (iteration, duration) => {
        logger.debug(LOG_MODULES.EVALUATION, `第 ${iteration} 次迭代完成，耗时 ${duration}ms`);
        try {
          await prisma.evaluationIteration.create({
            data: {
              id: generateIndexedId('iter', iteration),
              evaluationSessionId: evaluationId,
              iterationNumber: iteration,
              status: 'completed',
              duration,
              completedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        } catch { /* Table may not exist */ }
      },
      onContextSummarized: (data) => {
        logger.debug(LOG_MODULES.EVALUATION, `上下文已总结: ${data.summarizedIterations} 次迭代，节省 ${data.tokensSaved} tokens`);
      },
    },
    // SDK Options: MCP 服务器和系统提示词
    {
      mcpServers,
      systemPrompt,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['project'],
    }
  );

  // Update session status
  await prisma.evaluationSession.update({
    where: { id: evaluationId },
    data: { status: 'running', startedAt: new Date() },
  });

  logger.info(LOG_MODULES.EVALUATION, `Ralph 启动: ${evaluationId}`, {
    details: { projectId, model: modelConfig.model, maxIterations, maxTokens, maxCost },
  });

  // Build context
  const context = {
    projectName,
    projectDescription,
    environmentUrl,
    files,
    taskDescription,
    initialMessage: taskDescription,
    workflowName: undefined,
  };

  // Create callbacks
  const callbacks: RalphLoopAgentCallbacks = {
    onChunk: () => {},
    onToolCall: (name, parameters) => {
      logger.debug(LOG_MODULES.EVALUATION, `工具调用: ${name}`, { details: { keys: Object.keys(parameters) } });
    },
    onToolResult: (name, result) => {
      logger.debug(LOG_MODULES.EVALUATION, `工具结果: ${name}`, { details: { result } });
    },
    onComplete: (fullResponse) => {
      logger.debug(LOG_MODULES.EVALUATION, '单次迭代完成', { details: { length: fullResponse.length } });
    },
    onError: (error) => {
      logger.errorNoUser(LOG_MODULES.EVALUATION, '错误:', { details: { error: error.message } });
      prisma.evaluationSession.update({
        where: { id: evaluationId },
        data: { status: 'failed', errorMessage: error.message, completedAt: new Date() },
      }).catch(() => {});
    },
    onRalphComplete: async (result) => {
      logger.info(LOG_MODULES.EVALUATION, `Ralph 完成: ${evaluationId}`, {
        details: { iterations: result.iterations, reason: result.completionReason, tokens: result.totalUsage.totalTokens },
      });

      // 漏洞入库流程已改为从 vulnerabilities.json 文件解析
      // 此处不再从 AI 响应文本中提取漏洞，避免误提取
      // 正确的漏洞入库路径：unified-execution-engine.ts 的 parseAndSaveVulnerabilities
      // try {
      //   const parseResult = await parseAndSaveResults(evaluationId, projectId, result.text);
      //   if (parseResult.success) {
      //     logger.info(LOG_MODULES.EVALUATION, `漏洞入库成功: ${parseResult.vulnCount} 个`);
      //   } else {
      //     logger.warn(LOG_MODULES.EVALUATION, `漏洞入库失败: ${parseResult.error}`);
      //   }
      // } catch (parseError) {
      //   logger.errorNoUser(LOG_MODULES.EVALUATION, '解析结果异常:', { details: { error: String(parseError) } });
      // }

      await prisma.evaluationSession.update({
        where: { id: evaluationId },
        data: {
          status: result.completionReason === 'verified' ? 'completed' : 'failed',
          completedAt: new Date(),
          summary: `[Ralph] ${result.completionReason === 'verified' ? '验证完成' : '达到最大迭代次数'}。共迭代 ${result.iterations} 次。${result.reason || ''}`,
        },
      });
    },
  };

  // Execute in background
  agent.loop({ evaluationId, projectId, context, callbacks }).catch(async (error) => {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '循环执行失败:', { details: { error: error instanceof Error ? error.message : String(error) } });
    await prisma.evaluationSession.update({
      where: { id: evaluationId },
      data: { status: 'failed', errorMessage: error instanceof Error ? error.message : String(error), completedAt: new Date() },
    });
  });

  return {
    success: true,
    message: 'Ralph Loop Agent 已启动',
    evaluationId,
    config: { maxIterations, maxTokens, maxCost, hasVerifyCompletion: !!ralphConfig.verifyCompletion, model: modelConfig.model },
  };
}