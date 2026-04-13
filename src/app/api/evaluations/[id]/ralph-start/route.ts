// src/app/api/evaluations/[id]/ralph-start/route.ts
//
// Ralph Loop Agent 启动端点
// 使用 Ralph Loop Agent 来解决任务结束时间不稳定的问题
//

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { createRalphLoopAgent, parseAndSaveResults } from '@/services/evaluation';
import type { RalphLoopAgentConfig, RalphLoopAgentCallbacks } from '@/services/evaluation';

// ============================================
// 日志工具
// ============================================

const LOG_PREFIX = '[RalphStart]';

function logInfo(message: string, ...args: unknown[]) {
  console.log(`${LOG_PREFIX} [INFO] ${new Date().toISOString()} - ${message}`, ...args);
}

function logWarn(message: string, ...args: unknown[]) {
  console.warn(`${LOG_PREFIX} [WARN] ${new Date().toISOString()} - ${message}`, ...args);
}

function logError(message: string, ...args: unknown[]) {
  console.error(`${LOG_PREFIX} [ERROR] ${new Date().toISOString()} - ${message}`, ...args);
}

function logSuccess(message: string, ...args: unknown[]) {
  console.log(`${LOG_PREFIX} [SUCCESS] ${new Date().toISOString()} - ${message}`, ...args);
}

function logSeparator(title: string) {
  console.log(`${LOG_PREFIX} ${'='.repeat(50)}`);
  console.log(`${LOG_PREFIX} ${title}`);
  console.log(`${LOG_PREFIX} ${'='.repeat(50)}`);
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
 * 示例请求体：
 * {
 *   "maxIterations": 15,
 *   "maxTokens": 100000,
 *   "maxCost": 5.00,
 *   "verifyCompletionConfig": {
 *     "type": "keyword",
 *     "keywords": ["任务完成", "评估完成"]
 *   }
 * }
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

    // 2. 获取评估会话信息
    const { id } = await params;

    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            config: true,
            files: true,
          },
        },
      },
    });

    if (!evaluation) {
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
    const opencodeConfig = evaluation.project.config;

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
      evaluation.project.projectPath || undefined,
      {
        maxIterations,
        maxTokens,
        maxCost,
        verifyCompletion,
        onIterationStart: (iteration) => {
          console.log(`[Ralph] 开始第 ${iteration} 次迭代`);
        },
        onIterationEnd: async (iteration, duration) => {
          console.log(`[Ralph] 第 ${iteration} 次迭代完成，耗时 ${duration}ms`);
          // 保存迭代记录到数据库
          try {
            await prisma.evaluationIteration.create({
              data: {
                evaluationSessionId: id,
                iterationNumber: iteration,
                status: 'completed',
                duration,
                completedAt: new Date(),
              },
            });
          } catch {
            // 表不存在时忽略（迁移后才可用）
          }
        },
        onContextSummarized: (data) => {
          console.log(
            `[Ralph] 上下文已总结: ${data.summarizedIterations} 次迭代，节省 ${data.tokensSaved} tokens`
          );
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
    logInfo(`项目名称: ${evaluation.project.name}`);
    logInfo(`项目路径: ${evaluation.project.projectPath || '未设置'}`);
    logInfo(`模型: ${modelConfig.model}`);
    logInfo(`最大迭代次数: ${maxIterations}`);
    logInfo(`最大Token数: ${maxTokens}`);
    logInfo(`最大成本: $${maxCost}`);
    logInfo(`任务描述: ${opencodeConfig?.taskDescription?.substring(0, 200) || '未设置'}...`);
    logSeparator('');

    // 9. 构建 context
    const context = {
      projectName: evaluation.project.name,
      projectDescription: evaluation.project.description || undefined,
      environmentUrl: evaluation.project.environmentUrl || undefined,
      files: evaluation.project.files.map((f) => ({
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
        console.log(`[Ralph] 工具调用: ${name}`, Object.keys(parameters));
      },
      onToolResult: (name, result) => {
        console.log(`[Ralph] 工具结果: ${name}`, result);
      },
      onComplete: (fullResponse) => {
        console.log('[Ralph] 单次迭代完成，文本长度:', fullResponse.length);
      },
      onError: (error) => {
        console.error('[Ralph] 错误:', error);
        prisma.evaluationSession.update({
          where: { id },
          data: {
            status: 'failed',
            errorMessage: error.message,
            completedAt: new Date(),
          },
        }).catch((err) => {
          console.error('[Ralph] 更新失败状态出错:', err);
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
      console.error('[Ralph] 循环执行失败:', error);
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
    console.error('[Ralph Start] 错误:', error);
    return NextResponse.json(
      {
        error: '服务器内部错误',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
