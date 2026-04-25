// src/app/api/projects/[id]/start/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { createRalphLoopAgent } from '@/services/evaluation';
import { AppMcpServerConfig } from '@/services/ai/claude-agent';
import { claudeProjectManager } from '@/lib/claude-project-sync';
import { mkdir, writeFile, readFile, access, rm } from 'fs/promises';
import { join } from 'path';
import { copySkillsToProject, copySkillsByIds } from '@/services/skill-files';
import { matchSkillsByCategoryValues } from '@/services/skill-matcher';
import { buildExperiencePromptWithMeta } from '@/services/autonomous-evolution/system-prompt-builder';
import { createWatchdog, stopWatchdog, recordWatchdogActivity } from '@/lib/stream-watchdog';
import { emitPreparingProgress, emitEvaluationStarted, emitEvaluationComplete, emitTodoUpdate, emitPhaseTokenUsage, emitPhaseStart, emitNodeComplete, emitMessageChunk } from '@/lib/event-bus';
import { createEmptyAnalysisReport } from '@/services/analysis-report';
import { createSkillExecutionsForEvaluation, completeAllPendingSkillExecutions } from '@/services/skill-execution-tracker';
import { generateId, generateIndexedId } from '@/lib/id-generator';
import { UnifiedWorkflowExecutionEngine, createUnifiedExecutionEngine } from '@/lib/workflow/unified-execution-engine';
import { topologicalSortDAG } from '@/lib/workflow/topology-sort';
import type { UnifiedExecutionCallbacks, NodeExecutionResult, WorkflowExecutionResult, ModelConfigForExecution, UnifiedNodeDefinition } from '@/lib/workflow/types';
import { completeEvaluationSuccess, completeEvaluationFailed } from '@/services/evaluation-completion';
import { lockProject, isProjectLocked, unlockProject } from '@/lib/evaluation-lock';

