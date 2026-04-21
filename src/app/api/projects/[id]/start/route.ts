// src/app/api/projects/[id]/start/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
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
import { createEmptyAnalysisReport } from '@/services/analysis-report';
import { createSkillExecutionsForEvaluation, completeAllPendingSkillExecutions } from '@/services/skill-execution-tracker';
import { generateId, generateIndexedId } from '@/lib/id-generator';
import { UnifiedWorkflowExecutionEngine, createUnifiedExecutionEngine } from '@/lib/workflow/unified-execution-engine';
import { topologicalSortDAG } from '@/lib/workflow/topology-sort';
import type { UnifiedExecutionCallbacks, NodeExecutionResult, WorkflowExecutionResult, ModelConfigForExecution, UnifiedNodeDefinition } from '@/lib/workflow/types';

// 启动项目评估（SSE 流式响应）
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 检查是否为内部调用（队列启动）
    const internalCallToken = request.headers.get('X-Internal-Token');
    const isQueuedStart = internalCallToken === process.env.INTERNAL_API_SECRET;
    
    let payload: { userId: string; permissions: string[] } | null = null;
    
    if (isQueuedStart) {
      // 内部调用：从请求体获取用户信息或使用项目所有者
      const { id } = await params;
      const project = await prisma.project.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (project) {
        // 获取用户权限
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
          payload = { userId: user.id, permissions };
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
    try {
      const body = await request.json();
      workflowId = body.workflowId || null;
      agentTeamId = body.agentTeamId || null;
      modelId = body.modelId || null;
      roleModels = body.roleModels || null;
      queuedEvaluationId = body.queuedEvaluationId || null;
      reconnectEvaluationId = body.evaluationId || null; // 用于重连 SSE
    } catch {
      // 如果没有请求体，继续执行
    }

    logger.debug(LOG_MODULES.EVALUATION, '启动评估参数', { workflowId, modelId, roleModelsCount: roleModels?.length || 0 });

    // 获取项目信息（包括运行中的评估）
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        ProjectFile: true,
        EvaluationSession: {
          where: { status: 'running' },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 项目归属校验
    if (project.userId !== payload.userId) {
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

    // 检查并发限制（队列启动时跳过）
    const maxConcurrent = globalConfig?.maxConcurrentEvaluations || 3;
    const runningCount = await prisma.evaluationSession.count({
      where: { status: 'running' },
    });
    
    logger.debug(LOG_MODULES.EVALUATION, '并发限制检查', { runningCount, maxConcurrent });
    
    // 如果超出并发限制且不是队列启动，创建排队状态的评估
    if (!isQueuedStart && runningCount >= maxConcurrent) {
      logger.debug(LOG_MODULES.EVALUATION, '超出并发限制，创建排队评估');
      
      // 创建排队状态的评估会话
      const queuedEvaluation = await prisma.evaluationSession.create({
        data: {
          id: generateId('eval'),
          projectId: id,
          workflowId: workflowId,
          agentTeamId: agentTeamId,
          modelConfigId: modelId, // 保存请求的模型配置ID
          roleModels: roleModels ? JSON.stringify(roleModels) : null,
          status: 'queued',
          providerType: 'queued', // 标记为排队状态
        },
      });
      
      return NextResponse.json({
        message: '评估已加入排队队列',
        evaluationId: queuedEvaluation.id,
        status: 'queued',
        queuePosition: runningCount - maxConcurrent + 1,
        maxConcurrent,
      }, { status: 202 }); // 202 Accepted 表示请求已接受但未处理
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

    // 检查是否有运行中的评估会话
    const runningEvaluations = project.EvaluationSession || [];
    
    // 如果是 SSE 重连（提供了 evaluationId），且该评估正在运行
    if (reconnectEvaluationId) {
      const targetEvaluation = runningEvaluations.find(e => e.id === reconnectEvaluationId);
      if (targetEvaluation) {
        logger.debug(LOG_MODULES.EVALUATION, 'SSE 重连到现有评估', { evaluationId: reconnectEvaluationId });
        
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
    
    if (runningEvaluations.length > 0) {
      return NextResponse.json({ 
        error: '项目已在运行中', 
        runningEvaluationId: runningEvaluations[0].id 
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
    if (project.projectPath) {
      const cleanupTargets = [
        { path: join(project.projectPath, 'workspace'), type: 'dir' },
        { path: join(project.projectPath, 'vulnerabilities'), type: 'dir' },
        { path: join(project.projectPath, '.claude'), type: 'dir' },
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
      
      // 创建评估所需的工作目录
      const workDirs = [
        join(project.projectPath, 'vulnerabilities'),
        join(project.projectPath, 'workspace'),
        join(project.projectPath, 'workspace', 'decompile_src'),
        join(project.projectPath, 'workspace', 'extract_zip'),
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
      // 在创建目录后、评估开始前执行
      // 适用于 FSM 和 DAG 两种流程
      // ========================================
      logger.info(LOG_MODULES.EVALUATION, '[MCP] 开始检查 AI4Java MCP 服务器配置', {
        mcpServersCount: mcpServers.length,
        mcpServerNames: mcpServers.map(s => s.name),
      });
      
      try {
        // 查找 AI4Java MCP 服务器配置（优先项目级别，其次共享）
        const ai4javaMcp = mcpServers.find(s => s.name === 'ai4java' && s.isEnabled);
        
        if (ai4javaMcp && ai4javaMcp.type === 'local' && ai4javaMcp.command) {
          logger.info(LOG_MODULES.EVALUATION, '[MCP] 检测到 AI4Java MCP 本地服务器，准备执行 decompileProject', {
            serverId: ai4javaMcp.id,
            serverName: ai4javaMcp.name,
            command: ai4javaMcp.command,
            args: ai4javaMcp.args,
            projectPath: project.projectPath,
          });
          
          const { callAi4JavaDecompile } = await import('@/lib/mcp-client');
          
          const startTime = Date.now();
          logger.info(LOG_MODULES.EVALUATION, '[MCP] 开始调用 decompileProject 工具...');
          
          const decompileResult = await callAi4JavaDecompile(
            {
              command: ai4javaMcp.command,
              args: ai4javaMcp.args ? JSON.parse(ai4javaMcp.args) : [],
              env: ai4javaMcp.env ? JSON.parse(ai4javaMcp.env) : {},
              timeout: 10 * 60 * 1000, // 10 分钟超时（反编译可能较慢）
            },
            project.projectPath
          );
          
          const duration = Date.now() - startTime;
          
          if (decompileResult.success) {
            logger.info(LOG_MODULES.EVALUATION, '[MCP] decompileProject 执行成功', {
              duration: `${duration}ms`,
              durationSeconds: (duration / 1000).toFixed(2),
              contentLength: decompileResult.content ? JSON.stringify(decompileResult.content).length : 0,
              contentPreview: decompileResult.content ? JSON.stringify(decompileResult.content).substring(0, 500) : null,
            });
          } else {
            logger.warn(LOG_MODULES.EVALUATION, '[MCP] decompileProject 执行失败', {
              duration: `${duration}ms`,
              error: decompileResult.error,
              isError: decompileResult.isError,
            });
          }
        } else if (ai4javaMcp && ai4javaMcp.type === 'remote') {
          // 远程 MCP 服务器暂不支持直接调用
          logger.warn(LOG_MODULES.EVALUATION, '[MCP] AI4Java MCP 配置为远程服务器，暂不支持启动前调用 decompileProject', {
            serverId: ai4javaMcp.id,
            serverName: ai4javaMcp.name,
            url: ai4javaMcp.url,
          });
        } else {
          logger.info(LOG_MODULES.EVALUATION, '[MCP] 未检测到 AI4Java MCP 服务器配置，跳过 decompileProject', {
            availableServers: mcpServers.map(s => s.name),
            hint: '请在 MCP 服务器管理中添加名为 "ai4java" 的本地 MCP 服务器',
          });
        }
      } catch (error) {
        // 反编译失败不应阻止评估启动
        logger.errorNoUser(LOG_MODULES.EVALUATION, '[MCP] 调用 AI4Java decompileProject 异常', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
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
          logger.info(LOG_MODULES.EVALUATION, '检测到 FSM 工作流，切换到 FSM 执行模式');
          
          // FSM 模式：调用 FSM 执行服务
          // 创建评估记录
          const evaluation = await prisma.evaluationSession.create({
            data: {
              id: generateId('eval'),
              projectId: id,
              workflowId: workflowId,
              modelConfigId: modelId,
              roleModels: roleModels ? JSON.stringify(roleModels) : null,
              status: 'running',
              providerType: modelConfig.providerType,
              workflowType: 'fsm',
            },
          });
          
          // 调用 FSM 启动逻辑
          const { createFSMWorkflowExecutionService } = await import('@/lib/fsm');
          
          const fsmService = createFSMWorkflowExecutionService(
            {
              evaluationSessionId: evaluation.id,
              projectId: id,
              workflowId: workflowId,
              fsmTemplateId: workflow.fsmTemplateId || 'threat-modeling',
              workspacePath: project.projectPath,
              maxIterationsPerPhase: 10,
              maxCostPerPhase: 2.0,
              modelConfig,
              systemPrompt: sdkOptions.systemPrompt,  // 传递系统提示词
              roleModels: roleModels || undefined,  // 传递角色模型配置
            },
            {
              onPhaseStart: async (phase, phaseName) => {
                logger.debug(LOG_MODULES.FSM, `Phase ${phase} (${phaseName}) 开始`);
              },
              onPhaseChunk: (phase, text) => {},
              onPhaseToolCall: (phase, tool, args) => {
                logger.debug(LOG_MODULES.FSM, `Phase ${phase} 工具调用: ${tool}`);
              },
              onPhaseComplete: async (phase, result) => {
                logger.info(LOG_MODULES.FSM, `Phase ${phase} 完成`, {
                  details: { iterations: result.iterations, duration: result.duration, status: result.status },
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
                logger.info(LOG_MODULES.FSM, `Agent Zone 完成`, { details: { total: results.length } });
              },
              onWorkflowComplete: async (result) => {
                logger.info(LOG_MODULES.FSM, `FSM 工作流完成`, {
                  details: { 
                    status: result.status, 
                    duration: result.totalDuration,
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
                
                // 收集失败阶段的错误信息
                const failedPhasesInfo = result.phaseResults
                  .filter(p => p.status === 'failed')
                  .map(p => `Phase ${p.phaseNumber} (${p.phaseName})`)
                  .join(', ');
                
                const errorMessage = result.status !== 'completed' 
                  ? `工作流未完成。失败阶段: ${failedPhasesInfo || '未知'}` 
                  : null;
                
                await prisma.evaluationSession.update({
                  where: { id: evaluation.id },
                  data: {
                    status: result.status === 'completed' ? 'completed' : 'failed',
                    completedAt: new Date(),
                    totalInputTokens: result.totalTokens > 0 ? result.totalTokens : undefined,
                    totalOutputTokens: 0,
                    endReason: result.status === 'completed' ? 'completed' : 'error',
                    endMessage: errorMessage,
                    errorMessage: errorMessage,
                  },
                });
              },
              onWorkflowError: (error) => {
                logger.errorNoUser(LOG_MODULES.FSM, `FSM 工作流错误: ${error.message}`);
                prisma.evaluationSession.update({
                  where: { id: evaluation.id },
                  data: { 
                    status: 'failed', 
                    errorMessage: error.message, 
                    completedAt: new Date(),
                    endReason: 'error',
                    endMessage: error.message,
                  },
                }).catch(() => {});
              },
              // 实时推送 token 使用量和模型信息
              onTokenUsage: (data) => {
                logger.debug(LOG_MODULES.FSM, `[SSE] Token 使用推送:`, data);
                // 通过全局事件发送（由 SSE 流处理）
                // 这里我们使用一个简单的方式：存储到全局状态，让 SSE 轮询获取
                // 或者使用更复杂的 SSE 控制器引用
              },
            }
          );
          
          // 返回 SSE 流 - FSM 模式需要支持实时推送
          const encoder = new TextEncoder();
          let sseController: ReadableStreamDefaultController | null = null;
          
          // 创建一个事件队列，用于 FSM 后台执行和 SSE 流之间的通信
          const eventQueue: any[] = [];
          
          // 设置 onTokenUsage 回调，推送事件到队列
          const originalOnTokenUsage = fsmService['callbacks'].onTokenUsage;
          fsmService['callbacks'].onTokenUsage = (data) => {
            // 调用原始回调
            if (originalOnTokenUsage) {
              originalOnTokenUsage(data);
            }
            // 推送事件到队列
            const event = {
              type: 'token_usage',
              ...data,
            };
            eventQueue.push(event);
            // 如果 SSE 控制器可用，立即发送
            if (sseController) {
              sseController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
          };
          
          // 修改 onPhaseComplete 回调，推送阶段完成事件
          const originalOnPhaseComplete = fsmService['callbacks'].onPhaseComplete;
          fsmService['callbacks'].onPhaseComplete = async (phase, result) => {
            if (originalOnPhaseComplete) {
              await originalOnPhaseComplete(phase, result);
            }
            // 推送阶段完成事件
            const event = {
              type: 'phase_complete',
              phase: result.phaseNumber,
              phaseName: result.phaseName,
              status: result.status,
              totalTokens: result.totalTokens,
              iterations: result.iterations,
              duration: result.duration,
            };
            if (sseController) {
              sseController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
          };
          
          // 修改 onWorkflowComplete 回调
          const originalOnWorkflowComplete = fsmService['callbacks'].onWorkflowComplete;
          fsmService['callbacks'].onWorkflowComplete = async (result) => {
            if (originalOnWorkflowComplete) {
              await originalOnWorkflowComplete(result);
            }
            // 推送工作流完成事件
            if (sseController) {
              sseController.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'done',
                status: result.status,
                totalTokens: result.totalTokens,
                totalCost: result.totalCost,
                totalDuration: result.totalDuration,
                message: 'FSM 工作流执行完成',
              })}\n\n`));
              sseController.close();
            }
          };
          
          const stream = new ReadableStream({
            start(controller) {
              sseController = controller;
              // 发送启动事件
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'started',
                evaluationId: evaluation.id,
                workflowType: 'fsm',
                message: 'FSM 工作流已启动',
              })}\n\n`));
              
              // 后台执行 FSM
              fsmService.execute().catch(async (error) => {
                logger.errorNoUser(LOG_MODULES.FSM, `FSM 执行失败: ${error.message}`);
                await prisma.evaluationSession.update({
                  where: { id: evaluation.id },
                  data: { status: 'failed', errorMessage: error.message, completedAt: new Date() },
                });
                // 发送错误事件
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'error',
                  error: error.message,
                })}\n\n`));
                controller.close();
              });
            },
            cancel() {
              sseController = null;
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

        // ========================================
        // DAG 模式：按 WorkflowNode 加载 Skills
        // ========================================

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

        logger.debug(LOG_MODULES.EVALUATION, '找到 WorkflowNode', { count: workflowNodes.length });

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
              logger.debug(LOG_MODULES.EVALUATION, 'Node 模式 3 - 漏洞分类', { nodeId: node.id, categories: categoryValues.join(', ') });
              const matchedIds = await matchSkillsByCategoryValues(categoryValues, projectTechStack);
              
              // 记录匹配结果
              nodeCategoryMatchResults.push({
                nodeId: node.id,
                categories: categoryValues,
                matchedCount: matchedIds.length,
              });
              
              // 模式3：如果筛选结果为空，直接返回错误
              if (matchedIds.length === 0) {
                const techStackMsg = projectTechStack && projectTechStack.length > 0 
                  ? `，技术栈: ${projectTechStack.join(', ')}` 
                  : '';
                return NextResponse.json({
                  error: `工作流节点 [${node.id}] 指定的漏洞分类 [${categoryValues.join(', ')}]${techStackMsg} 没有匹配到任何满足条件的 Skill（技术栈匹配 + 启用状态）。请检查漏洞分类是否正确，或联系管理员添加相关 Skills。`,
                }, { status: 400 });
              }
              
              allSkillIds.push(...matchedIds);
              logger.debug(LOG_MODULES.EVALUATION, 'Node 匹配到 Skills', { nodeId: node.id, matchedCount: matchedIds.length });
              continue;
            }
          }

          // 模式 2：手工指定
          if (node.skills) {
            logger.debug(LOG_MODULES.EVALUATION, 'Node 模式 2 - 手工指定 Skills', { nodeId: node.id });
            try {
              const skillIds = JSON.parse(node.skills);
              if (Array.isArray(skillIds)) {
                allSkillIds.push(...skillIds);
                logger.debug(LOG_MODULES.EVALUATION, 'Node 指定了 Skills', { nodeId: node.id, skillCount: skillIds.length });
              }
            } catch {
              logger.warn(LOG_MODULES.EVALUATION, 'Node skills 字段 JSON 解析失败', { nodeId: node.id });
            }
            continue;
          }

          // 模式 1：自定义描述 - 由大模型根据描述自主加载 Skills
          // 不预设 Skills，让 Agent 通过 Skill 工具自主选择
          logger.debug(LOG_MODULES.EVALUATION, 'Node 模式 1 - 自定义描述，由 Agent 自主加载 Skills', { nodeId: node.id });
          hasDescriptionModeNode = true;
        }

        // 去重
        uniqueSkillIds = [...new Set(allSkillIds)];
        logger.debug(LOG_MODULES.EVALUATION, '合并后共唯一 Skill IDs（模式2/3）', { count: uniqueSkillIds.length });

        // 模式 1：拷贝所有技术栈匹配的 Skills，供 Agent 自主选择
        if (hasDescriptionModeNode) {
          logger.debug(LOG_MODULES.EVALUATION, '存在自定义描述节点，拷贝所有技术栈匹配的 Skills 供 Agent 自主选择');
          copyResult = await copySkillsToProject(
            project.projectPath,
            payload.userId,
            undefined,
            projectTechStack
          );
          logger.debug(LOG_MODULES.EVALUATION, '已拷贝 Skills 供模式 1 节点自主选择', { successCount: copyResult.success });
          
          // 同时追加模式 2/3 指定的 Skills（必须执行）
          if (uniqueSkillIds.length > 0) {
            const extra = await copySkillsByIds(project.projectPath, uniqueSkillIds, undefined, projectTechStack);
            
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
              
              return NextResponse.json({
                error: `手工指定的 Skills 验证失败: ${invalidDetails}${techStackMsg}。请检查 Skills 是否存在、已启用、且技术栈匹配。`,
              }, { status: 400 });
            }
            
            copyResult.success += extra.success;
            copyResult.failed += extra.failed;
            copyResult.errors.push(...extra.errors);
            copyResult.copiedSkills.push(...extra.copiedSkills);
            copyResult.skillIds.push(...extra.skillIds);
          }
        } else {
          // 全部节点都是手工/漏洞分类模式，按 ID 精确拷贝
          copyResult = await copySkillsByIds(
            project.projectPath,
            uniqueSkillIds,
            undefined,
            projectTechStack
          );
          
          // 模式2：检查验证失败的 Skills
          if (copyResult.invalidSkills && copyResult.invalidSkills.length > 0) {
            const invalidDetails = copyResult.invalidSkills.map((s: any) => {
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
            
            return NextResponse.json({
              error: `手工指定的 Skills 验证失败: ${invalidDetails}${techStackMsg}。请检查 Skills 是否存在、已启用、且技术栈匹配。`,
            }, { status: 400 });
          }
        }
        
        logger.debug(LOG_MODULES.SKILL, 'Skills 同步完成', { success: copyResult.success, failed: copyResult.failed, copiedSkills: copyResult.copiedSkills.join(', ') });
        
        // 区分必须执行的 Skills（模式2/3）和可选择的 Skills（模式1）
        const mandatorySkillIds = uniqueSkillIds; // 模式 2/3 指定的 Skills
        const availableSkillIds = copyResult.skillIds.filter(id => !mandatorySkillIds.includes(id)); // 模式 1 可选择的 Skills
        
        logger.debug(LOG_MODULES.EVALUATION, '必须执行的 Skills（模式2/3）', { count: mandatorySkillIds.length });
        logger.debug(LOG_MODULES.EVALUATION, '可选择的 Skills（模式1）', { count: availableSkillIds.length });
        
        // 记录使用的 Skills ID 列表（记录所有拷贝的 Skills）
        if (copyResult.skillIds.length > 0) {
          const skills = await prisma.skill.findMany({
            where: { id: { in: copyResult.skillIds } },
            select: { id: true, name: true, displayName: true, description: true, severity: true },
          });
          const skillsUsed = skills.map(s => ({ skillId: s.id, skillName: s.name }));
          skillsUsedJson = JSON.stringify(skillsUsed);
          logger.debug(LOG_MODULES.SKILL, '使用的 Skills ID', { count: copyResult.skillIds.length });
          
          // 构建 Skills 使用说明，区分必须执行和可选择
          const mandatorySkills = skills.filter(s => mandatorySkillIds.includes(s.id));
          const availableSkills = skills.filter(s => availableSkillIds.includes(s.id));
          
          const skillsPrompt = buildSkillsUsagePromptV2(mandatorySkills, availableSkills);
          if (skillsPrompt) {
            const originalPrompt = sdkOptions.systemPrompt || '';
            sdkOptions.systemPrompt = originalPrompt + '\n\n' + skillsPrompt;
            logger.debug(LOG_MODULES.EVALUATION, '已将 Skills 使用说明追加到系统提示词');
          }
        }
        
        // 追加评估报告分析要求
        const analysisPrompt = buildAnalysisReportPrompt();
        sdkOptions.systemPrompt = (sdkOptions.systemPrompt || '') + analysisPrompt;
        logger.debug(LOG_MODULES.EVALUATION, '已将评估报告分析要求追加到系统提示词');
        
        if (copyResult.failed > 0) {
          copyResult.errors.forEach(err => {
            logger.errorNoUser(LOG_MODULES.SKILL, 'Skills 同步错误', { error: err });
          });
        }
      } catch (error) {
        logger.errorNoUser(LOG_MODULES.SKILL, 'Skills 同步失败', { error });
        // Skills 同步失败应该阻止评估启动
        return NextResponse.json({
          error: `Skills 同步失败: ${error instanceof Error ? error.message : String(error)}`,
        }, { status: 500 });
      }
    }
    
    // ========================================
    // 使用统一执行引擎执行 DAG 工作流
    // ========================================
    
    // 使用 topologicalSortDAG 获取拓扑排序后的节点
    let sortedNodes: UnifiedNodeDefinition[];
    try {
      sortedNodes = await topologicalSortDAG(workflowId);
      logger.debug(LOG_MODULES.EVALUATION, '拓扑排序完成', { nodeCount: sortedNodes.length });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.errorNoUser(LOG_MODULES.EVALUATION, '拓扑排序失败', { error: errMsg });
      return NextResponse.json({
        error: `工作流拓扑排序失败: ${errMsg}`,
      }, { status: 400 });
    }
    
    if (sortedNodes.length === 0) {
      return NextResponse.json({
        error: '工作流配置缺少节点，无法启动评估',
      }, { status: 400 });
    }
    
    // 计算总任务数（排除 start/end 节点）
    const totalTasks = sortedNodes.filter(n => n.type !== 'start' && n.type !== 'end').length;
    
    logger.debug(LOG_MODULES.EVALUATION, 'DAG 工作流节点信息', {
      totalNodes: sortedNodes.length,
      taskNodes: totalTasks,
      nodes: sortedNodes.map(n => ({ id: n.id, label: n.label, roleId: n.roleId })),
    });
    
    // 统一执行引擎将根据节点信息动态生成提示词
    // 不再需要外部生成 userPrompt
    
    logger.debug(LOG_MODULES.EVALUATION, 'DAG 工作流准备完成，将使用统一执行引擎', {
      totalNodes: sortedNodes.length,
      taskNodes: totalTasks,
    });
    
    // 写入 CLAUDE.md 全局模板到项目 .claude 目录
    if (project.projectPath && globalConfig?.claudemdTemplate) {
      try {
        const claudeDir = join(project.projectPath, '.claude');
        const claudeMdPath = join(claudeDir, 'CLAUDE.md');
        
        // 确保 .claude 目录存在
        try {
          await access(claudeDir);
        } catch {
          await mkdir(claudeDir, { recursive: true });
        }
        
        // 写入 CLAUDE.md 文件（覆盖已存在的文件）
        await writeFile(claudeMdPath, globalConfig.claudemdTemplate, 'utf-8');
        logger.debug(LOG_MODULES.EVALUATION, '已写入 CLAUDE.md 模板', { path: claudeMdPath });
      } catch (error) {
        logger.errorNoUser(LOG_MODULES.EVALUATION, '写入 CLAUDE.md 失败', { error });
        // 继续执行，不阻止评估启动
      }
    }
    
    // 更新项目状态为 running
    await prisma.project.update({
      where: { id },
      data: { status: 'running' },
    });

    // 创建或复用评估会话
    let evaluation;
    if (isQueuedStart && queuedEvaluationId) {
      // 队列启动：复用现有的排队评估记录
      evaluation = await prisma.evaluationSession.update({
        where: { id: queuedEvaluationId },
        data: {
          workflowId: workflowId,
          roleModels: roleModels ? JSON.stringify(roleModels) : null,
          skillsUsed: skillsUsedJson,  // 记录使用的 Skills
          status: 'running',
          startedAt: new Date(),
          modelName: modelConfig.name,
          providerType: modelConfig.providerType,
        },
      });
      logger.debug(LOG_MODULES.EVALUATION, '复用排队评估记录', { evaluationId: evaluation.id });
    } else {
      // 正常启动：创建新的评估记录
      evaluation = await prisma.evaluationSession.create({
        data: {
          id: generateId('eval'),
          projectId: id,
          workflowId: workflowId,
          agentTeamId: agentTeamId, // 关联 Agent Team
          modelConfigId: modelConfig.id, // 关联模型配置
          roleModels: roleModels ? JSON.stringify(roleModels) : null,
          skillsUsed: skillsUsedJson,  // 记录使用的 Skills
          status: 'running',
          modelName: modelConfig.name, // 保存模型名称
          providerType: modelConfig.providerType, // 保存提供商类型
          workflowType: 'dag',
        },
      });
      logger.debug(LOG_MODULES.EVALUATION, '创建新评估记录', { evaluationId: evaluation.id, workflowId, roleModelsCount: roleModels?.length || 0, skillsUsedCount: skillsUsedJson ? JSON.parse(skillsUsedJson).length : 0 });
      
      // 只在日志中记录拷贝的 Skills，不预先创建执行记录
      // 执行记录在实际调用时由 enhanced-caller.ts 创建
      if (copyResult && copyResult.skillIds && copyResult.skillIds.length > 0) {
        logger.debug(LOG_MODULES.SKILL, '已拷贝 Skills 到项目目录', { count: copyResult.skillIds.length });
      }
    }

    // 记录经验引用（哪些经验被注入到本次评估）
    if (injectedExperiences.length > 0) {
      await prisma.experienceUsageLog.createMany({
        data: injectedExperiences.map((e, index) => ({
          id: generateIndexedId('explog', index),
          experienceId: e.id,
          evaluationId: evaluation.id,
          projectId: id,
        })),
      });
      logger.debug(LOG_MODULES.EVALUATION, '已记录经验引用', { count: injectedExperiences.length });
    }

    // 创建空的分析报告（评估过程中由大模型填充）
    try {
      await createEmptyAnalysisReport({
        evaluationId: evaluation.id,
        projectId: id,
      });
      logger.debug(LOG_MODULES.EVALUATION, '已创建分析报告记录');
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.EVALUATION, '创建分析报告记录失败', { error });
    }

    // 创建 Skill 执行记录文件
    if (project.projectPath && uniqueSkillIds.length > 0) {
      try {
        const workspaceDir = join(project.projectPath, 'workspace');
        
        // 确保 workspace 目录存在
        try {
          await access(workspaceDir);
        } catch {
          await mkdir(workspaceDir, { recursive: true });
        }
        
        // 获取 Skills 详细信息
        const skillsForLog = await prisma.skill.findMany({
          where: { id: { in: uniqueSkillIds } },
          select: { id: true, name: true, displayName: true, description: true },
        });
        
        // 构建执行记录
        const skillExecutionLog = {
          evaluationId: evaluation.id,
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
        logger.debug(LOG_MODULES.SKILL, '已创建 Skill 执行记录文件', { path: logPath });
      } catch (error) {
        logger.errorNoUser(LOG_MODULES.SKILL, '创建 Skill 执行记录文件失败', { error });
      }
    }

    // ========================================
    // 创建统一执行引擎（DAG 模式）
    // ========================================
    
    // 构建默认模型配置
    const defaultModelConfig: ModelConfigForExecution = {
      id: modelConfig.id,
      name: modelConfig.name,
      providerType: modelConfig.providerType,
      apiKey: modelConfig.apiKey,
      apiBaseUrl: modelConfig.apiBaseUrl || '',
      models: modelConfig.models,
    };
    
    // 创建统一执行引擎配置
    const engineConfig = {
      evaluationSessionId: evaluation.id,
      projectId: id,
      projectName: project.name,
      workflowId: workflowId,
      workflowType: 'custom' as const,
      workspacePath: project.projectPath || '',
      systemPrompt: sdkOptions.systemPrompt,
      roleModels: roleModels || undefined,
      defaultModelConfig,
      maxIterationsPerNode: 15,
      maxRetries: 15,
      retryDelayMs: 60000,
      workflowConfig: workflowConfigParsed || undefined,
    };
    
    logger.debug(LOG_MODULES.EVALUATION, '统一执行引擎配置', {
      evaluationSessionId: evaluation.id,
      projectId: id,
      workflowId,
      nodeCount: sortedNodes.length,
      roleModelsCount: roleModels?.length || 0,
    });

    // 创建统一执行引擎实例（SSE 回调将在 SSE 流中设置）
    const engine = createUnifiedExecutionEngine(engineConfig, {
      // 占位回调，将在 SSE 流中重新设置
      onNodeStart: () => {},
      onNodeChunk: () => {},
      onNodeToolCall: () => {},
      onTokenUsage: () => {},
      onNodeRetry: () => {},
      onNodeComplete: () => {},
      onNodeError: () => {},
      onWorkflowComplete: () => {},
      onWorkflowError: () => {},
    });
    
    // 设置节点列表
    engine.setNodes(sortedNodes);
    
    logger.debug(LOG_MODULES.EVALUATION, '统一执行引擎已创建', { nodeCount: sortedNodes.length });

    // 启动 SSE 流健康检查 Watchdog
    const watchdog = createWatchdog({
      evaluationId: evaluation.id,
      projectId: id,
      idleTimeout: 5 * 60 * 1000,  // 5 分钟空闲超时
      maxRunTime: 30 * 60 * 1000,  // 30 分钟最大运行时间
      onTimeout: (reason) => {
        logger.errorNoUser(LOG_MODULES.EVALUATION, 'Watchdog 评估超时中止', { reason });
        // 中止统一执行引擎
        engine.abort();
      },
      onHeartbeat: (stats) => {
        // 心跳日志由 Watchdog 内部处理
      },
      onProgressInquiry: async (reason, stats) => {
        // 空闲超时或运行时间较长时，记录状态
        logger.debug(LOG_MODULES.EVALUATION, 'Watchdog 进展询问', { reason, idleTime: Math.round(stats.idleTime / 1000), runTime: Math.round(stats.runTime / 1000) });
      },
    });
    logger.debug(LOG_MODULES.EVALUATION, 'Watchdog 已启动', { evaluationId: evaluation.id });

    // 构建文件列表
    const files = project.ProjectFile.map(f => ({
      name: f.fileName,
      type: f.fileType,
      size: f.fileSize,
    }));

    // 系统提示词已设置（customSystemPrompt），评估指令由用户在 customSystemPrompt 中自行维护

    // 日志：启动评估前的完整信息
    logger.debug(LOG_MODULES.EVALUATION, '启动评估前检查', {
      projectId: id,
      projectName: project.name,
      projectPath: project.projectPath || '未设置',
      workflowType: 'dag',
      totalNodes: sortedNodes.length,
      sdkConfig: {
        permissionMode: sdkOptions.permissionMode,
        allowDangerouslySkipPermissions: sdkOptions.allowDangerouslySkipPermissions,
        systemPromptType: typeof sdkOptions.systemPrompt,
        systemPromptPreview: sdkOptions.systemPrompt
          ? (typeof sdkOptions.systemPrompt === 'string'
              ? sdkOptions.systemPrompt.substring(0, 300) + '...'
              : JSON.stringify(sdkOptions.systemPrompt, null, 2).substring(0, 500) + '...')
          : '未配置',
      },
    });

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = '';
        let isControllerClosed = false; // 跟踪 controller 状态
        let lastTodoSnapshot = ''; // 上次保存的 TODO 快照（JSON 字符串）
        let currentNodeId: string | null = null; // 当前执行的节点 ID（用于 TODO 关联）
        let evaluationResult: {
          total: number;
          critical: number;
          high: number;
          medium: number;
          low: number;
          info: number;
          skills_used: string[];
          vulnerabilities: any[];
        } | null = null;

        // 检测节点完成标记的正则表达式
        const NODE_COMPLETE_REGEX = /\[EVALUATION_NODE_COMPLETE: nodeId=([^\],]+)/g;
        const EVAL_COMPLETE_REGEX = /\[EVALUATION_COMPLETE: ([^\]]+)\]/g;

        // 安全地向 controller 写入数据
        const safeEnqueue = (data: string) => {
          if (!isControllerClosed) {
            try {
              controller.enqueue(new TextEncoder().encode(data));
            } catch (error) {
              logger.warn(LOG_MODULES.EVALUATION, 'Evaluation Controller already closed, skip enqueue');
              isControllerClosed = true;
            }
          }
        };

        // 安全地关闭 controller
        const safeClose = () => {
          if (!isControllerClosed) {
            try {
              controller.close();
              isControllerClosed = true;
            } catch (error) {
              logger.warn(LOG_MODULES.EVALUATION, 'Evaluation Controller already closed');
              isControllerClosed = true;
            }
          }
        };

        // 更新节点状态
        const updateNodeStatus = async (nodeId: string, status: 'completed' | 'failed') => {
          try {
            // Find existing node execution
            const existingExecution = await prisma.nodeExecution.findFirst({
              where: {
                evaluationSessionId: evaluation.id,
                nodeId: nodeId,
              },
            });
            
            if (existingExecution) {
              await prisma.nodeExecution.update({
                where: { id: existingExecution.id },
                data: {
                  status,
                  completedAt: new Date(),
                  updatedAt: new Date(),
                },
              });
            } else {
              await prisma.nodeExecution.create({
                data: {
                  id: generateId('nodeexec'),
                  evaluationSessionId: evaluation.id,
                  workflowNodeId: nodeId,
                  nodeLabel: nodeId,
                  nodeType: 'task',
                  status,
                  order: 0,
                  completedAt: new Date(),
                  updatedAt: new Date(),
                },
              });
            }
            logger.debug(LOG_MODULES.EVALUATION, 'Node 状态更新', { nodeId, status });
          } catch (e) {
            logger.errorNoUser(LOG_MODULES.EVALUATION, 'Node 状态更新失败', { nodeId, error: e });
          }
        };

        // 累计 Token 使用量（用于 SSE 推送）
        let cumulativeTokens = { input: 0, output: 0 };
        
        // 设置统一执行引擎的 SSE 回调
        const engineCallbacks: UnifiedExecutionCallbacks = {
          onNodeStart: async (nodeIndex, nodeId, nodeName) => {
            logger.debug(LOG_MODULES.EVALUATION, `节点 ${nodeIndex + 1}/${sortedNodes.length} 开始: ${nodeName}`);
            
            // 设置当前节点 ID（用于 TODO 关联）
            currentNodeId = nodeId;
            
            // 获取节点模型配置
            const node = sortedNodes[nodeIndex];
            const modelConfigForNode = await getModelConfigForRole(node.roleId ?? undefined, roleModels, defaultModelConfig);
            
            // 发送节点开始事件
            safeEnqueue(`data: ${JSON.stringify({
              type: 'phase_start',
              nodeIndex: nodeIndex + 1,
              totalNodes: sortedNodes.length,
              nodeName: nodeName,
              nodeId: nodeId,
              modelName: modelConfigForNode.name,
            })}\n\n`);
          },
          
          onNodeChunk: (nodeIndex, text) => {
            // 发送文本流事件
            safeEnqueue(`data: ${JSON.stringify({
              type: 'message',
              nodeIndex,
              content: text,
              timestamp: Date.now(),
            })}\n\n`);
          },
          
          onNodeToolCall: (nodeIndex, tool, args) => {
            // 发送工具调用事件
            safeEnqueue(`data: ${JSON.stringify({
              type: 'tool_call',
              nodeIndex,
              name: tool,
              parameters: args,
              timestamp: Date.now(),
            })}\n\n`);
            
            // 检测 TodoWrite 工具调用
            if (tool === 'TodoWrite' && args?.todos && Array.isArray(args.todos)) {
              // 为每个 TODO 关联当前节点 ID
              const todosWithNodeId = args.todos.map(todo => ({
                ...todo,
                workflowNodeId: currentNodeId, // 关联到当前执行的节点
              }));
              
              safeEnqueue(`data: ${JSON.stringify({
                type: 'todo_update',
                todos: todosWithNodeId,
                nodeId: currentNodeId,
                timestamp: Date.now(),
              })}\n\n`);
              
              // 广播 TODO 更新
              const { emitTodoUpdate } = require('@/lib/event-bus');
              emitTodoUpdate(evaluation.id, todosWithNodeId);
              
              // 保存到数据库（包含节点关联）
              const newSnapshot = JSON.stringify(todosWithNodeId);
              if (newSnapshot !== lastTodoSnapshot && todosWithNodeId.length > 0) {
                lastTodoSnapshot = newSnapshot;
                prisma.evaluationSession.update({
                  where: { id: evaluation.id },
                  data: { todoList: newSnapshot },
                }).catch(err => logger.errorNoUser(LOG_MODULES.EVALUATION, '保存 TODO 失败', { error: err }));
              }
            }
          },
          
          onTokenUsage: (data) => {
            // 更新累计 Token
            cumulativeTokens.input = data.cumulativeInputTokens;
            cumulativeTokens.output = data.cumulativeOutputTokens;
            
            // 发送 Token 使用事件
            safeEnqueue(`data: ${JSON.stringify({
              type: 'phase_token_usage',
              nodeIndex: data.nodeIndex + 1,
              modelName: data.modelName,
              inputTokens: data.inputTokens,
              outputTokens: data.outputTokens,
              cumulativeInputTokens: data.cumulativeInputTokens,
              cumulativeOutputTokens: data.cumulativeOutputTokens,
            })}\n\n`);
          },
          
          onNodeRetry: (nodeIndex, nodeId, nodeName, retryCount, maxRetries, error) => {
            logger.warn(LOG_MODULES.EVALUATION, `节点 ${nodeName} 重试 ${retryCount}/${maxRetries}`, { error: error.message });
            
            // 发送重试事件
            safeEnqueue(`data: ${JSON.stringify({
              type: 'node_retry',
              nodeIndex,
              nodeName,
              retryCount,
              maxRetries,
              error: error.message,
              timestamp: Date.now(),
            })}\n\n`);
          },
          
          onNodeComplete: async (nodeIndex, result) => {
            logger.debug(LOG_MODULES.EVALUATION, `节点 ${result.nodeName} 完成`, {
              status: result.status,
              duration: result.duration,
              iterations: result.iterations,
            });
            
            // 清除当前节点 ID（节点已完成）
            currentNodeId = null;
            
            // 发送节点完成事件
            safeEnqueue(`data: ${JSON.stringify({
              type: 'phase_complete',
              nodeIndex: nodeIndex + 1,
              nodeId: result.nodeId,
              nodeName: result.nodeName,
              status: result.status,
              outputYamlPath: result.outputYamlPath,
              iterations: result.iterations,
              duration: result.duration,
            })}\n\n`);
            
            // 更新节点状态到数据库
            await updateNodeStatus(result.nodeId, result.status === 'completed' ? 'completed' : 'failed');
          },
          
          onNodeError: (nodeIndex, nodeId, nodeName, error) => {
            logger.errorNoUser(LOG_MODULES.EVALUATION, `节点 ${nodeName} 错误`, { error: error.message });
            
            // 清除当前节点 ID（节点已出错）
            currentNodeId = null;
            
            // 发送节点错误事件
            safeEnqueue(`data: ${JSON.stringify({
              type: 'node_error',
              nodeIndex,
              nodeId,
              nodeName,
              error: error.message,
              timestamp: Date.now(),
            })}\n\n`);
          },
          
          onWorkflowComplete: async (result) => {
            logger.debug(LOG_MODULES.EVALUATION, '工作流完成', {
              status: result.status,
              totalDuration: result.totalDuration,
              totalInputTokens: result.totalInputTokens,
              totalOutputTokens: result.totalOutputTokens,
            });
            
            // 停止 Watchdog
            stopWatchdog(evaluation.id);
            
            // 完成所有未完成的 Skill 执行记录
            await completeAllPendingSkillExecutions({
              evaluationId: evaluation.id,
              status: result.status === 'completed' ? 'completed' : 'failed',
              reason: result.endReason || '工作流完成',
            });
            
            // 更新项目状态
            await prisma.project.update({
              where: { id },
              data: { status: result.status === 'completed' ? 'completed' : 'failed' },
            });
            
            // 处理队列
            const { processQueue } = await import('@/services/evaluation-queue');
            processQueue().catch(err => logger.errorNoUser(LOG_MODULES.EVALUATION, '处理队列失败', { error: err }));
            
            // 发送工作流完成事件
            safeEnqueue(`data: ${JSON.stringify({
              type: 'workflow_complete',
              status: result.status,
              totalDuration: result.totalDuration,
              totalInputTokens: result.totalInputTokens,
              totalOutputTokens: result.totalOutputTokens,
              endReason: result.endReason,
              nodeResults: result.nodeResults.map(r => ({
                nodeName: r.nodeName,
                status: r.status,
                duration: r.duration,
              })),
            })}\n\n`);
            
            // 发送最终完成事件
            safeEnqueue(`data: ${JSON.stringify({
              type: 'done',
              evaluationId: evaluation.id,
              message: result.endMessage || '工作流执行完成',
              timestamp: Date.now(),
            })}\n\n`);
            
            safeClose();
          },
          
          onWorkflowError: (error) => {
            logger.errorNoUser(LOG_MODULES.EVALUATION, '工作流错误', { error: error.message });
            
            // 停止 Watchdog
            stopWatchdog(evaluation.id);
            
            // 发送错误事件
            safeEnqueue(`data: ${JSON.stringify({
              type: 'error',
              error: error.message,
              fatal: true,
              timestamp: Date.now(),
            })}\n\n`);
            
            safeClose();
          },
        };
        
        // 更新引擎回调
        (engine as any).callbacks = engineCallbacks;
        
        // 发送启动事件
        safeEnqueue(`data: ${JSON.stringify({
          type: 'started',
          evaluationId: evaluation.id,
          workflowType: 'dag',
          totalNodes: sortedNodes.length,
          message: 'DAG 工作流已启动',
          timestamp: Date.now(),
        })}\n\n`);
        
        // 后台执行统一引擎
        engine.execute().catch(async (error) => {
          logger.errorNoUser(LOG_MODULES.EVALUATION, '统一引擎执行失败', { error });
          
          // 更新状态
          await prisma.evaluationSession.update({
            where: { id: evaluation.id },
            data: {
              status: 'failed',
              errorMessage: error.message,
              completedAt: new Date(),
            },
          });
          
          await prisma.project.update({
            where: { id },
            data: { status: 'failed' },
          });
          
          // 停止 Watchdog
          stopWatchdog(evaluation.id);
          
          // 发送错误事件
          safeEnqueue(`data: ${JSON.stringify({
            type: 'error',
            error: error.message,
            fatal: true,
            timestamp: Date.now(),
          })}\n\n`);
          
          safeClose();
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
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
