// src/app/api/evaluations/[id]/fsm-start/route.ts
//
// FSM Workflow Execution API
// Starts FSM workflow execution using FSMWorkflowExecutionService
//

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { createFSMWorkflowExecutionService } from '@/lib/fsm';
import type { FSMExecutionCallbacks } from '@/lib/fsm';
import { logger, LOG_MODULES } from '@/lib/logger';
import { registerAgent, abortAgent, isAgentRunning } from '@/lib/agent-registry';

/**
 * 获取模型配置
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
 * POST /api/evaluations/[id]/fsm-start
 *
 * 启动 FSM 工作流执行
 *
 * 参数:
 * - fsmTemplateId: FSM 模板 ID
 * - maxIterationsPerPhase: 每阶段最大迭代次数 (默认 10)
 * - maxCostPerPhase: 每阶段最大成本 (默认 2.0)
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
    const userIsAdmin = isAdmin(payload);

    const evaluation = await prisma.evaluationSession.findFirst({
      where: userIsAdmin ? { id } : { id, Project: { userId: payload.userId } },
      include: {
        Project: {
          select: {
            id: true,
            name: true,
            projectPath: true,
            userId: true,
          },
        },
        Workflow: {
          include: {
            FSMTemplate: true,
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

    // 3. 解析请求体
    const body = await request.json();
    
    // 获取 FSM 模板 ID（优先从请求体，其次从 Workflow 关联）
    let fsmTemplateId = body.fsmTemplateId as string | undefined;
    if (!fsmTemplateId && evaluation.Workflow) {
      // TypeScript 可能不识别 fsmTemplateId，使用类型断言
      const workflow = evaluation.Workflow as any;
      fsmTemplateId = workflow.fsmTemplateId;
    }
    
    const maxIterationsPerPhase = body.maxIterationsPerPhase as number || 10;
    const maxCostPerPhase = body.maxCostPerPhase as number || 2.0;

    if (!fsmTemplateId) {
      return NextResponse.json({ error: '需要指定 FSM 模板 ID' }, { status: 400 });
    }

    // 4. 获取 FSM 模板
    const fsmTemplate = await prisma.fSMTemplate.findUnique({
      where: { id: fsmTemplateId },
    });

    if (!fsmTemplate) {
      return NextResponse.json({ error: 'FSM 模板不存在' }, { status: 404 });
    }

    // 5. 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json({ error: '未找到激活的模型配置' }, { status: 404 });
    }

    // 6. 更新评估会话状态
    await prisma.evaluationSession.update({
      where: { id },
      data: {
        status: 'running',
        startedAt: new Date(),
      },
    });

    // 7. 构建回调
    const callbacks: FSMExecutionCallbacks = {
      onPhaseStart: async (phase, phaseName) => {
        logger.debug(LOG_MODULES.FSM, `Phase ${phase} (${phaseName}) 开始`);
      },
      onPhaseChunk: (phase, text) => {
        // SSE 推送（如果有连接）
      },
      onPhaseToolCall: (phase, tool, args) => {
        logger.debug(LOG_MODULES.FSM, `Phase ${phase} 工具调用: ${tool}`);
      },
      onPhaseComplete: async (phase, result) => {
        logger.info(LOG_MODULES.FSM, `Phase ${phase} 完成`, {
          details: {
            iterations: result.iterations,
            duration: result.duration,
            tokens: result.totalTokens,
            status: result.status,
          },
        });
      },
      onPhaseError: (phase, error) => {
        logger.errorNoUser(LOG_MODULES.FSM, `Phase ${phase} 错误: ${error.message}`);
      },
      onAgentZoneStart: async (agents) => {
        logger.info(LOG_MODULES.FSM, `Agent Zone 启动: ${agents.join(', ')}`);
      },
      onAgentZoneProgress: (agent, status) => {
        logger.debug(LOG_MODULES.FSM, `Agent ${agent} 状态: ${status}`);
      },
      onAgentZoneComplete: async (results) => {
        logger.info(LOG_MODULES.FSM, `Agent Zone 完成`, {
          details: {
            total: results.length,
            completed: results.filter(r => r.status === 'completed').length,
          },
        });
      },
      onWorkflowComplete: async (result) => {
        logger.info(LOG_MODULES.FSM, `FSM 工作流完成`, {
          details: {
            status: result.status,
            duration: result.totalDuration,
            cost: result.totalCost,
            reports: result.generatedReports.length,
          },
        });

        // 更新评估会话状态
        await prisma.evaluationSession.update({
          where: { id },
          data: {
            status: result.status === 'completed' ? 'completed' : 'failed',
            completedAt: new Date(),
            summary: `FSM 工作流执行完成。阶段: ${result.phaseResults.length}, Agent Zone: ${result.agentZoneResults.length}, 报告: ${result.generatedReports.length}`,
          },
        });
      },
      onWorkflowError: (error) => {
        logger.errorNoUser(LOG_MODULES.FSM, `FSM 工作流错误: ${error.message}`);
        
        prisma.evaluationSession.update({
          where: { id },
          data: {
            status: 'failed',
            errorMessage: error.message,
            completedAt: new Date(),
          },
        }).catch(() => {});
      },
    };

    // 8. 创建 FSM 执行服务
    const workspacePath = evaluation.Project.projectPath || process.cwd();
    const workflowId = evaluation.workflowId || 'fsm-default';

    const fsmService = createFSMWorkflowExecutionService(
      {
        evaluationSessionId: id,
        projectId: evaluation.projectId,
        workflowId,
        fsmTemplateId,
        workspacePath,
        maxIterationsPerPhase,
        maxCostPerPhase,
        modelConfig,
      },
      callbacks
    );

    // 注册到 agent registry（用于中止）
    // FSM service 没有 abort 方法直接注册，我们使用自定义管理
    // registerAgent(id, fsmService); // 需要适配

    // 9. 在后台执行，立即返回响应
    fsmService.execute().catch(async (error) => {
      logger.errorNoUser(LOG_MODULES.FSM, `FSM 执行失败: ${error instanceof Error ? error.message : String(error)}`);
      
      await prisma.evaluationSession.update({
        where: { id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        },
      });
    });

    // 10. 返回启动成功响应
    return NextResponse.json({
      success: true,
      message: 'FSM 工作流已启动',
      evaluationId: id,
      config: {
        fsmTemplateId,
        fsmTemplateName: fsmTemplate.name,
        maxIterationsPerPhase,
        maxCostPerPhase,
        model: modelConfig.model,
        workspacePath,
      },
    });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.FSM, `FSM 启动错误: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json(
      {
        error: '服务器内部错误',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/evaluations/[id]/fsm-start?abort=true
 *
 * 中止 FSM 工作流执行
 */
export async function DELETE(
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

    // 检查是否有运行的 FSM agent
    if (isAgentRunning(id)) {
      abortAgent(id);
      
      await prisma.evaluationSession.update({
        where: { id },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        message: 'FSM 工作流已中止',
        evaluationId: id,
      });
    }

    return NextResponse.json({
      success: false,
      message: '没有运行的 FSM 工作流',
      evaluationId: id,
    });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.FSM, `中止 FSM 错误: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}