// 启动项目评估（SSE 流式响应）
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 检查是否为内部调用（队列启动）
    const internalCallToken = request.headers.get('X-Internal-Token');
    const isQueuedStart = internalCallToken === process.env.INTERNAL_API_SECRET;
    
    let payload: { userId: string; permissions: string[]; roles?: string[] } | null = null;
    
    if (isQueuedStart) {
      // 内部调用：从请求体获取用户信息或使用项目所有者
      const { id } = await params;
      const project = await prisma.project.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (project) {
        // 获取用户权限和角色
        const user = await prisma.user.findUnique({
          where: { id: project.userId },
          include: {
            UserRole: {
              include: {
                Role: {
                  include: {
                    Permission: true,
                  },
                },
              },
            },
          },
        });
        if (user) {
          const permissions = user.UserRole.flatMap(ur => ur.Role.Permission.map(p => `${p.module}:${p.action}`));
          const roles = user.UserRole.map(ur => ur.Role.name);
          payload = { userId: user.id, permissions, roles };
        }
      }
      if (!payload) {
        return NextResponse.json({ error: '无法获取项目用户信息' }, { status: 500 });
      }
    } else {
      // 正常用户调用：验证 token
      const authHeader = request.headers.get('authorization');
      if (!authHeader) {
        return NextResponse.json({ error: '未授权' }, { status: 401 });
      }

      const token = authHeader.replace('Bearer ', '');
      payload = verifyToken(token);

      if (!payload) {
        return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
      }

      // 权限检查
      if (!hasPermission(payload.permissions, PERMISSIONS.EVALUATION_CREATE)) {
        return NextResponse.json({ error: '无权限启动评估' }, { status: 403 });
      }
    }

    const { id } = await params;

    // 解析请求体获取 workflowId, modelId, roleModels 和其他选项
    let workflowId: string | null = null;
    let agentTeamId: string | null = null;
    let modelId: string | null = null;
    let roleModels: { roleId: string; modelId: string }[] | null = null;
    let queuedEvaluationId: string | null = null; // 队列启动时复用的评估ID
    let reconnectEvaluationId: string | null = null; // 重连已存在的评估
    let bodyParsed = false; // 标记是否成功解析请求体
    
    try {
      const body = await request.json();
      bodyParsed = true;
      workflowId = body.workflowId || null;
      agentTeamId = body.agentTeamId || null;
      modelId = body.modelId || null;
      roleModels = body.roleModels || null;
      queuedEvaluationId = body.queuedEvaluationId || null;
      reconnectEvaluationId = body.evaluationId || null; // 用于重连 SSE
    } catch (e) {
      // 如果没有请求体或解析失败，继续执行（某些请求如 SSE 重连可能有空请求体）
      logger.debug(LOG_MODULES.EVALUATION, '请求体解析失败或为空', { error: String(e) });
    }

    logger.debug(LOG_MODULES.EVALUATION, 'start API 调用', { projectId: id, reconnectEvaluationId, bodyParsed, isSSEReconnect: !!reconnectEvaluationId });
    logger.debug(LOG_MODULES.EVALUATION, '启动评估参数', { workflowId, modelId, roleModelsCount: roleModels?.length || 0 });

    // 获取项目信息（包括运行中和准备中的评估）
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        ProjectFile: true,
        EvaluationSession: {
          where: { status: { in: ['preparing', 'running'] } },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 项目归属校验（SSE 重连时跳过，因为后续有评估归属检查）
    // 管理员可以启动任意用户的项目评估
    const isAdmin = payload.roles?.includes('admin');
    if (!reconnectEvaluationId && project.userId !== payload.userId && !isAdmin) {
      return NextResponse.json({ error: '无权操作此项目' }, { status: 403 });
    }

    // 获取全局配置（优先激活配置，如果没有激活配置则使用第一个）
    let globalConfig = await prisma.opencodeConfig.findFirst({
      where: { isActive: true },
    });
    
    // 如果没有激活配置，尝试获取第一个配置并自动激活
    if (!globalConfig) {
      const firstConfig = await prisma.opencodeConfig.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      
      if (firstConfig) {
        logger.debug(LOG_MODULES.CONFIG, '没有激活配置，自动激活第一个', { configId: firstConfig.id });
        await prisma.opencodeConfig.update({
          where: { id: firstConfig.id },
          data: { isActive: true },
        });
        globalConfig = { ...firstConfig, isActive: true };
      }
    }

    // ========================================
    // 使用全局 Map 锁检查项目是否正在评估
    // ========================================
    
    // SSE 重连和队列启动不需要检查
    let evaluationIdForLock: string | null = null;  // 用于锁定的 evaluationId
    
    if (!isQueuedStart && !reconnectEvaluationId && !queuedEvaluationId) {
      // 尝试锁定项目
      evaluationIdForLock = generateId('eval');
      const locked = await lockProject(id, evaluationIdForLock);
      
      if (!locked) {
        // 项目已被锁定，返回错误
        const existingEvalId = isProjectLocked(id);
        logger.warn(LOG_MODULES.EVALUATION, '该项目已有正在运行的评估，拒绝启动', {
          projectId: id,
          existingEvaluationId: existingEvalId,
        });
        return NextResponse.json({
          error: '该项目已有正在运行的评估，请等待当前评估完成后再启动新的评估',
          existingEvaluationId: existingEvalId,
        }, { status: 409 });
      }
      
      // 锁定成功，立即创建 preparing 状态的评估记录（让前端立即看到"准备中"）
      // 只设置必要字段，后续流程会补充完整信息
      await prisma.evaluationSession.create({
        data: {
          id: evaluationIdForLock,
          projectId: id,
          workflowId: workflowId,
          agentTeamId: agentTeamId,
          modelConfigId: modelId,
          roleModels: roleModels ? JSON.stringify(roleModels) : null,
          status: 'preparing',
          providerType: 'pending',  // 临时值，后续更新
          workflowType: 'pending',  // 临时值，后续更新
          startedAt: new Date(),
        },
      });
      
      // 同时更新项目状态为 running
      await prisma.project.update({
        where: { id },
        data: { status: 'running' },
      });
      
      logger.info(LOG_MODULES.EVALUATION, '已创建 preparing 评估记录，前端可立即看到状态', { 
        evaluationId: evaluationIdForLock, 
        projectId: id 
      });
      
      // evaluationIdForLock 已在 Map 中，评估记录已创建
      // 后续代码如果需要排队，会更新这个记录的状态为 queued
    }
    
    // 检查并发限制（队列启动和 SSE 重连时跳过）
    // 使用数据库事务确保原子性，防止并发竞争导致超限
    // SSE 重连只是订阅现有评估的事件，不创建新评估，所以不需要检查并发限制
    const maxConcurrent = globalConfig?.maxConcurrentEvaluations || 3;
    
    // 如果不是队列启动或 SSE 重连，在事务中检查并发并创建评估
    if (!isQueuedStart && !reconnectEvaluationId) {
      // 使用事务确保并发检查和创建评估是原子操作
      const concurrencyResult = await prisma.$transaction(async (tx) => {
        // 在事务中检查当前活跃评估数量
        const activeCount = await tx.evaluationSession.count({
          where: { 
            status: { in: ['preparing', 'running'] } 
          },
        });
        
        logger.debug(LOG_MODULES.EVALUATION, '并发限制检查（事务内）', { 
          activeCount, 
          maxConcurrent, 
          projectId: id 
        });
        
        // 如果超出并发限制，更新已创建的评估为排队状态
        if (activeCount >= maxConcurrent) {
          logger.debug(LOG_MODULES.EVALUATION, '超出并发限制，更新评估为排队状态');
          
          // 更新已创建的 preparing 评估为 queued 状态
          if (evaluationIdForLock) {
            await tx.evaluationSession.update({
              where: { id: evaluationIdForLock },
              data: {
                status: 'queued',
                providerType: 'queued',
                workflowType: 'queued',
              },
            });
          } else {
            // 如果没有 evaluationIdForLock（队列启动场景），创建新的排队评估
            const queuedEvaluation = await tx.evaluationSession.create({
              data: {
                id: generateId('eval'),
                projectId: id,
                workflowId: workflowId,
                agentTeamId: agentTeamId,
                modelConfigId: modelId,
                roleModels: roleModels ? JSON.stringify(roleModels) : null,
                status: 'queued',
                providerType: 'queued',
              },
            });
            evaluationIdForLock = queuedEvaluation.id;
          }
          
          return {
            isQueued: true,
            evaluationId: evaluationIdForLock,
            queuePosition: activeCount - maxConcurrent + 1,
          };
        }
        
        // 未超出限制，返回可创建标记
        return {
          isQueued: false,
          activeCount,
        };
      });
      
      // 如果被排队，直接返回
      if (concurrencyResult.isQueued) {
        return NextResponse.json({
          message: '评估已加入排队队列',
          evaluationId: concurrencyResult.evaluationId!,
          status: 'queued',
          queuePosition: concurrencyResult.queuePosition!,
          maxConcurrent,
        }, { status: 202 });
      }
    }

    // 日志：检查全局配置
    logger.debug(LOG_MODULES.EVALUATION, '项目信息', {
      projectId: project.id,
      projectName: project.name,
      globalConfigExists: !!globalConfig,
      configId: globalConfig?.id,
      configName: globalConfig?.name,
      customSystemPromptExists: !!globalConfig?.customSystemPrompt,
      customSystemPromptLength: globalConfig?.customSystemPrompt?.length || 0,
    });
    if (!globalConfig) {
      logger.warn(LOG_MODULES.EVALUATION, '未找到激活的全局配置');
    }

    // 加载 MCP 服务器配置（用户私有 + 共享 + 项目级别）
    // 加载共享的 MCP 配置（isShared=true，管理员设置的共享 MCP）
    const sharedMcpServers = await prisma.mcpServerConfig.findMany({
      where: { 
        isShared: true, 
        isEnabled: true,
      },
    });
    
    // 加载用户私有的 MCP 配置
    const userMcpServers = await prisma.mcpServerConfig.findMany({
      where: { 
        userId: payload.userId, 
        projectId: null,
        isEnabled: true,
      },
    });
    
    // 加载项目级别 MCP 配置
    const projectMcpServers = await prisma.mcpServerConfig.findMany({
      where: { projectId: id, isEnabled: true },
    });
    
    // 合并配置（项目级别 > 用户私有 > 共享）
    const allServers = [...sharedMcpServers, ...userMcpServers];
    const allNames = new Set(allServers.map(s => s.name));
    const projectNames = new Set(projectMcpServers.map(s => s.name));
    
    // 添加共享和用户配置（不在项目配置中的）
    let mcpServers = [...allServers.filter(s => !projectNames.has(s.name))];
    // 添加项目配置（优先级最高）
    mcpServers = [...mcpServers, ...projectMcpServers];
    
    logger.debug(LOG_MODULES.MCP, '加载 MCP 服务器', { shared: sharedMcpServers.length, userPrivate: userMcpServers.length, project: projectMcpServers.length, merged: mcpServers.length });

    // 加载工具权限配置
    const toolPermissions = await prisma.toolPermission.findMany({
      where: { projectId: id },
    });

    // 检查是否有运行中或准备中的评估会话
    const activeEvaluations = project.EvaluationSession || [];
    
    // 如果是 SSE 重连（提供了 evaluationId），且该评估正在运行或准备中
    if (reconnectEvaluationId) {
      const targetEvaluation = activeEvaluations.find(e => e.id === reconnectEvaluationId);
      if (targetEvaluation) {
        // SSE 重连权限检查：评估所属项目必须是用户自己的，或者用户是管理员
        const userIsAdmin = payload.roles?.includes('admin') ?? false;
        if (!userIsAdmin && project.userId !== payload.userId) {
          return NextResponse.json({ error: '无权查看此评估' }, { status: 403 });
        }
        
        logger.debug(LOG_MODULES.EVALUATION, 'SSE 重连到现有评估', { evaluationId: reconnectEvaluationId, status: targetEvaluation.status });
        
        // 导入事件总线订阅函数
        const { subscribeToEvaluationEvents } = await import('@/lib/event-bus');
        
        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let isControllerClosed = false;
        
        const stream = new ReadableStream({
          start(controller) {
            // 发送 reconnect 事件
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'reconnect', 
              evaluationId: reconnectEvaluationId,
              status: 'running',
              message: '已连接到运行中的评估'
            })}\n\n`));
            
            // 订阅事件总线的评估事件，转发到 SSE 流
            unsubscribe = subscribeToEvaluationEvents(reconnectEvaluationId, (event: any) => {
              if (isControllerClosed) {
                // 控制器已关闭，取消订阅
                if (unsubscribe) {
                  unsubscribe();
                  unsubscribe = null;
                }
                return;
              }
              
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                logger.debug(LOG_MODULES.EVALUATION, 'SSE 转发事件', { 
                  evaluationId: reconnectEvaluationId, 
                  eventType: event.type 
                });
                
                // 如果是评估完成事件，关闭连接
                if (event.type === 'evaluation_complete') {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    type: 'done',
                    evaluationId: reconnectEvaluationId,
                    message: '评估已完成',
                    timestamp: Date.now(),
                  })}\n\n`));
                  controller.close();
                  isControllerClosed = true;
                  if (unsubscribe) {
                    unsubscribe();
                    unsubscribe = null;
                  }
                }
              } catch (e) {
                // 控制器已关闭或写入失败
                logger.warn(LOG_MODULES.EVALUATION, 'SSE 写入失败，取消订阅', { error: e });
                isControllerClosed = true;
                if (unsubscribe) {
                  unsubscribe();
                  unsubscribe = null;
                }
              }
            });
          },
          cancel() {
            // 连接关闭时取消订阅
            isControllerClosed = true;
            if (unsubscribe) {
              unsubscribe();
              unsubscribe = null;
            }
            logger.debug(LOG_MODULES.EVALUATION, 'SSE 连接关闭，已取消订阅', { evaluationId: reconnectEvaluationId });
          }
        });
        
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }
    }
    
    if (activeEvaluations.length > 0) {
      return NextResponse.json({ 
        error: '项目已有评估正在运行或准备中', 
        activeEvaluationId: activeEvaluations[0].id 
      }, { status: 400 });
    }

    // 获取模型配置（传入用户ID用于权限过滤）
    const modelConfig = await getModelConfig(modelId, payload.userId);
    if (!modelConfig) {
      return NextResponse.json(
        { error: '请先在模型管理中配置模型' },
        { status: 400 }
      );
    }

    // workflowId 是可选的，如果未提供则不使用工作流

    // ========================================
    // 必填检查
    // ========================================

    // 1. 检查系统提示词（必填）
    if (!globalConfig?.customSystemPrompt) {
      return NextResponse.json({ 
        error: '系统配置缺少系统提示词（customSystemPrompt），无法启动评估' 
      }, { status: 400 });
    }

    // 2. 检查 workflowId（必填）
    if (!workflowId) {
      return NextResponse.json(
        { error: '必须指定工作流编排（workflowId），无法启动评估' },
        { status: 400 }
      );
    }

    // 3. 解析 workflowConfig（用于开始/结束节点描述）
    let workflowConfigParsed: {
      startNodeLabel?: string;
      startNodeDescription?: string;
      endNodeLabel?: string;
      endNodeDescription?: string;
    } | null = null;
    if (globalConfig.workflowConfig) {
      try {
        workflowConfigParsed = JSON.parse(globalConfig.workflowConfig);
      } catch {
        logger.warn(LOG_MODULES.EVALUATION, 'workflowConfig JSON 解析失败');
      }
    }

    // 构建 SDK 高级配置
    const sdkOptions: {
      mcpServers?: AppMcpServerConfig[];
      toolPermissions?: { toolPattern: string; permission: 'allow' | 'deny' | 'ask' }[];
      systemPrompt?: string;
      settingSources?: ('project' | 'user' | 'local')[];
      permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
      allowDangerouslySkipPermissions?: boolean;
    } = {};
    
    // 设置系统提示词
    sdkOptions.systemPrompt = globalConfig.customSystemPrompt;
    
    // 设置权限模式为 bypassPermissions，给予 Claude 所有权限
    // 必须同时设置 allowDangerouslySkipPermissions: true
    sdkOptions.permissionMode = 'bypassPermissions';
    sdkOptions.allowDangerouslySkipPermissions = true;
    logger.debug(LOG_MODULES.EVALUATION, '权限配置', { permissionMode: sdkOptions.permissionMode, allowDangerouslySkipPermissions: sdkOptions.allowDangerouslySkipPermissions });

    // 加载 MCP 服务器配置
    if (mcpServers.length > 0) {
      sdkOptions.mcpServers = mcpServers.map((server: any) => ({
        name: server.name,
        type: server.type as 'local' | 'remote',
        command: server.command || undefined,
        args: server.args ? JSON.parse(server.args) : undefined,
        url: server.url || undefined,
        env: server.env ? JSON.parse(server.env) : undefined,
        isEnabled: server.isEnabled,
        autoStart: server.autoStart,
      }));
    }

    // 加载工具权限配置
    if (toolPermissions.length > 0) {
      sdkOptions.toolPermissions = toolPermissions.map((perm: any) => ({
        toolPattern: perm.toolPattern,
        permission: perm.permission as 'allow' | 'deny' | 'ask',
      }));
    }

    // 加载系统提示词配置（使用全局配置中的 customSystemPrompt）
    logger.debug(LOG_MODULES.EVALUATION, '检查全局配置', {
      globalConfigExists: !!globalConfig,
      configId: globalConfig?.id,
      isActive: globalConfig?.isActive,
      customSystemPromptExists: !!globalConfig?.customSystemPrompt,
      customSystemPromptLength: globalConfig?.customSystemPrompt?.length || 0,
    });
    
    if (globalConfig?.customSystemPrompt) {
      sdkOptions.systemPrompt = globalConfig.customSystemPrompt;
      logger.debug(LOG_MODULES.EVALUATION, '使用全局配置中的自定义系统提示词', { promptLength: globalConfig.customSystemPrompt.length });
    } else {
      logger.warn(LOG_MODULES.EVALUATION, '未配置系统提示词', { globalConfigStatus: globalConfig ? '存在但customSystemPrompt为空' : '不存在' });
    }

    // 注入自主进化经验到 System Prompt（预注入在开头，高关注度位置）
    let injectedExperiences: { id: string; title: string; errorCategory: string; hitCount: number }[] = [];
    try {
      const expResult = await buildExperiencePromptWithMeta();
      if (expResult.prompt) {
        // 预注入放在 System Prompt 开头（高关注度位置）
        const originalPrompt = sdkOptions.systemPrompt || '';
        sdkOptions.systemPrompt = expResult.prompt + '\n\n' + originalPrompt;
        injectedExperiences = expResult.experiences;
        logger.debug(LOG_MODULES.EVALUATION, '已预注入自主进化经验到 System Prompt 开头', { count: expResult.count, experiences: expResult.experiences.map(e => ({ id: e.id, title: e.title, errorCategory: e.errorCategory, hitCount: e.hitCount })) });
      } else {
        logger.debug(LOG_MODULES.EVALUATION, '无已启用的自主进化经验（isInjected=true 的记录为空）');
      }
    } catch (err) {
      logger.warn(LOG_MODULES.EVALUATION, '注入自主进化经验失败', { error: err });
    }

    // 设置源（加载 CLAUDE.md 和 Skills）
    sdkOptions.settingSources = ['project'];

    // 清理项目目录中的旧文件/目录，确保每次评估从干净状态开始
    // 注意：不再清理 .claude 目录，改为清理 outputs 目录
    if (project.projectPath) {
      const cleanupTargets = [
        { path: join(project.projectPath, 'workspace'), type: 'dir' },
        { path: join(project.projectPath, 'vulnerabilities'), type: 'dir' },
        { path: join(project.projectPath, 'outputs'), type: 'dir' },
        { path: join(project.projectPath, 'vulnerabilities.json'), type: 'file' },
        { path: join(project.projectPath, 'cloubugs4ai.cache.bin'), type: 'file' },
      ];
      for (const target of cleanupTargets) {
        try {
          await access(target.path);
          await rm(target.path, { recursive: true, force: true });
          logger.debug(LOG_MODULES.EVALUATION, '已清理目录', { path: target.path });
        } catch {
          // 不存在，跳过
        }
      }
      
      // 创建评估所需的工作目录 - 使用 outputs 替代 .claude
      const workDirs = [
        join(project.projectPath, 'vulnerabilities'),
        join(project.projectPath, 'workspace'),
        join(project.projectPath, 'workspace', 'decompile_src'),
        join(project.projectPath, 'workspace', 'extract_zip'),
        join(project.projectPath, 'outputs'),
        join(project.projectPath, 'outputs', 'phases'),
        join(project.projectPath, 'outputs', 'reports'),
      ];
      for (const dir of workDirs) {
        try {
          await mkdir(dir, { recursive: true });
          logger.debug(LOG_MODULES.EVALUATION, '已创建目录', { dir });
        } catch (error) {
          logger.errorNoUser(LOG_MODULES.EVALUATION, '创建目录失败', { dir, error });
        }
      }

      // ========================================
      // 调用 AI4Java MCP 的 decompileProject 工具
      // 直接调用 MCP，不经过大模型/SDK
      // 支持 local 和 remote MCP
      // 等待 MCP 完成后再启动评估
      // ========================================
      logger.info(LOG_MODULES.EVALUATION, '[MCP] 开始检查 AI4Java MCP 服务器配置', {
        mcpServersCount: mcpServers.length,
        mcpServerNames: mcpServers.map(s => s.name),
      });
      
      // 查找 AI4Java MCP 服务器配置（优先项目级别，其次共享）
      const ai4javaMcp = mcpServers.find(s => s.name === 'ai4java' && s.isEnabled);
      
      if (ai4javaMcp) {
        // 构建 MCP 配置（null 转换为 undefined）
        const mcpConfig = {
          name: ai4javaMcp.name,
          type: ai4javaMcp.type as 'local' | 'remote',
          command: ai4javaMcp.command ?? undefined,
          args: ai4javaMcp.args ? JSON.parse(ai4javaMcp.args) : undefined,
          url: ai4javaMcp.url ?? undefined,
          env: ai4javaMcp.env ? JSON.parse(ai4javaMcp.env) : undefined,
          timeout: 10 * 60 * 1000, // 10 分钟超时
        };
        
        // 验证配置完整性
        const isValidConfig = 
          (mcpConfig.type === 'local' && mcpConfig.command) ||
          (mcpConfig.type === 'remote' && mcpConfig.url);
        
        if (!isValidConfig) {
          logger.warn(LOG_MODULES.EVALUATION, '[MCP] AI4Java MCP 配置不完整', {
            serverId: ai4javaMcp.id,
            serverName: ai4javaMcp.name,
            serverType: mcpConfig.type,
            hasCommand: !!mcpConfig.command,
            hasUrl: !!mcpConfig.url,
          });
        } else {
          // 执行 MCP 调用，等待完成后再启动评估
          logger.info(LOG_MODULES.EVALUATION, '[MCP] 开始执行 decompileProject', {
            serverId: ai4javaMcp.id,
            serverName: ai4javaMcp.name,
            serverType: mcpConfig.type,
            projectPath: project.projectPath,
          });
          
          try {
            const { callAi4JavaDecompileDirect } = await import('@/lib/mcp-client');
            
            const startTime = Date.now();
            
            const decompileResult = await callAi4JavaDecompileDirect(
              mcpConfig,
              project.projectPath
            );
            
            const duration = Date.now() - startTime;
            
            if (decompileResult.success) {
              logger.info(LOG_MODULES.EVALUATION, '[MCP] decompileProject 执行成功', {
                duration: `${duration}ms`,
                durationSeconds: (duration / 1000).toFixed(2),
                contentLength: decompileResult.content ? JSON.stringify(decompileResult.content).length : 0,
                projectPath: project.projectPath,
              });
            } else {
              logger.warn(LOG_MODULES.EVALUATION, '[MCP] decompileProject 执行失败（继续启动评估）', {
                duration: `${duration}ms`,
                error: decompileResult.error,
                isError: decompileResult.isError,
                projectPath: project.projectPath,
              });
            }
          } catch (error) {
            // MCP 调用失败不阻止评估启动
            logger.errorNoUser(LOG_MODULES.EVALUATION, '[MCP] decompileProject 异常（继续启动评估）', {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              projectPath: project.projectPath,
            });
          }
        }
      } else {
        logger.info(LOG_MODULES.EVALUATION, '[MCP] 未检测到 AI4Java MCP 服务器配置，跳过 decompileProject', {
          availableServers: mcpServers.map(s => s.name),
          hint: '请在 MCP 服务器管理中添加名为 "ai4java" 的 MCP 服务器（支持 local 和 remote）',
        });
      }
    }

    // 同步 Skills 到项目目录（按 WorkflowNode 加载）
    // 同时记录使用的 Skills ID 列表
    let skillsUsedJson: string | null = null;
    let copyResult: { success: number; failed: number; errors: string[]; copiedSkills: string[]; skillIds: string[]; invalidSkills?: any[] } | null = null;
    let uniqueSkillIds: string[] = []; // 模式 2/3 必须执行的 Skills
    
    // 解析项目技术栈（移到更高作用域）
    let projectTechStack: string[] | null = null;
    if (project.techStack) {
      try {
        projectTechStack = JSON.parse(project.techStack);
        logger.debug(LOG_MODULES.EVALUATION, '项目技术栈', { techStack: projectTechStack?.join(', ') || '无' });
      } catch {
        logger.warn(LOG_MODULES.EVALUATION, '项目技术栈解析失败，将拷贝所有 Skills');
        projectTechStack = null;
      }
    } else {
      logger.debug(LOG_MODULES.EVALUATION, '项目未设置技术栈，将拷贝所有启用的 Skills');
    }
    
    if (project.projectPath) {
      try {
        logger.debug(LOG_MODULES.EVALUATION, '开始同步 Skills 到项目目录');
        
        // workflowId 必须提供，否则拒绝执行
        if (!workflowId) {
          return NextResponse.json(
            { error: '必须指定工作流编排（workflowId），无法启动评估' },
            { status: 400 }
          );
        }

        // ========================================
        // 检查是否是 FSM 工作流
        // ========================================
        const workflow = await prisma.workflow.findUnique({
          where: { id: workflowId },
          select: { 
            id: true, 
            name: true, 
            workflowType: true, 
            fsmTemplateId: true,
          },
        });
        
        if (workflow?.workflowType === 'fsm') {
          logger.info(LOG_MODULES.EVALUATION, '检测到 FSM 工作流，切换到 FSM 异步执行模式');
          
          // FSM 异步模式：更新评估记录（补充完整信息）
          // 如果 evaluationIdForLock 已存在，更新它；否则创建新的
          let evaluationIdToUse = evaluationIdForLock || generateId('eval');
          let evaluation;
          
          if (evaluationIdForLock) {
            // 更新已创建的 preparing 记录
            evaluation = await prisma.evaluationSession.update({
              where: { id: evaluationIdForLock },
              data: {
                providerType: modelConfig.providerType,
                workflowType: 'fsm',
              },
              include: { Project: true },
            });
            logger.info(LOG_MODULES.EVALUATION, 'FSM 评估记录已更新', { evaluationId: evaluationIdForLock });
          } else {
            // 创建新的评估记录（重连或队列启动场景）
            evaluation = await prisma.evaluationSession.create({
              data: {
                id: evaluationIdToUse,
                projectId: id,
                workflowId: workflowId,
                modelConfigId: modelId,
                roleModels: roleModels ? JSON.stringify(roleModels) : null,
                status: 'preparing',
                providerType: modelConfig.providerType,
                workflowType: 'fsm',
              },
              include: { Project: true },
            });
            evaluationIdToUse = evaluation.id;
            logger.info(LOG_MODULES.EVALUATION, 'FSM 评估已创建，状态为 preparing', { evaluationId: evaluation.id });
          }
          
          // 立即更新项目状态为 running（防止前端显示旧状态）
          await prisma.project.update({
            where: { id },
            data: { status: 'running' },
          });
          
          // 创建 SSE 流响应（订阅 eventBus 事件）
          const { subscribeToEvaluationEvents } = await import('@/lib/event-bus');
          const encoder = new TextEncoder();
          let unsubscribe: (() => void) | null = null;
          
          const stream = new ReadableStream({
            start(controller) {
              // 订阅所有评估事件
              unsubscribe = subscribeToEvaluationEvents(evaluationIdToUse, (event) => {
                try {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                  
                  // 如果评估完成，发送 [DONE] 并关闭流
                  if (event.type === 'evaluation_complete') {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                  }
                } catch (e) {
                  // 流已关闭，忽略
                }
              });
              
              // 发送初始事件
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'started',
                evaluationId: evaluation.id,
                status: 'preparing',
                workflowType: 'fsm',
                message: '评估已创建，正在后台准备中...',
              })}\n\n`));
            },
            cancel() {
              if (unsubscribe) unsubscribe();
            },
          });
          
          // 后台异步执行（不阻塞响应）
          void (async () => {
            try {
              // MCP decompile 已在同步阶段完成（lines 618-707），此处跳过
              emitPreparingProgress(evaluation.id, {
                stage: 'mcp_complete',
                message: 'MCP decompile 已在启动前完成',
              });
              
              // Step 1: Skills 同步
              emitPreparingProgress(evaluation.id, {
                stage: 'skills_sync',
                message: '开始同步 Skills 到项目目录...',
              });
              
              // FSM 模式下，同步所有技术栈匹配的 Skills
              let fsmSkillsUsedJson: string | null = null;
              let fsmCopyResult: { success: number; failed: number; errors: string[]; copiedSkills: string[]; skillIds: string[] } | null = null;
              
              if (project.projectPath) {
                try {
                  // 拷贝所有技术栈匹配的 Skills（模板由 saveSkillToDisk 内部自动获取）
                  fsmCopyResult = await copySkillsToProject(
                    project.projectPath,
                    payload.userId,
                    undefined,
                    projectTechStack
                  );
                  
                  logger.info(LOG_MODULES.SKILL, '[FSM Async] Skills 同步完成', {
                    success: fsmCopyResult.success,
                    failed: fsmCopyResult.failed,
                  });
                  
                  // 记录使用的 Skills
                  if (fsmCopyResult.skillIds.length > 0) {
                    const skills = await prisma.skill.findMany({
                      where: { id: { in: fsmCopyResult.skillIds } },
                      select: { id: true, name: true, displayName: true, description: true, severity: true },
                    });
                    const skillsUsed = skills.map(s => ({ skillId: s.id, skillName: s.name }));
                    fsmSkillsUsedJson = JSON.stringify(skillsUsed);
                    
                    // 更新评估记录的 skillsUsed
                    await prisma.evaluationSession.update({
                      where: { id: evaluation.id },
                      data: { skillsUsed: fsmSkillsUsedJson },
                    });
                  }
                  
                  emitPreparingProgress(evaluation.id, {
                    stage: 'skills_sync',
                    message: `Skills 同步完成，成功 ${fsmCopyResult.success} 个`,
                  });
                } catch (skillError) {
                  logger.errorNoUser(LOG_MODULES.SKILL, '[FSM Async] Skills 同步失败', { error: skillError });
                  emitPreparingProgress(evaluation.id, {
                    stage: 'skills_sync',
                    message: 'Skills 同步失败',
                    error: skillError instanceof Error ? skillError.message : String(skillError),
                  });
                  // Skills 同步失败不阻止 FSM 启动
                }
              }
              
              // Step 3: 更新状态为 running 并启动 FSM
              await prisma.evaluationSession.update({
                where: { id: evaluation.id },
                data: { status: 'running', startedAt: new Date() },
              });
              
              emitEvaluationStarted(evaluation.id, {
                workflowType: 'fsm',
                message: 'FSM 工作流已启动',
              });
              
              logger.info(LOG_MODULES.EVALUATION, '[FSM Async] 评估状态更新为 running，开始 FSM 执行', {
                evaluationId: evaluation.id,
              });
              
              // 获取 FSMTemplate.nodes 来映射 phase 到正确的 nodeId
              let fsmPhaseToNodeId: Record<number, string> = {};
              let fsmNodesList: Array<{ id: string; label: string; fsmPhase: number; fsmOrder: number }> = [];
              if (workflow.fsmTemplateId) {
                const fsmTemplate = await prisma.fSMTemplate.findUnique({
                  where: { id: workflow.fsmTemplateId },
                  select: { nodes: true },
                });
                if (fsmTemplate?.nodes) {
                  try {
                    const fsmNodes = JSON.parse(fsmTemplate.nodes);
                    fsmNodesList = fsmNodes.map((node: any) => ({
                      id: node.id,
                      label: node.label || `Phase ${node.fsmPhase}`,
                      fsmPhase: node.fsmPhase,
                      fsmOrder: node.fsmOrder || node.fsmPhase,
                    }));
                    fsmNodes.forEach((node: any) => {
                      if (node.fsmPhase) {
                        fsmPhaseToNodeId[node.fsmPhase] = node.id;
                      }
                    });
                    logger.info(LOG_MODULES.EVALUATION, '[FSM Async] FSMTemplate.nodes 解析完成', { 
                      nodeCount: fsmNodesList.length,
                      nodeIds: fsmNodesList.map(n => n.id).join(', ')
                    });
                  } catch (e) {
                    logger.warn(LOG_MODULES.EVALUATION, '[FSM Async] 解析 FSMTemplate.nodes 失败', { error: String(e) });
                  }
                }
              }
              
              // 预创建 NodeExecution 记录（确保前端能看到所有节点）
              if (fsmNodesList.length > 0) {
                try {
                  await prisma.$transaction(
                    fsmNodesList.map((node, i) =>
                      prisma.nodeExecution.create({
                        data: {
                          id: generateIndexedId('nodeexec', i),
                          evaluationSessionId: evaluation.id,
                          workflowNodeId: node.id,
                          nodeLabel: node.label,
                          nodeType: 'fsm_phase',
                          status: 'pending',
                          order: node.fsmOrder || i,
                          updatedAt: new Date(),
                        },
                      })
                    )
                  );
                  logger.info(LOG_MODULES.EVALUATION, '[FSM Async] NodeExecution 记录预创建完成', { 
                    count: fsmNodesList.length,
                    evaluationId: evaluation.id
                  });
                } catch (e) {
                  // 预创建失败不阻塞执行，后续 createNodeExecutionRecord 会处理
                  logger.warn(LOG_MODULES.EVALUATION, '[FSM Async] NodeExecution 预创建失败（继续执行）', { error: String(e) });
                }
              }
              
              // 调用 FSM 执行服务
              const { createFSMWorkflowExecutionService } = await import('@/lib/fsm');
              
              const fsmService = createFSMWorkflowExecutionService(
                {
                  evaluationSessionId: evaluation.id,
                  projectId: id,
                  workflowId: workflowId,
                  fsmTemplateId: workflow.fsmTemplateId || 'threat-modeling',
                  workspacePath: project.projectPath || '',
                  maxIterationsPerPhase: 10,
                  maxCostPerPhase: 2.0,
                  modelConfig,
                  systemPrompt: sdkOptions.systemPrompt,
                  roleModels: roleModels || undefined,
                },
                {
                  onPhaseStart: async (phase, phaseName) => {
                    logger.debug(LOG_MODULES.FSM, `Phase ${phase} (${phaseName}) 开始`);
                    // 推送阶段开始事件
                    emitPhaseStart(evaluation.id, {
                      nodeIndex: phase,
                      nodeId: `fsm-node-p${phase}`,
                      nodeName: phaseName,
                      modelName: modelConfig.name,
                      totalNodes: 7,
                    });
                  },
                  onPhaseChunk: (phase, text) => {
                    // 推送实时文本流（通过 event-bus）
                    emitMessageChunk(evaluation.id, text);
                  },
                  onPhaseToolCall: (phase, tool, args) => {
                    logger.debug(LOG_MODULES.FSM, `Phase ${phase} 工具调用: ${tool}`);
                    // 检测 TodoWrite 工具调用
                    if (tool === 'TodoWrite' && args?.todos && Array.isArray(args.todos)) {
                      // 使用正确的nodeId（从FSMTemplate.nodes映射）
                      const nodeId = fsmPhaseToNodeId[phase] || `fsm-node-p${phase}`;
                      const todosWithNodeId = args.todos.map((todo: any) => ({
                        ...todo,
                        nodeId: nodeId,
                        workflowNodeId: nodeId,
                        phase: phase,
                      }));
                      
                      emitTodoUpdate(evaluation.id, todosWithNodeId);
                    }
                  },
                  onPhaseComplete: async (phase, result) => {
                    logger.info(LOG_MODULES.FSM, `Phase ${phase} 完成`, {
                      details: { iterations: result.iterations, duration: result.duration, status: result.status },
                    });
                    // 推送节点完成事件
                    emitNodeComplete(evaluation.id, `fsm-node-p${phase}`);
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
                    logger.info(LOG_MODULES.FSM, `Agent Zone 完成`, { details: { total: results.length } });
                  },
                  onWorkflowComplete: async (result) => {
                    logger.info(LOG_MODULES.FSM, `FSM 工作流完成`, {
                      details: {
                        status: result.status,
                        duration: result.totalDuration,
                        totalInputTokens: result.totalInputTokens,
                        totalOutputTokens: result.totalOutputTokens,
                        totalTokens: result.totalTokens,
                        totalCost: result.totalCost,
                        phaseCount: result.phaseResults.length,
                        completedPhases: result.phaseResults.filter(p => p.status === 'completed').length,
                        failedPhases: result.phaseResults.filter(p => p.status === 'failed').map(p => ({
                          phase: p.phaseNumber,
                          name: p.phaseName,
                        })),
                      },
                    });
                    
                    // 使用统一评估完成服务
                    const projectPath = project.projectPath || process.cwd();
                    if (result.status === 'completed') {
                      await completeEvaluationSuccess(evaluation.id, id, projectPath, `FSM: ${result.phaseResults.length} phases`, { input: result.totalInputTokens, output: result.totalOutputTokens });
                    } else {
                      const failedPhasesInfo = result.phaseResults
                        .filter(p => p.status === 'failed')
                        .map(p => `Phase ${p.phaseNumber} (${p.phaseName})`)
                        .join(', ');
                      await completeEvaluationFailed(evaluation.id, id, projectPath, `工作流未完成。失败阶段: ${failedPhasesInfo || '未知'}`);
                    }
                    
                    // 发送评估完成事件
                    emitEvaluationComplete(evaluation.id, {
                      status: result.status,
                      totalDuration: result.totalDuration,
                      totalTokens: result.totalTokens,
                      totalCost: result.totalCost,
                      message: result.status === 'completed' ? 'FSM 工作流执行完成' : 'FSM 工作流执行失败',
                    });
                    
                    // 更新项目状态
                    await prisma.project.update({
                      where: { id },
                      data: { status: result.status === 'completed' ? 'completed' : 'failed' },
                    });
                  },
                  onWorkflowError: async (error) => {
                    logger.errorNoUser(LOG_MODULES.FSM, `FSM 工作流错误: ${error.message}`);
                    
                    // 使用统一评估完成服务
                    const projectPath = project.projectPath || process.cwd();
                    await completeEvaluationFailed(evaluation.id, id, projectPath, error.message);
                    
                    // 发送评估完成事件（失败）
                    emitEvaluationComplete(evaluation.id, {
                      status: 'failed',
                      error: error.message,
                      message: 'FSM 工作流执行失败',
                    });
                    
                    // 更新项目状态
                    await prisma.project.update({
                      where: { id },
                      data: { status: 'failed' },
                    });
                  },
                  onTokenUsage: (data) => {
                    logger.debug(LOG_MODULES.FSM, `[FSM Async] Token 使用:`, data);
                    // 推送 Token 使用事件到 SSE 流
                    // FSM 回调使用 phase，转换为 nodeIndex
                    emitPhaseTokenUsage(evaluation.id, {
                      nodeIndex: data.phase,
                      nodeName: data.phaseName,
                      modelName: data.modelName,
                      inputTokens: data.inputTokens,
                      outputTokens: data.outputTokens,
                      cumulativeInputTokens: data.cumulativeInputTokens,
                      cumulativeOutputTokens: data.cumulativeOutputTokens,
                    });
                  },
                });
                
                // 执行 FSM
              await fsmService.execute();
              
            } catch (error) {
              // 后台执行过程中的错误处理
              const errorMsg = error instanceof Error ? error.message : String(error);
              logger.errorNoUser(LOG_MODULES.EVALUATION, '[FSM Async] 后台执行失败', { error: errorMsg });
              
              // 发送准备阶段错误事件
              emitPreparingProgress(evaluation.id, {
                stage: 'mcp_error',
                message: '后台准备过程发生错误',
                error: errorMsg,
              });
              
              // 更新评估状态为失败
              await prisma.evaluationSession.update({
                where: { id: evaluation.id },
                data: {
                  status: 'failed',
                  errorMessage: errorMsg,
                  completedAt: new Date(),
                  endReason: 'error',
                  endMessage: errorMsg,
                },
              });
              
              // 发送评估完成事件（失败）
              emitEvaluationComplete(evaluation.id, {
                status: 'failed',
                error: errorMsg,
                message: '评估准备过程失败',
              });
              
              // 更新项目状态
              await prisma.project.update({
                where: { id },
                data: { status: 'failed' },
              });
              
              // 处理队列
              const { processQueue } = await import('@/services/evaluation-queue');
              processQueue().catch(err => logger.errorNoUser(LOG_MODULES.EVALUATION, '处理队列失败', { error: err }));
            }
          })();
          
          // 返回 SSE 流响应
          return new NextResponse(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          });
        } else {
          // ========================================
          // DAG 模式：异步执行架构
          // ========================================
        
        logger.info(LOG_MODULES.EVALUATION, '检测到 DAG 工作流，切换到 DAG 异步执行模式');
        
        // DAG 异步模式：更新评估记录（补充完整信息）
        // 如果 evaluationIdForLock 已存在，更新它；否则创建新的
        let dagEvaluationIdToUse = evaluationIdForLock || generateId('eval');
        let dagEvaluation;
        
        if (evaluationIdForLock) {
          // 更新已创建的 preparing 记录
          dagEvaluation = await prisma.evaluationSession.update({
            where: { id: evaluationIdForLock },
            data: {
              providerType: modelConfig.providerType,
              workflowType: 'dag',
              agentTeamId: agentTeamId,
            },
            include: { Project: true },
          });
          logger.info(LOG_MODULES.EVALUATION, 'DAG 评估记录已更新', { evaluationId: evaluationIdForLock });
        } else {
          // 创建新的评估记录（重连或队列启动场景）
          dagEvaluation = await prisma.evaluationSession.create({
            data: {
              id: dagEvaluationIdToUse,
              projectId: id,
              workflowId: workflowId,
              agentTeamId: agentTeamId,
              modelConfigId: modelId,
              roleModels: roleModels ? JSON.stringify(roleModels) : null,
              status: 'preparing',
              providerType: modelConfig.providerType,
              workflowType: 'dag',
            },
            include: { Project: true },
          });
          dagEvaluationIdToUse = dagEvaluation.id;
          logger.info(LOG_MODULES.EVALUATION, 'DAG 评估已创建，状态为 preparing', { evaluationId: dagEvaluation.id });
        }
        
        // 创建 SSE 流响应（订阅 eventBus 事件）
        const { subscribeToEvaluationEvents } = await import('@/lib/event-bus');
        const encoder = new TextEncoder();
        let dagUnsubscribe: (() => void) | null = null;
        
        const dagStream = new ReadableStream({
          start(controller) {
            // 订阅所有评估事件
            dagUnsubscribe = subscribeToEvaluationEvents(dagEvaluation.id, (event) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                
                // 如果评估完成，发送 [DONE] 并关闭流
                if (event.type === 'evaluation_complete') {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  controller.close();
                }
              } catch (e) {
                // 流已关闭，忽略
              }
            });
            
            // 发送初始事件
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'started',
              evaluationId: dagEvaluation.id,
              status: 'preparing',
              workflowType: 'dag',
              message: '评估已创建，正在后台准备中...',
            })}\n\n`));
          },
          cancel() {
            if (dagUnsubscribe) dagUnsubscribe();
          },
        });
        
        // 后台异步执行（不阻塞响应）
        void (async () => {
          try {
            // MCP decompile 已在同步阶段完成（lines 618-707），此处跳过
            emitPreparingProgress(dagEvaluation.id, {
              stage: 'mcp_complete',
              message: 'MCP decompile 已在启动前完成',
            });
            
            // ========================================
            // Step 1: Skills 同步
            // ========================================
            emitPreparingProgress(dagEvaluation.id, {
              stage: 'skills_sync',
              message: '开始同步 Skills 到项目目录...',
            });
            
            // 查询 Workflow 的所有节点（包含 roleId 用于统一执行引擎）
            const workflowNodes = await prisma.workflowNode.findMany({
              where: { workflowId },
              select: {
                id: true,
                roleId: true,
                type: true,
                data: true,
                vulnerabilityCategories: true,
                skills: true,
                fsmPhase: true,
                fsmOrder: true,
                skillPath: true,
              },
            });

            logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 找到 WorkflowNode', { count: workflowNodes.length });

        // 遍历每个节点，收集 Skill IDs
            const allSkillIds: string[] = [];
            let hasDescriptionModeNode = false;
            
            // 记录每个节点的漏洞分类匹配结果（用于错误提示）
            const nodeCategoryMatchResults: { nodeId: string; categories: string[]; matchedCount: number }[] = [];

            for (const node of workflowNodes) {
              // 模式 3：漏洞分类（多选）
              if (node.vulnerabilityCategories) {
                let categoryValues: string[] = [];
                try { categoryValues = JSON.parse(node.vulnerabilityCategories); } catch { /* ignore */ }
                if (categoryValues.length > 0) {
                  logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] Node 模式 3 - 漏洞分类', { nodeId: node.id, categories: categoryValues.join(', ') });
                  const matchedIds = await matchSkillsByCategoryValues(categoryValues, projectTechStack);
                  
                  // 记录匹配结果
                  nodeCategoryMatchResults.push({
                    nodeId: node.id,
                    categories: categoryValues,
                    matchedCount: matchedIds.length,
                  });
                  
                  // 模式3：如果筛选结果为空，抛出错误
                  if (matchedIds.length === 0) {
                    const techStackMsg = projectTechStack && projectTechStack.length > 0 
                      ? `，技术栈: ${projectTechStack.join(', ')}` 
                      : '';
                    throw new Error(`工作流节点 [${node.id}] 指定的漏洞分类 [${categoryValues.join(', ')}]${techStackMsg} 没有匹配到任何满足条件的 Skill（技术栈匹配 + 启用状态）。请检查漏洞分类是否正确，或联系管理员添加相关 Skills。`);
                  }
                  
                  allSkillIds.push(...matchedIds);
                  logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] Node 匹配到 Skills', { nodeId: node.id, matchedCount: matchedIds.length });
                  continue;
                }
              }

              // 模式 2：手工指定
              if (node.skills) {
                logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] Node 模式 2 - 手工指定 Skills', { nodeId: node.id });
                try {
                  const skillIds = JSON.parse(node.skills);
                  if (Array.isArray(skillIds)) {
                    allSkillIds.push(...skillIds);
                    logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] Node 指定了 Skills', { nodeId: node.id, skillCount: skillIds.length });
                  }
                } catch {
                  logger.warn(LOG_MODULES.EVALUATION, '[DAG Async] Node skills 字段 JSON 解析失败', { nodeId: node.id });
                }
                continue;
              }

              // 模式 1：自定义描述 - 由大模型根据描述自主加载 Skills
              // 不预设 Skills，让 Agent 通过 Skill 工具自主选择
              logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] Node 模式 1 - 自定义描述，由 Agent 自主加载 Skills', { nodeId: node.id });
              hasDescriptionModeNode = true;
            }

            // 去重
            const dagUniqueSkillIds = [...new Set(allSkillIds)];
            logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 合并后共唯一 Skill IDs（模式2/3）', { count: dagUniqueSkillIds.length });

// DAG 模式下的 Skills 同步结果
            let dagCopyResult: { success: number; failed: number; errors: string[]; copiedSkills: string[]; skillIds: string[]; invalidSkills?: any[] } | null = null;
            let dagSkillsUsedJson: string | null = null;

            // 模式 1：拷贝所有技术栈匹配的 Skills，供 Agent 自主选择（模板由 saveSkillToDisk 内部自动获取）
            if (hasDescriptionModeNode) {
              logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 存在自定义描述节点，拷贝所有技术栈匹配的 Skills 供 Agent 自主选择');
dagCopyResult = await copySkillsToProject(
                  project.projectPath || '',
                  payload.userId,
                  undefined,
                  projectTechStack
                );
              logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 已拷贝 Skills 供模式 1 节点自主选择', { successCount: dagCopyResult.success });
              
              // 同时追加模式 2/3 指定的 Skills（必须执行）
              if (dagUniqueSkillIds.length > 0) {
                const extra = await copySkillsByIds(project.projectPath || '', dagUniqueSkillIds, undefined, projectTechStack);
                
                // 模式2：检查验证失败的 Skills
                if (extra.invalidSkills && extra.invalidSkills.length > 0) {
                  const invalidDetails = extra.invalidSkills.map((s: any) => {
                    const reasonMap: Record<string, string> = {
                      'not_found': '不存在',
                      'not_active': '未启用',
                      'not_latest': '已废弃',
                      'tech_stack_mismatch': `技术栈不匹配(需要: ${s.techStackId || '无'})`,
                    };
                    return `${s.skillName || s.skillId}(${reasonMap[s.reason] || s.reason})`;
                  }).join(', ');
                  
                  const techStackMsg = projectTechStack && projectTechStack.length > 0 
                    ? `，项目技术栈: ${projectTechStack.join(', ')}` 
                    : '';
                  
                  throw new Error(`手工指定的 Skills 验证失败: ${invalidDetails}${techStackMsg}。请检查 Skills 是否存在、已启用、且技术栈匹配。`);
                }
                
                dagCopyResult.success += extra.success;
                dagCopyResult.failed += extra.failed;
                dagCopyResult.errors.push(...extra.errors);
                dagCopyResult.copiedSkills.push(...extra.copiedSkills);
                dagCopyResult.skillIds.push(...extra.skillIds);
              }
            } else {
              // 全部节点都是手工/漏洞分类模式，按 ID 精确拷贝（模板由 saveSkillToDisk 内部自动获取）
              dagCopyResult = await copySkillsByIds(
                project.projectPath || '',
                dagUniqueSkillIds,
                undefined,
                projectTechStack
              );
              
              // 模式2：检查验证失败的 Skills
              if (dagCopyResult.invalidSkills && dagCopyResult.invalidSkills.length > 0) {
                const invalidDetails = dagCopyResult.invalidSkills.map((s: any) => {
                  const reasonMap: Record<string, string> = {
                    'not_found': '不存在',
                    'not_active': '未启用',
                    'not_latest': '已废弃',
                    'tech_stack_mismatch': `技术栈不匹配(需要: ${s.techStackId || '无'})`,
                  };
                  return `${s.skillName || s.skillId}(${reasonMap[s.reason] || s.reason})`;
                }).join(', ');
                
                const techStackMsg = projectTechStack && projectTechStack.length > 0 
                  ? `，项目技术栈: ${projectTechStack.join(', ')}` 
                  : '';
                
                throw new Error(`手工指定的 Skills 验证失败: ${invalidDetails}${techStackMsg}。请检查 Skills 是否存在、已启用、且技术栈匹配。`);
              }
            }
            
            logger.debug(LOG_MODULES.SKILL, '[DAG Async] Skills 同步完成', { success: dagCopyResult.success, failed: dagCopyResult.failed, copiedSkills: dagCopyResult.copiedSkills.join(', ') });
            
            emitPreparingProgress(dagEvaluation.id, {
              stage: 'skills_sync',
              message: `Skills 同步完成，成功 ${dagCopyResult.success} 个`,
            });
            
            // 区分必须执行的 Skills（模式2/3）和可选择的 Skills（模式1）
            const mandatorySkillIds = dagUniqueSkillIds; // 模式 2/3 指定的 Skills
            const availableSkillIds = dagCopyResult.skillIds.filter(id => !mandatorySkillIds.includes(id)); // 模式 1 可选择的 Skills
            
            logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 必须执行的 Skills（模式2/3）', { count: mandatorySkillIds.length });
            logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 可选择的 Skills（模式1）', { count: availableSkillIds.length });
            
            // 记录使用的 Skills ID 列表（记录所有拷贝的 Skills）
            if (dagCopyResult.skillIds.length > 0) {
              const skills = await prisma.skill.findMany({
                where: { id: { in: dagCopyResult.skillIds } },
                select: { id: true, name: true, displayName: true, description: true, severity: true },
              });
              const skillsUsed = skills.map(s => ({ skillId: s.id, skillName: s.name }));
              dagSkillsUsedJson = JSON.stringify(skillsUsed);
              logger.debug(LOG_MODULES.SKILL, '[DAG Async] 使用的 Skills ID', { count: dagCopyResult.skillIds.length });
              
              // 更新评估记录的 skillsUsed
              await prisma.evaluationSession.update({
                where: { id: dagEvaluation.id },
                data: { skillsUsed: dagSkillsUsedJson },
              });
              
              // 构建 Skills 使用说明，区分必须执行和可选择
              const mandatorySkills = skills.filter(s => mandatorySkillIds.includes(s.id));
              const availableSkills = skills.filter(s => availableSkillIds.includes(s.id));
              
              const skillsPrompt = buildSkillsUsagePromptV2(mandatorySkills, availableSkills);
              if (skillsPrompt) {
                const originalPrompt = sdkOptions.systemPrompt || '';
                sdkOptions.systemPrompt = originalPrompt + '\n\n' + skillsPrompt;
                logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 已将 Skills 使用说明追加到系统提示词');
              }
            }
            
            // 追加评估报告分析要求
            const analysisPrompt = buildAnalysisReportPrompt();
            sdkOptions.systemPrompt = (sdkOptions.systemPrompt || '') + analysisPrompt;
            logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 已将评估报告分析要求追加到系统提示词');
            
            if (dagCopyResult.failed > 0) {
              dagCopyResult.errors.forEach(err => {
                logger.errorNoUser(LOG_MODULES.SKILL, '[DAG Async] Skills 同步错误', { error: err });
              });
            }
    
    // ========================================
            // Step 3: 拓扑排序
            // ========================================
            emitPreparingProgress(dagEvaluation.id, {
              stage: 'topology_sort',
              message: '开始拓扑排序...',
            });
            
            let sortedNodes: UnifiedNodeDefinition[];
            try {
              sortedNodes = await topologicalSortDAG(workflowId);
              logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 拓扑排序完成', { nodeCount: sortedNodes.length });
            } catch (error) {
              const errMsg = error instanceof Error ? error.message : String(error);
              logger.errorNoUser(LOG_MODULES.EVALUATION, '[DAG Async] 拓扑排序失败', { error: errMsg });
              throw new Error(`工作流拓扑排序失败: ${errMsg}`);
            }
            
            if (sortedNodes.length === 0) {
              throw new Error('工作流配置缺少节点，无法启动评估');
            }
            
            // 计算总任务数（排除 start/end 节点）
            const totalTasks = sortedNodes.filter(n => n.type !== 'start' && n.type !== 'end').length;
            
            logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] DAG 工作流节点信息', {
              totalNodes: sortedNodes.length,
              taskNodes: totalTasks,
              nodes: sortedNodes.map(n => ({ id: n.id, label: n.label, roleId: n.roleId })),
            });
            
            emitPreparingProgress(dagEvaluation.id, {
              stage: 'topology_sort',
              message: `拓扑排序完成，共 ${sortedNodes.length} 个节点`,
            });
            
            // 写入 CLAUDE.md 全局模板到项目目录
            if (project.projectPath && globalConfig?.claudemdTemplate) {
              try {
                const claudeMdPath = join(project.projectPath, 'CLAUDE.md');
                await writeFile(claudeMdPath, globalConfig.claudemdTemplate, 'utf-8');
                logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 已写入 CLAUDE.md 模板', { path: claudeMdPath });
              } catch (error) {
                logger.errorNoUser(LOG_MODULES.EVALUATION, '[DAG Async] 写入 CLAUDE.md 失败', { error });
              }
            }
            
            // 记录经验引用
            if (injectedExperiences.length > 0) {
              await prisma.experienceUsageLog.createMany({
                data: injectedExperiences.map((e, index) => ({
                  id: generateIndexedId('explog', index),
                  experienceId: e.id,
                  evaluationId: dagEvaluation.id,
                  projectId: id,
                })),
              });
              logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 已记录经验引用', { count: injectedExperiences.length });
            }
            
            // 创建空的分析报告
            try {
              await createEmptyAnalysisReport({
                evaluationId: dagEvaluation.id,
                projectId: id,
              });
              logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 已创建分析报告记录');
            } catch (error) {
              logger.errorNoUser(LOG_MODULES.EVALUATION, '[DAG Async] 创建分析报告记录失败', { error });
            }
            
            // 创建 Skill 执行记录文件
            if (project.projectPath && dagUniqueSkillIds.length > 0) {
              try {
                const workspaceDir = join(project.projectPath, 'workspace');
                try {
                  await access(workspaceDir);
                } catch {
                  await mkdir(workspaceDir, { recursive: true });
                }
                
                const skillsForLog = await prisma.skill.findMany({
                  where: { id: { in: dagUniqueSkillIds } },
                  select: { id: true, name: true, displayName: true, description: true },
                });
                
                const skillExecutionLog = {
                  evaluationId: dagEvaluation.id,
                  projectId: id,
                  startedAt: new Date().toISOString(),
                  skills: skillsForLog.map(s => ({
                    id: s.id,
                    name: s.name,
                    displayName: s.displayName,
                    description: s.description,
                    status: 'pending',
                    startedAt: null,
                    completedAt: null,
                    findingsCount: 0,
                  })),
                };
                
                const logPath = join(workspaceDir, 'skill-execution-log.json');
                await writeFile(logPath, JSON.stringify(skillExecutionLog, null, 2), 'utf-8');
                logger.debug(LOG_MODULES.SKILL, '[DAG Async] 已创建 Skill 执行记录文件', { path: logPath });
              } catch (error) {
                logger.errorNoUser(LOG_MODULES.SKILL, '[DAG Async] 创建 Skill 执行记录文件失败', { error });
              }
            }
            
            // ========================================
            // Step 4: 更新状态为 running 并启动 DAG
            // ========================================
            await prisma.evaluationSession.update({
              where: { id: dagEvaluation.id },
              data: { 
                status: 'running', 
                startedAt: new Date(),
                modelName: modelConfig.name,
              },
            });
            
            // 更新项目状态为 running
            await prisma.project.update({
              where: { id },
              data: { status: 'running' },
            });
            
            emitEvaluationStarted(dagEvaluation.id, {
              workflowType: 'dag',
              message: 'DAG 工作流已启动',
            });
            
            logger.info(LOG_MODULES.EVALUATION, '[DAG Async] 评估状态更新为 running，开始 DAG 执行', {
              evaluationId: dagEvaluation.id,
            });
            
            // ========================================
            // Step 5: 创建并执行统一执行引擎
            // ========================================
            
            // 构建默认模型配置
            const dagDefaultModelConfig: ModelConfigForExecution = {
              id: modelConfig.id,
              name: modelConfig.name,
              providerType: modelConfig.providerType,
              apiKey: modelConfig.apiKey,
              apiBaseUrl: modelConfig.apiBaseUrl || '',
              models: modelConfig.models,
            };
            
            // 创建统一执行引擎配置
            const dagEngineConfig = {
              evaluationSessionId: dagEvaluation.id,
              projectId: id,
              projectName: project.name,
              workflowId: workflowId,
              workflowType: 'custom' as const,
              workspacePath: project.projectPath || '',
              systemPrompt: sdkOptions.systemPrompt,
              roleModels: roleModels || undefined,
              defaultModelConfig: dagDefaultModelConfig,
              maxIterationsPerNode: 15,
              maxRetries: 15,
              retryDelayMs: 60000,
              workflowConfig: workflowConfigParsed || undefined,
            };
            
            logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 统一执行引擎配置', {
              evaluationSessionId: dagEvaluation.id,
              projectId: id,
              workflowId,
              nodeCount: sortedNodes.length,
              roleModelsCount: roleModels?.length || 0,
            });
            
            // 创建统一执行引擎实例
            const dagEngine = createUnifiedExecutionEngine(dagEngineConfig, {
              onNodeStart: async (nodeIndex, nodeId, nodeName) => {
                logger.debug(LOG_MODULES.EVALUATION, `[DAG Async] 节点 ${nodeIndex + 1}/${sortedNodes.length} 开始: ${nodeName}`);
                
                // 获取节点模型配置
                const node = sortedNodes[nodeIndex];
                const modelConfigForNode = await getModelConfigForRole(node.roleId ?? undefined, roleModels, dagDefaultModelConfig);
                
                // 创建节点执行记录
                try {
                  await prisma.nodeExecution.create({
                    data: {
                      id: generateId('nodeexec'),
                      evaluationSessionId: dagEvaluation.id,
                      workflowNodeId: nodeId,
                      nodeLabel: nodeName,
                      nodeType: 'task',
                      status: 'running',
                      order: nodeIndex,
                      startedAt: new Date(),
                      modelName: modelConfigForNode.name,
                      modelConfigId: modelConfigForNode.id,
                      updatedAt: new Date(),
                    },
                  });
                } catch (e) {
                  logger.errorNoUser(LOG_MODULES.EVALUATION, '[DAG Async] Node 执行记录创建失败', { nodeId, error: e });
                }
                
                // 发送节点开始事件到事件总线
                const { emitPhaseStart } = await import('@/lib/event-bus');
                emitPhaseStart(dagEvaluation.id, {
                  nodeIndex: nodeIndex + 1,
                  nodeId: nodeId,
                  nodeName: nodeName,
                  modelName: modelConfigForNode.name,
                  totalNodes: sortedNodes.length,
                });
              },
              
              onNodeChunk: (nodeIndex, text) => {
                // 发送文本流事件到事件总线
                emitMessageChunk(dagEvaluation.id, text);
              },
              
              onNodeToolCall: (nodeIndex, tool, args) => {
                logger.debug(LOG_MODULES.EVALUATION, `[DAG Async] 工具调用: ${tool}`, { nodeIndex });
                
                // 检测 TodoWrite 工具调用
                if (tool === 'TodoWrite' && args?.todos && Array.isArray(args.todos)) {
                  // 为每个todo添加当前节点的nodeId（使用sortedNodes）
                  const currentNode = sortedNodes[nodeIndex];
                  const todosWithNodeId = args.todos.map((todo: any) => ({
                    ...todo,
                    nodeId: currentNode?.id || null,
                    workflowNodeId: currentNode?.id || null,
                    nodeIndex: nodeIndex,
                  }));
                  
                  logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] TodoWrite 保存', {
                    nodeIndex,
                    nodeId: currentNode?.id,
                    todosCount: todosWithNodeId.length,
                  });
                  
                  emitTodoUpdate(dagEvaluation.id, todosWithNodeId);
                }
              },
              
              onTokenUsage: (data) => {
                // 发送 Token 使用事件到事件总线
                emitPhaseTokenUsage(dagEvaluation.id, {
                  nodeIndex: data.nodeIndex + 1,
                  nodeName: data.nodeName,
                  modelName: data.modelName,
                  inputTokens: data.inputTokens,
                  outputTokens: data.outputTokens,
                  cumulativeInputTokens: data.cumulativeInputTokens,
                  cumulativeOutputTokens: data.cumulativeOutputTokens,
                });
              },
              
              onNodeRetry: (nodeIndex, nodeId, nodeName, retryCount, maxRetries, error) => {
                logger.warn(LOG_MODULES.EVALUATION, `[DAG Async] 节点 ${nodeName} 重试 ${retryCount}/${maxRetries}`, { error: error.message });
              },
              
              onNodeComplete: async (nodeIndex, result) => {
                logger.debug(LOG_MODULES.EVALUATION, `[DAG Async] 节点 ${result.nodeName} 完成`, {
                  status: result.status,
                  duration: result.duration,
                  iterations: result.iterations,
                });
                
                // 更新节点状态到数据库
                try {
                  await prisma.nodeExecution.updateMany({
                    where: {
                      evaluationSessionId: dagEvaluation.id,
                      workflowNodeId: result.nodeId,
                    },
                    data: {
                      status: result.status === 'completed' ? 'completed' : 'failed',
                      completedAt: new Date(),
                      updatedAt: new Date(),
                    },
                  });
                } catch (e) {
                  logger.errorNoUser(LOG_MODULES.EVALUATION, '[DAG Async] Node 状态更新失败', { nodeId: result.nodeId, error: e });
                }
                
                // 发送节点完成事件到事件总线
                emitNodeComplete(dagEvaluation.id, result.nodeId);
              },
              
              onNodeError: (nodeIndex, nodeId, nodeName, error) => {
                logger.errorNoUser(LOG_MODULES.EVALUATION, `[DAG Async] 节点 ${nodeName} 错误`, { error: error.message });
              },
              
              onWorkflowComplete: async (result) => {
                logger.info(LOG_MODULES.EVALUATION, '[DAG Async] 工作流完成', {
                  status: result.status,
                  totalDuration: result.totalDuration,
                  totalInputTokens: result.totalInputTokens,
                  totalOutputTokens: result.totalOutputTokens,
                });
                
                // 完成所有未完成的 Skill 执行记录
                await completeAllPendingSkillExecutions({
                  evaluationId: dagEvaluation.id,
                  status: result.status === 'completed' ? 'completed' : 'failed',
                  reason: result.endReason || '工作流完成',
                });
                
                // 使用统一评估完成服务
                const projectPath = project.projectPath || process.cwd();
                if (result.status === 'completed') {
                  await completeEvaluationSuccess(dagEvaluation.id, id, projectPath, `DAG: ${sortedNodes.length} nodes`, { input: result.totalInputTokens, output: result.totalOutputTokens });
                } else {
                  await completeEvaluationFailed(dagEvaluation.id, id, projectPath, result.endMessage || 'DAG 执行失败', result.endReason);
                }
                
                // 更新项目状态
                await prisma.project.update({
                  where: { id },
                  data: { status: result.status === 'completed' ? 'completed' : 'failed' },
                });
                
                // 发送评估完成事件
                emitEvaluationComplete(dagEvaluation.id, {
                  status: result.status,
                  totalDuration: result.totalDuration,
                  totalTokens: (result.totalInputTokens || 0) + (result.totalOutputTokens || 0),
                  message: result.endMessage || 'DAG 工作流执行完成',
                });
              },
              
              onWorkflowError: async (error) => {
                logger.errorNoUser(LOG_MODULES.EVALUATION, '[DAG Async] 工作流错误', { error: error.message });
                
                // 使用统一评估完成服务
                const projectPath = project.projectPath || process.cwd();
                await completeEvaluationFailed(dagEvaluation.id, id, projectPath, error.message);
                
                // 更新项目状态
                await prisma.project.update({
                  where: { id },
                  data: { status: 'failed' },
                });
                
                // 发送评估完成事件（失败）
                emitEvaluationComplete(dagEvaluation.id, {
                  status: 'failed',
                  error: error.message,
                  message: 'DAG 工作流执行失败',
                });
              },
            });
            
            // 设置节点列表
            dagEngine.setNodes(sortedNodes);
            
            logger.debug(LOG_MODULES.EVALUATION, '[DAG Async] 统一执行引擎已创建', { nodeCount: sortedNodes.length });
            
            // 执行 DAG
            await dagEngine.execute();
            
          } catch (error) {
            // 后台执行过程中的错误处理
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.errorNoUser(LOG_MODULES.EVALUATION, '[DAG Async] 后台执行失败', { error: errorMsg });
            
            // 发送准备阶段错误事件
            emitPreparingProgress(dagEvaluation.id, {
              stage: 'error',
              message: '后台准备过程发生错误',
              error: errorMsg,
            });
            
            // 更新评估状态为失败
            await prisma.evaluationSession.update({
              where: { id: dagEvaluation.id },
              data: {
                status: 'failed',
                errorMessage: errorMsg,
                completedAt: new Date(),
                endReason: 'error',
                endMessage: errorMsg,
              },
            });
            
            // 发送评估完成事件（失败）
            emitEvaluationComplete(dagEvaluation.id, {
              status: 'failed',
              error: errorMsg,
              message: '评估准备过程失败',
            });
            
            // 更新项目状态
            await prisma.project.update({
              where: { id },
              data: { status: 'failed' },
            });
            
            // 处理队列
            const { processQueue } = await import('@/services/evaluation-queue');
            processQueue().catch(err => logger.errorNoUser(LOG_MODULES.EVALUATION, '[DAG Async] 处理队列失败', { error: err }));
          }
        })();
        
        // 返回 SSE 流响应
        return new NextResponse(dagStream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
        }
      } catch (error) {
        logger.errorNoUser(LOG_MODULES.EVALUATION, 'Skills 同步或工作流启动失败', { error });
        return NextResponse.json({
          error: `Skills 同步或工作流启动失败: ${error instanceof Error ? error.message : String(error)}`,
        }, { status: 500 });
      }
    }
    
    // 如果不是 FSM 或 DAG 工作流，返回错误
    return NextResponse.json({
      error: '不支持的工作流类型，仅支持 FSM 或 DAG 工作流',
    }, { status: 400 });
    
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '启动项目错误', { error });
    return NextResponse.json({ error: '服务器内部错误', details: String(error) }, { status: 500 });
  }
}

/**
 * 根据文件名获取代码块语言标识
 */
function getCodeBlockLang(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    mjs: 'javascript',
    cjs: 'javascript',
    // 后端语言
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    cs: 'csharp',
    php: 'php',
    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    // 数据/配置
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    sql: 'sql',
    // Shell
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    ps1: 'powershell',
    bat: 'batch',
    cmd: 'batch',
    // 其他
    md: 'markdown',
    txt: 'text',
    log: 'text',
    csv: 'text',
    // C 系列
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    h: 'c',
    hpp: 'cpp',
  };
  return langMap[ext] || 'text';
}

/**
 * 获取模型配置
 * @param modelId 可选的模型ID，如果提供则使用该模型，否则使用默认模型
 * @param userId 可选的用户ID，用于权限过滤
 */
async function getModelConfig(modelId?: string | null, userId?: string | null) {
  // 如果提供了 modelId，直接使用该模型（需要检查权限）
  if (modelId) {
    const selectedModel = await prisma.modelConfig.findUnique({
      where: { id: modelId },
    });
    if (selectedModel && selectedModel.isActive) {
      // 检查用户是否有权限使用该模型
      const hasAccess = 
        selectedModel.userId === null ||  // 系统模型
        selectedModel.isPublic ||          // 公开模型
        selectedModel.userId === userId;  // 用户自己的模型
      
      if (hasAccess) {
        return selectedModel;
      }
      logger.warn(LOG_MODULES.MODEL, '用户无权使用模型', { userId: userId ?? undefined, modelId });
    }
    logger.warn(LOG_MODULES.MODEL, '指定的模型不存在或未激活，将使用默认模型', { modelId });
  }
  
  // 使用数据库配置（优先默认模型）
  const defaultModel = await prisma.modelConfig.findFirst({
    where: {
      isActive: true,
      isDefault: true,
      OR: [
        { userId: null },    // 系统模型
        { isPublic: true },  // 公开模型
        userId ? { userId } : {},  // 用户自己的模型
      ],
    },
  });

  if (defaultModel) {
    return defaultModel;
  }

  // 如果没有默认模型，查找第一个可用的模型
  const firstModel = await prisma.modelConfig.findFirst({
    where: {
      isActive: true,
      OR: [
        { userId: null },    // 系统模型
        { isPublic: true },  // 公开模型
        userId ? { userId } : {},  // 用户自己的模型
      ],
    },
  });
  return firstModel;
}

/**
 * 根据 roleId 获取模型配置（用于统一执行引擎）
 * @param roleId 角色 ID
 * @param roleModels 角色模型配置映射
 * @param defaultModelConfig 默认模型配置
 */
async function getModelConfigForRole(
  roleId: string | undefined,
  roleModels: { roleId: string; modelId: string }[] | null | undefined,
  defaultModelConfig: ModelConfigForExecution
): Promise<ModelConfigForExecution> {
  // 如果没有 roleModels 配置，使用默认模型
  if (!roleModels || roleModels.length === 0) {
    return defaultModelConfig;
  }
  
  // 查找角色对应的模型 ID
  const targetRoleId = roleId || 'default';
  const roleModel = roleModels.find(rm => rm.roleId === targetRoleId);
  
  if (!roleModel) {
    return defaultModelConfig;
  }
  
  const modelId = roleModel.modelId;
  
  // 从数据库加载模型配置
  try {
    const modelConfig = await prisma.modelConfig.findUnique({
      where: { id: modelId },
    });
    
    if (!modelConfig) {
      logger.warn(LOG_MODULES.MODEL, '模型配置不存在', { modelId });
      return defaultModelConfig;
    }
    
    return {
      id: modelConfig.id,
      name: modelConfig.name,
      providerType: modelConfig.providerType,
      apiKey: modelConfig.apiKey,
      apiBaseUrl: modelConfig.apiBaseUrl || '',
      models: modelConfig.models,
    };
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MODEL, '加载模型配置失败', { modelId, error });
    return defaultModelConfig;
  }
}

/**
 * 构建 Skills 使用说明提示词（V2 - 区分必须执行和可选择）
 * - 必须执行的 Skills：工作流节点明确指定的（模式2/3），Agent 必须调用
 * - 可选择的 Skills：供自定义描述节点选择（模式1），Agent 根据描述自主决定
 */
function buildSkillsUsagePromptV2(
  mandatorySkills: Array<{ 
    id: string; 
    name: string; 
    displayName: string; 
    description: string; 
    severity: string | null;
  }>,
  availableSkills: Array<{ 
    id: string; 
    name: string; 
    displayName: string; 
    description: string; 
    severity: string | null;
  }>
): string {
  if (mandatorySkills.length === 0 && availableSkills.length === 0) return '';
  
  const severityLabels: Record<string, string> = {
    critical: '严重',
    high: '高危',
    medium: '中危',
    low: '低危',
    info: '信息',
  };
  
  let prompt = '## 🔧 安全检测技能 (Skills)\n\n';
  
  // 必须执行的 Skills（模式 2/3）- 强制执行
  if (mandatorySkills.length > 0) {
    prompt += '### ⚠️ 【强制执行】必须完成的技能检测\n\n';
    prompt += '**以下技能由工作流节点明确指定，你必须逐一执行并完成检测：**\n\n';
    
    for (let i = 0; i < mandatorySkills.length; i++) {
      const skill = mandatorySkills[i];
      const severityLabel = skill.severity ? severityLabels[skill.severity] || skill.severity : '未分级';
      prompt += `${i + 1}. **${skill.displayName}** (\`${skill.name}\`)\n`;
      prompt += `   - 严重程度: ${severityLabel}\n`;
      prompt += `   - 说明: ${skill.description}\n`;
      prompt += `   - 执行命令: \`Skill(skill_name="${skill.name}")\`\n\n`;
    }
    
    prompt += '**🔴 强制要求**：\n';
    prompt += '- 你必须使用 `Skill` 工具依次加载并执行上述每一个技能\n';
    prompt += '- 不允许跳过任何一项\n';
    prompt += '- 每个技能执行后，必须输出检测结果\n';
    prompt += '- 最终报告中必须包含所有技能的检测结果\n\n';
    
    // 构建执行清单，便于 Agent 逐项检查
    prompt += '**执行清单**（完成后请勾选）：\n';
    for (let i = 0; i < mandatorySkills.length; i++) {
      prompt += `- [ ] ${mandatorySkills[i].displayName}\n`;
    }
    prompt += '\n';
  }
  
  // 可选择的 Skills（模式 1）
  if (availableSkills.length > 0) {
    prompt += '### 📋 【可选】根据需要选择的技能\n\n';
    prompt += '**以下技能已准备就绪，你可以根据任务描述和项目特点自主选择执行：**\n\n';
    
    for (const skill of availableSkills) {
      const severityLabel = skill.severity ? severityLabels[skill.severity] || skill.severity : '未分级';
      prompt += `- **${skill.displayName}** (\`${skill.name}\`) - ${severityLabel}: ${skill.description}\n`;
    }
    
    prompt += '\n**提示**: 上述可选技能位于 `.claude/skills/` 目录，使用 `Skill(skill_name="技能名称")` 加载执行。\n\n';
  }
  
  // 使用方法
  prompt += '### Skill 工具使用方法\n\n';
  prompt += '```\n';
  prompt += 'Skill(skill_name="技能名称")\n';
  prompt += '```\n';
  prompt += '例如：`Skill(skill_name="sql-injection")` 会加载并执行 SQL 注入检测技能。\n\n';
  prompt += '技能加载后，请仔细阅读 SKILL.md 中的检测方法，然后执行检测并输出结果。\n';
  
  return prompt;
}

/**
 * 构建 Skills 使用说明提示词（旧版本，保留兼容）
 */
function buildSkillsUsagePrompt(skills: Array<{ 
  id: string; 
  name: string; 
  displayName: string; 
  description: string; 
  severity: string | null;
}>): string {
  return buildSkillsUsagePromptV2(skills, []);
}

/**
 * 构建评估报告分析要求提示词
 * 要求大模型输出项目概况、架构分析、入口点分析、认证鉴权分析
 */
function buildAnalysisReportPrompt(): string {
  let prompt = '\n\n## 📋 评估报告要求\n\n';
  prompt += '在评估过程中，你需要输出以下分析内容。请在评估完成时，将分析结果以 JSON 格式输出：\n\n';
  
  prompt += '### 1. 项目概况\n';
  prompt += '```json\n';
  prompt += '{\n';
  prompt += '  "projectOverview": {\n';
  prompt += '    "projectName": "项目名称",\n';
  prompt += '    "description": "项目描述（分析项目的主要功能和用途）",\n';
  prompt += '    "techStack": ["技术栈1", "技术栈2"]\n';
  prompt += '  }\n';
  prompt += '}\n';
  prompt += '```\n\n';
  
  prompt += '### 2. 项目架构分析\n';
  prompt += '```json\n';
  prompt += '{\n';
  prompt += '  "architecture": {\n';
  prompt += '    "projectType": "Web应用/移动应用/API服务/桌面应用",\n';
  prompt += '    "frontend": "前端技术栈（如 React, Vue, Angular 等）",\n';
  prompt += '    "backend": "后端技术栈（如 Express, Spring, Django 等）",\n';
  prompt += '    "database": "数据库类型（如 MySQL, PostgreSQL, MongoDB 等）",\n';
  prompt += '    "directoryStructure": {\n';
  prompt += '      "src/": "源代码目录",\n';
  prompt += '      "src/components/": "组件目录"\n';
  prompt += '    },\n';
  prompt += '    "summary": "架构概述（详细描述项目的整体架构设计）"\n';
  prompt += '  }\n';
  prompt += '}\n';
  prompt += '```\n\n';
  
  prompt += '### 3. 入口点分析\n';
  prompt += '```json\n';
  prompt += '{\n';
  prompt += '  "entryPoints": {\n';
  prompt += '    "apiEndpoints": [\n';
  prompt += '      { "method": "GET", "path": "/api/users", "auth": "public", "description": "获取用户列表" },\n';
  prompt += '      { "method": "POST", "path": "/api/auth/login", "auth": "public", "description": "用户登录" }\n';
  prompt += '    ],\n';
  prompt += '    "pageEntries": [\n';
  prompt += '      { "path": "/", "description": "首页", "authRequired": false },\n';
  prompt += '      { "path": "/dashboard", "description": "仪表盘", "authRequired": true }\n';
  prompt += '    ],\n';
  prompt += '    "userInputPoints": [\n';
  prompt += '      { "location": "登录表单", "fields": ["username", "password"], "type": "form" },\n';
  prompt += '      { "location": "搜索框", "fields": ["query"], "type": "search" }\n';
  prompt += '    ],\n';
  prompt += '    "summary": "入口点分析概述"\n';
  prompt += '  }\n';
  prompt += '}\n';
  prompt += '```\n\n';
  
  prompt += '### 4. 认证鉴权分析\n';
  prompt += '```json\n';
  prompt += '{\n';
  prompt += '  "authentication": {\n';
  prompt += '    "authType": "JWT / Session / OAuth / 其他",\n';
  prompt += '    "tokenStorage": "Cookie / localStorage / sessionStorage",\n';
  prompt += '    "tokenExpiry": "Token 过期时间",\n';
  prompt += '    "refreshMechanism": "刷新机制说明",\n';
  prompt += '    "authzModel": "RBAC / ACL / ABAC / 其他",\n';
  prompt += '    "roles": ["admin", "user", "guest"],\n';
  prompt += '    "sessionManagement": {\n';
  prompt += '      "login": "POST /api/auth/login",\n';
  prompt += '      "logout": "POST /api/auth/logout",\n';
  prompt += '      "refresh": "POST /api/auth/refresh"\n';
  prompt += '    },\n';
  prompt += '    "securityConfig": {\n';
  prompt += '      "https": true,\n';
  prompt += '      "cors": "允许的来源",\n';
  prompt += '      "csp": true,\n';
  prompt += '      "csrf": true\n';
  prompt += '    },\n';
  prompt += '    "summary": "认证鉴权分析概述"\n';
  prompt += '  }\n';
  prompt += '}\n';
  prompt += '```\n\n';
  
  prompt += '**输出要求**：\n';
  prompt += '1. 请将上述四个部分合并为一个完整的 JSON 对象输出\n';
  prompt += '2. JSON 必须使用 ```json 代码块包裹\n';
  prompt += '3. 确保所有字段都有值，不要省略\n';
  prompt += '4. 分析内容要基于实际代码，不要猜测\n\n';
  
  prompt += '**输出格式示例**：\n';
  prompt += '```json\n';
  prompt += '{\n';
  prompt += '  "projectOverview": { ... },\n';
  prompt += '  "architecture": { ... },\n';
  prompt += '  "entryPoints": { ... },\n';
  prompt += '  "authentication": { ... }\n';
  prompt += '}\n';
  prompt += '```\n';
  
  return prompt;
}
