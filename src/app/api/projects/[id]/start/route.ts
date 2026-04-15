// src/app/api/projects/[id]/start/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';
import { createRalphLoopAgent, RalphLoopAgentCallbacks, securityAuditVerifier, createCombinedVerifier, createWorkflowNodeVerifier } from '@/services/evaluation';
import { NODE_TYPE_MAP } from '@/types/workflow';
import { AppMcpServerConfig } from '@/services/ai/claude-agent';
import { claudeProjectManager } from '@/lib/claude-project-sync';
import { mkdir, writeFile, readFile, access, rm } from 'fs/promises';
import { join } from 'path';
import { copySkillsToProject } from '@/services/skill-files';
import { registerAgent } from '@/lib/agent-registry';
import { buildExperiencePromptWithMeta } from '@/services/autonomous-evolution/system-prompt-builder';

// 启动项目评估（SSE 流式响应）
export async function POST(
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
    if (!hasPermission(payload.permissions, PERMISSIONS.EVALUATION_CREATE)) {
      return NextResponse.json({ error: '无权限启动评估' }, { status: 403 });
    }

    const { id } = await params;

    // 解析请求体获取 workflowId 和其他选项
    let workflowId: string | null = null;
    let modelId: string | null = null;
    let enableMcp = true;
    let enableToolPermissions = true;
    let queuedEvaluationId: string | null = null; // 队列启动时复用的评估ID
    try {
      const body = await request.json();
      workflowId = body.workflowId || null;
      modelId = body.modelId || null;
      enableMcp = body.enableMcp !== false;
      enableToolPermissions = body.enableToolPermissions !== false;
      queuedEvaluationId = body.queuedEvaluationId || null;
    } catch {
      // 如果没有请求体，继续执行
    }

    // 检查是否为队列启动（内部调用）- 使用内部密钥验证防止伪造
    const internalCallToken = request.headers.get('X-Internal-Token');
    const isQueuedStart = internalCallToken === process.env.INTERNAL_API_SECRET;
    console.log('[启动评估] 是否队列启动:', isQueuedStart, 'queuedEvaluationId:', queuedEvaluationId);

    // 获取项目信息（包括运行中的评估）
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        files: true,
        evaluations: {
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
        console.log('[启动评估] 没有激活配置，自动激活第一个:', firstConfig.id);
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
    
    console.log('[启动评估] 并发限制检查: 当前运行', runningCount, ', 最大允许', maxConcurrent);
    
    // 如果超出并发限制且不是队列启动，创建排队状态的评估
    if (!isQueuedStart && runningCount >= maxConcurrent) {
      console.log('[启动评估] 超出并发限制，创建排队评估');
      
      // 创建排队状态的评估会话
      const queuedEvaluation = await prisma.evaluationSession.create({
        data: {
          projectId: id,
          workflowId: workflowId,
          status: 'queued',
          modelName: modelId, // 保存请求的模型ID
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
    console.log('[启动评估] 项目信息:');
    console.log('[启动评估] - 项目ID:', project.id);
    console.log('[启动评估] - 项目名称:', project.name);
    console.log('[启动评估] - 全局配置:', globalConfig ? '存在' : '不存在');
    if (globalConfig) {
      console.log('[启动评估] - config.id:', globalConfig.id);
      console.log('[启动评估] - config.name:', globalConfig.name);
      console.log('[启动评估] - customSystemPrompt:', globalConfig.customSystemPrompt ? `存在(${globalConfig.customSystemPrompt.length}字符)` : '不存在');
      if (globalConfig.customSystemPrompt) {
        console.log('[启动评估] - customSystemPrompt 前200字符:', globalConfig.customSystemPrompt.substring(0, 200) + '...');
      }
    } else {
      console.log('[启动评估] ⚠️  未找到激活的全局配置');
    }

    // 加载 MCP 服务器配置（全局 + 项目级别）
    let mcpServers: any[] = [];
    if (enableMcp) {
      // 加载全局 MCP 配置
      const globalMcpServers = await prisma.mcpServerConfig.findMany({
        where: { 
          userId: null, 
          projectId: null, 
          isEnabled: true 
        },
      });
      
      // 加载项目级别 MCP 配置
      const projectMcpServers = await prisma.mcpServerConfig.findMany({
        where: { projectId: id, isEnabled: true },
      });
      
      // 合并配置（项目级别优先级更高）
      const globalNames = new Set(globalMcpServers.map(s => s.name));
      const projectNames = new Set(projectMcpServers.map(s => s.name));
      
      // 添加全局配置（不在项目配置中的）
      mcpServers = [...globalMcpServers.filter(s => !projectNames.has(s.name))];
      // 添加项目配置
      mcpServers = [...mcpServers, ...projectMcpServers];
      
      console.log(`[启动评估] 加载 MCP 服务器: 全局 ${globalMcpServers.length} 个, 项目 ${projectMcpServers.length} 个, 合并后 ${mcpServers.length} 个`);
    }

    // 加载工具权限配置
    let toolPermissions: any[] = [];
    if (enableToolPermissions) {
      toolPermissions = await prisma.toolPermission.findMany({
        where: { projectId: id },
      });
    }

    // 检查是否有运行中的评估会话
    const runningEvaluations = project.evaluations || [];
    if (runningEvaluations.length > 0) {
      return NextResponse.json({ 
        error: '项目已在运行中', 
        runningEvaluationId: runningEvaluations[0].id 
      }, { status: 400 });
    }

    // 获取模型配置
    const modelConfig = await getModelConfig(modelId);
    if (!modelConfig) {
      return NextResponse.json(
        { error: '请先在模型管理中配置模型' },
        { status: 400 }
      );
    }

    // workflowId 是可选的，如果未提供则不使用工作流

    // 获取工作流预览（如果提供了 workflowId）
    let workflowPreview: string | null = null;
    let workflowName: string | null = null;
    if (workflowId) {
      console.log('[启动评估] 获取工作流预览, workflowId:', workflowId, 'userId:', payload.userId);
      const workflowPreviewResult = await getWorkflowPreview(workflowId, payload.userId);
      if (workflowPreviewResult) {
        workflowPreview = workflowPreviewResult.markdown;
        workflowName = workflowPreviewResult.name;
        console.log('[启动评估] 工作流预览生成成功, 名称:', workflowName);
        console.log('[启动评估] 预览内容长度:', workflowPreview.length);
      } else {
        console.warn('[启动评估] 未找到工作流或无权限访问');
      }
    } else {
      console.log('[启动评估] 未提供 workflowId，使用默认消息');
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
    
    // 设置权限模式为 bypassPermissions，给予 Claude 所有权限
    // 必须同时设置 allowDangerouslySkipPermissions: true
    sdkOptions.permissionMode = 'bypassPermissions';
    sdkOptions.allowDangerouslySkipPermissions = true;
    console.log('[启动评估] 权限配置: permissionMode =', sdkOptions.permissionMode, ', allowDangerouslySkipPermissions =', sdkOptions.allowDangerouslySkipPermissions);

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
    console.log('[启动评估] 检查全局配置:');
    console.log('[启动评估] - globalConfig 存在:', !!globalConfig);
    console.log('[启动评估] - globalConfig.id:', globalConfig?.id);
    console.log('[启动评估] - globalConfig.isActive:', globalConfig?.isActive);
    console.log('[启动评估] - customSystemPrompt 存在:', !!globalConfig?.customSystemPrompt);
    console.log('[启动评估] - customSystemPrompt 长度:', globalConfig?.customSystemPrompt?.length || 0);
    
    if (globalConfig?.customSystemPrompt) {
      sdkOptions.systemPrompt = globalConfig.customSystemPrompt;
      console.log('[启动评估] 使用全局配置中的自定义系统提示词');
      console.log('[启动评估] 系统提示词内容:', globalConfig.customSystemPrompt.substring(0, 200) + '...');
    } else {
      console.log('[启动评估] ⚠️  未配置系统提示词 - globalConfig:', globalConfig ? '存在但customSystemPrompt为空' : '不存在');
    }

    // 注入自主进化经验到 System Prompt
    let injectedExperiences: { id: string; title: string; errorCategory: string; hitCount: number }[] = [];
    try {
      const expResult = await buildExperiencePromptWithMeta();
      if (expResult.prompt) {
        sdkOptions.systemPrompt = (sdkOptions.systemPrompt || '') + '\n\n' + expResult.prompt;
        injectedExperiences = expResult.experiences;
        console.log(`[启动评估] 已注入自主进化经验到 System Prompt，共 ${expResult.count} 条:`);
        expResult.experiences.forEach((e, i) => {
          console.log(`[启动评估]   ${i + 1}. [${e.errorCategory}] ${e.title} (命中${e.hitCount}次)`);
        });
      } else {
        console.log('[启动评估] 无已启用的自主进化经验（isInjected=true 的记录为空）');
      }
    } catch (err) {
      console.warn('[启动评估] 注入自主进化经验失败:', err);
    }

    // 设置源（加载 CLAUDE.md）
    if (globalConfig?.claudemdPath) {
      sdkOptions.settingSources = ['project', 'user', 'local'];
    }

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
          console.log(`[启动评估] 已清理: ${target.path}`);
        } catch {
          // 不存在，跳过
        }
      }
    }

    // 同步 Skills 到项目目录（直接从磁盘拷贝，无需查询数据库）
    if (project.projectPath) {
      try {
        console.log('[启动评估] 开始同步 Skills 到项目目录');
        
        // 解析项目技术栈
        let projectTechStack: string[] | null = null;
        if (project.techStack) {
          try {
            projectTechStack = JSON.parse(project.techStack);
            console.log('[启动评估] 项目技术栈:', projectTechStack?.join(', ') || '无');
          } catch {
            console.warn('[启动评估] 项目技术栈解析失败，将拷贝所有 Skills');
            projectTechStack = null;
          }
        } else {
          console.log('[启动评估] 项目未设置技术栈，将拷贝所有启用的 Skills');
        }
        
        // 直接从磁盘拷贝 Skills（带技术栈过滤）
        const copyResult = await copySkillsToProject(
          project.projectPath,
          payload.userId,
          undefined,  // skillOutputTemplate（可选，后续可从 globalConfig 获取）
          projectTechStack  // 项目技术栈
        );
        
        console.log(`[启动评估] Skills 同步完成:`);
        console.log(`  - 成功: ${copyResult.success}`);
        console.log(`  - 失败: ${copyResult.failed}`);
        console.log(`  - 拷贝的 Skills: ${copyResult.copiedSkills.join(', ')}`);
        
        if (copyResult.failed > 0) {
          copyResult.errors.forEach(err => {
            console.error(`    - ${err}`);
          });
        }
      } catch (error) {
        console.error('[启动评估] Skills 同步失败:', error);
        // 继续执行，不阻止评估启动
      }
    }
    
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
        console.log(`[启动评估] 已写入 CLAUDE.md 模板到: ${claudeMdPath}`);
      } catch (error) {
        console.error('[启动评估] 写入 CLAUDE.md 失败:', error);
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
          status: 'running',
          startedAt: new Date(),
          modelName: modelConfig.name,
          providerType: modelConfig.providerType,
        },
      });
      console.log('[启动评估] 复用排队评估记录:', evaluation.id);
    } else {
      // 正常启动：创建新的评估记录
      evaluation = await prisma.evaluationSession.create({
        data: {
          projectId: id,
          workflowId: workflowId, // 关联工作流
          status: 'running',
          modelName: modelConfig.name, // 保存模型名称
          providerType: modelConfig.providerType, // 保存提供商类型
        },
      });
      console.log('[启动评估] 创建新评估记录:', evaluation.id);
    }

    // 记录经验引用（哪些经验被注入到本次评估）
    if (injectedExperiences.length > 0) {
      await prisma.experienceUsageLog.createMany({
        data: injectedExperiences.map(e => ({
          experienceId: e.id,
          evaluationId: evaluation.id,
          projectId: id,
        })),
      });
      console.log(`[启动评估] 已记录 ${injectedExperiences.length} 条经验引用`);
    }

    // 初始化工作流节点执行记录
    if (workflowId) {
      try {
        const workflow = await prisma.workflow.findUnique({
          where: { id: workflowId },
          include: { nodes: { orderBy: { positionX: 'asc' } } },
        });

        if (workflow && workflow.nodes.length > 0) {
          await prisma.nodeExecution.createMany({
            data: workflow.nodes.map((node, index) => ({
              evaluationSessionId: evaluation.id,
              workflowNodeId: node.id,
              nodeLabel: node.data ? JSON.parse(node.data).label || node.id : node.id,
              nodeType: node.type,
              status: node.type === 'start' ? 'completed' : 'pending',
              order: index,
              startedAt: node.type === 'start' ? new Date() : null,
            })),
          });
          console.log(`[Evaluation] 初始化了 ${workflow.nodes.length} 个工作流节点`);
        }
      } catch (e) {
        console.error('[Evaluation] 初始化工作流节点失败:', e);
      }
    }

    // 创建 Ralph Loop Agent，传递项目目录作为工作目录
    // Ralph Loop Agent 会在任务未完成时自动迭代
    
    // 创建组合验证器：优先检测 vulnerabilities.json 文件，其次用安全审计关键词
    const projectPath = project.projectPath;
    const vulnFileVerifier = async (context: any) => {
      // 检查项目目录下是否存在 vulnerabilities.json
      if (projectPath) {
        try {
          await access(join(projectPath, 'vulnerabilities.json'));
          console.log('[Verifier] 检测到 vulnerabilities.json，任务完成');
          return { complete: true, reason: '检测到 vulnerabilities.json 文件，审计完成' };
        } catch {
          // 文件不存在，继续其他检测
        }
      }
      // 回退到原有的文本检测
      return securityAuditVerifier(context);
    };

    const verifier = createCombinedVerifier([
      vulnFileVerifier,
      createWorkflowNodeVerifier(workflowId ? undefined : undefined),
    ], 'any'); // 任一验证器通过即完成
    
    const agent = createRalphLoopAgent(
      modelConfig,
      project.projectPath || undefined,
      {
        maxIterations: 15,  // 最大迭代次数
        maxTokens: 100000,  // 最大 token 数
        maxCost: 5.00,      // 最大成本 $5
        verifyCompletion: verifier, // 使用组合验证器判断任务完成
        onIterationStart: (iteration) => {
          console.log(`[Ralph Loop] ========== 开始第 ${iteration} 次迭代 ==========`);
        },
        onIterationEnd: async (iteration, duration) => {
          console.log(`[Ralph Loop] 第 ${iteration} 次迭代完成，耗时 ${duration}ms`);
          
          // 保存迭代记录到数据库
          try {
            await prisma.evaluationIteration.create({
              data: {
                evaluationSessionId: evaluation.id,
                iterationNumber: iteration,
                status: 'completed',
                duration,
                completedAt: new Date(),
              },
            });
            console.log(`[Ralph Loop] 迭代记录已保存到数据库`);
          } catch (err) {
            // 表不存在时忽略
            console.log(`[Ralph Loop] 保存迭代记录失败（可能表不存在）:`, err);
          }
        },
      },
      // SDK 高级配置
      sdkOptions
    );
    
    console.log('[Ralph Loop] Agent 已创建，准备启动循环');

    // 注册 agent 到注册表（用于后续中止）
    registerAgent(evaluation.id, agent);
    console.log(`[Evaluation] Agent 已注册: ${evaluation.id}`);

    // 获取任务描述（来自全局配置的 taskDescription）
    const taskDescription = globalConfig?.taskDescription || null;

    // 构建文件列表
    const files = project.files.map(f => ({
      name: f.fileName,
      type: f.fileType,
      size: f.fileSize,
    }));

    // 系统提示词已设置（customSystemPrompt），评估指令由用户在 customSystemPrompt 中自行维护

    // 构建用户初始消息（只包含工作流预览，不添加硬编码提示词）
    const initialMessage = workflowPreview
      ? workflowPreview
      : taskDescription
        ? taskDescription
        : undefined;

    // 日志：启动评估前的完整信息
    console.log('[启动评估] ========================================');
    console.log('[启动评估] 启动评估前检查:');
    console.log('[启动评估] - 项目ID:', id);
    console.log('[启动评估] - 项目名称:', project.name);
    console.log('[启动评估] - 项目路径:', project.projectPath || '未设置');
    console.log('[启动评估] - 工作流ID:', workflowId || '无');
    console.log('[启动评估] - 工作流名称:', workflowName || '无');
    console.log('[启动评估] ----------------------------------------');
    console.log('[启动评估] - SDK 配置:');
    console.log('[启动评估]   - permissionMode:', sdkOptions.permissionMode);
    console.log('[启动评估]   - allowDangerouslySkipPermissions:', sdkOptions.allowDangerouslySkipPermissions);
    console.log('[启动评估]   - systemPrompt 类型:', typeof sdkOptions.systemPrompt);
    console.log('[启动评估]   - systemPrompt 内容:',
      sdkOptions.systemPrompt
        ? (typeof sdkOptions.systemPrompt === 'string'
            ? sdkOptions.systemPrompt.substring(0, 300) + '...'
            : JSON.stringify(sdkOptions.systemPrompt, null, 2).substring(0, 500) + '...')
        : '未配置');
    console.log('[启动评估] ----------------------------------------');
    console.log('[启动评估] - 任务描述:', taskDescription?.substring(0, 200) || '无');
    console.log('[启动评估] ----------------------------------------');
    console.log('[启动评估] - 初始消息(用户提示词):', initialMessage?.substring(0, 300) || '无');
    console.log('[启动评估] ========================================');

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = '';
        let isControllerClosed = false; // 跟踪 controller 状态
        let lastTodoSnapshot = ''; // 上次保存的 TODO 快照（JSON 字符串）
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
              console.warn('[Evaluation] Controller already closed, skip enqueue');
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
              console.warn('[Evaluation] Controller already closed');
              isControllerClosed = true;
            }
          }
        };

        // 更新节点状态
        const updateNodeStatus = async (nodeId: string, status: 'completed' | 'failed') => {
          try {
            await prisma.nodeExecution.upsert({
              where: {
                evaluationSessionId_workflowNodeId: {
                  evaluationSessionId: evaluation.id,
                  workflowNodeId: nodeId,
                },
              },
              update: {
                status,
                completedAt: new Date(),
              },
              create: {
                evaluationSessionId: evaluation.id,
                workflowNodeId: nodeId,
                nodeLabel: nodeId,
                nodeType: 'task',
                status,
                order: 0,
                completedAt: new Date(),
              },
            });
            console.log(`[Evaluation] Node ${nodeId} status updated to ${status}`);
          } catch (e) {
            console.error(`[Evaluation] Failed to update node ${nodeId} status:`, e);
          }
        };

        // 提取并解析评估完成结果
        const parseEvaluationResult = (text: string) => {
          let match;
          EVAL_COMPLETE_REGEX.lastIndex = 0;
          while ((match = EVAL_COMPLETE_REGEX.exec(text)) !== null) {
            const params = match[1];
            const result: any = {};
            const paramMatches = params.matchAll(/(\w+)=(\d+)/g);
            for (const m of paramMatches) {
              result[m[1]] = parseInt(m[2], 10);
            }
            if (result.total !== undefined) {
              evaluationResult = {
                ...result,
                vulnerabilities: [],
              };
              console.log('[Evaluation] Detected completion result:', result);
            }
          }
        };

        // 发送自主进化经验注入信息
        if (injectedExperiences.length > 0) {
          safeEnqueue(`data: ${JSON.stringify({
            type: 'experience_injected',
            count: injectedExperiences.length,
            experiences: injectedExperiences,
            timestamp: Date.now(),
          })}\n\n`);
        } else {
          safeEnqueue(`data: ${JSON.stringify({
            type: 'experience_injected',
            count: 0,
            experiences: [],
            timestamp: Date.now(),
          })}\n\n`);
        }

        try {
          // 使用 Ralph Loop Agent 进行迭代评估
          // Ralph Loop 会在任务未完成时自动进行下一轮迭代
          console.log('[Ralph Loop] 开始执行 loop() 方法');
          
          const callbacks: RalphLoopAgentCallbacks = {
            onChunk: (text) => {
              fullResponse += text;

              // 检测节点完成标记
              let match;
              NODE_COMPLETE_REGEX.lastIndex = 0;
              while ((match = NODE_COMPLETE_REGEX.exec(text)) !== null) {
                const nodeId = match[1].trim();
                updateNodeStatus(nodeId, 'completed');
                // 发送节点完成事件
                const eventData = JSON.stringify({
                  type: 'node_complete',
                  nodeId,
                  timestamp: Date.now(),
                });
                safeEnqueue(`data: ${eventData}\n\n`);
              }

              // 检测评估完成标记并提取结果
              parseEvaluationResult(text);
              if (text.includes('[EVALUATION_COMPLETE:')) {
                const eventData = JSON.stringify({
                  type: 'evaluation_complete_marker',
                  result: evaluationResult,
                  timestamp: Date.now(),
                });
                safeEnqueue(`data: ${eventData}\n\n`);
              }

              const data = JSON.stringify({
                type: 'message',
                content: text,
                timestamp: Date.now(),
              });
              safeEnqueue(`data: ${data}\n\n`);
            },
            onToolCall: (name, parameters) => {
              // 检测 TodoWrite 工具调用，提取 TODO 列表
              if (name === 'TodoWrite' && parameters?.todos && Array.isArray(parameters.todos)) {
                const todos = parameters.todos;
                const todoEvent = JSON.stringify({
                  type: 'todo_update',
                  todos,
                  timestamp: Date.now(),
                });
                safeEnqueue(`data: ${todoEvent}\n\n`);
                console.log('[Ralph Loop] TODO 更新:', todos.length, '项');

                // 通过事件总线广播 TODO 更新
                const { emitTodoUpdate } = require('@/lib/event-bus');
                emitTodoUpdate(evaluation.id, todos);

                // 对比变化：只有内容有变化时才写数据库
                const newSnapshot = JSON.stringify(todos);
                if (newSnapshot !== lastTodoSnapshot && todos.length > 0) {
                  lastTodoSnapshot = newSnapshot;
                  prisma.evaluationSession.update({
                    where: { id: evaluation.id },
                    data: { todoList: newSnapshot },
                  }).catch(err => console.error('[Ralph Loop] 保存 TODO 到数据库失败:', err));
                  console.log('[Ralph Loop] TODO 有变化，已保存到数据库');
                }
              }

              // 发送工具调用事件
              const data = JSON.stringify({
                type: 'tool_call',
                name,
                parameters,
                timestamp: Date.now(),
              });
              safeEnqueue(`data: ${data}\n\n`);
            },
            onToolResult: (name, result) => {
              // 发送工具结果事件
              const data = JSON.stringify({
                type: 'tool_result',
                name,
                success: result.success,
                output: result.output,
                error: result.error,
                duration: result.duration,
                timestamp: Date.now(),
              });
              safeEnqueue(`data: ${data}\n\n`);
            },
            onUsage: async (usage) => {
              // 记录每次 API 调用的 token 使用量到数据库
              console.log('[Ralph Loop] 收到 Token 使用量:', usage);
              
              try {
                // 计算本次调用费用
                const { calculateCost, getModelPricingOrDefault } = await import('@/services/evaluation/ralph-loop-agent');
                const modelId = modelConfig?.models || 'claude-sonnet-4-20250514';
                const pricing = getModelPricingOrDefault(modelId);
                const callCost = calculateCost({
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  totalTokens: usage.inputTokens + usage.outputTokens,
                }, pricing);
                
                // 保存到 TokenUsage 表（单次调用记录）
                await prisma.tokenUsage.create({
                  data: {
                    evaluationId: evaluation.id,
                    projectId: id,
                    apiProvider: modelConfig?.providerType || 'claude',
                    modelName: modelConfig?.models ? 
                      (Array.isArray(JSON.parse(modelConfig.models)) ? JSON.parse(modelConfig.models)[0] : modelConfig.models) :
                      'claude-sonnet-4',
                    callType: 'chat',
                    inputTokens: usage.inputTokens || 0,
                    outputTokens: usage.outputTokens || 0,
                    totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
                    cachedTokens: usage.cacheReadInputTokens || 0,
                    requestStartedAt: new Date(),
                    requestCompletedAt: new Date(),
                    estimatedCost: callCost,
                    status: 'success',
                  },
                });
                
                // 实时更新 EvaluationSession 的累计 token 值
                // 注意：inputTokens 包含历史上下文，不应累加（只保存最后一次的值）
                // outputTokens 是新增的，可以累加
                const currentSession = await prisma.evaluationSession.findUnique({
                  where: { id: evaluation.id },
                  select: { totalOutputTokens: true, estimatedCost: true },
                });
                
                // inputTokens 用最后一次的值（包含整个历史上下文）
                const newInputTokens = usage.inputTokens || 0;
                // outputTokens 累加
                const newOutputTokens = (currentSession?.totalOutputTokens || 0) + (usage.outputTokens || 0);
                const newTotalTokens = newInputTokens + newOutputTokens;
                // 费用累加（如果自部署模型，费用为 0）
                const newEstimatedCost = (currentSession?.estimatedCost || 0) + callCost;
                
                await prisma.evaluationSession.update({
                  where: { id: evaluation.id },
                  data: {
                    totalInputTokens: newInputTokens,
                    totalOutputTokens: newOutputTokens,
                    totalTokens: newTotalTokens,
                    estimatedCost: newEstimatedCost,
                  },
                });
                
                console.log('[Ralph Loop] 实时更新 Token:', {
                  本次: { input: usage.inputTokens, output: usage.outputTokens },
                  当前累计: { input: newInputTokens, output: newOutputTokens },
                  说明: 'input=最后一次值(含历史), output=累加值',
                });
                
                // 发送 token 使用事件（包含累计值）
                const tokenEvent = JSON.stringify({
                  type: 'token_usage',
                  usage: {
                    // 本次调用
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    totalTokens: usage.inputTokens + usage.outputTokens,
                    estimatedCost: callCost,
                    // 累计值
                    accumulatedInputTokens: newInputTokens,
                    accumulatedOutputTokens: newOutputTokens,
                    accumulatedTotalTokens: newTotalTokens,
                    accumulatedCost: newEstimatedCost,
                  },
                  timestamp: Date.now(),
                });
                safeEnqueue(`data: ${tokenEvent}\n\n`);
              } catch (err) {
                console.error('[Ralph Loop] 保存 Token 使用记录失败:', err);
              }
            },
            onComplete: (fullResponseText) => {
              console.log('[Ralph Loop] 单次迭代完成，文本长度:', fullResponseText.length);
            },
            onError: async (error) => {
              // 检查是否为中止错误
              const isAborted = error.name === 'AbortError' || 
                error.message.includes('abort') || 
                error.message.includes('cancelled') ||
                error.message.includes('中止');

              if (isAborted) {
                console.log('[Ralph Loop] 检测到中止信号:', error.message);
                // 检查数据库状态确认是否已被中止
                const currentEval = await prisma.evaluationSession.findUnique({
                  where: { id: evaluation.id },
                  select: { status: true },
                });
                if (currentEval?.status === 'cancelled') {
                  console.log('[Ralph Loop] 评估已被外部中止，停止工作流');
                  // 不触发后续的队列处理
                  safeClose();
                  return;
                }
              }

              // 判断是否为致命错误（需要终止评估）
              const isFatal =
                error.message.includes('error_max_turns') ||
                error.message.includes('error_max_budget_usd') ||
                error.message.includes('error_max_structured_output_retries');

              if (!isFatal && !isAborted) {
                // 非致命错误（如 error_during_execution）：记录日志，不终止评估
                console.warn('[Ralph Loop] 非致命错误，评估继续:', error.message);
                const data = JSON.stringify({
                  type: 'error',
                  error: error.message,
                  fatal: false,
                  timestamp: Date.now(),
                });
                safeEnqueue(`data: ${data}\n\n`);
                return;
              }

              console.error('[Ralph Loop] 致命错误，终止评估:', error);

              // 从注册表移除 agent
              try {
                const { removeAgent } = await import('@/lib/agent-registry');
                removeAgent(evaluation.id);
              } catch (e) {
                console.error('移除 agent 注册失败:', e);
              }

              // 保存错误消息
              await prisma.sessionMessage.create({
                data: {
                  evaluationSessionId: evaluation.id,
                  role: 'assistant',
                  content: `评估失败: ${error.message}`,
                },
              }).catch(err => console.error('保存错误消息失败:', err));

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

              // 处理队列 - 启动下一个排队评估
              const { processQueue } = await import('@/services/evaluation-queue');
              processQueue().catch(err => console.error('[Queue] 处理队列失败:', err));

              // 发送错误事件
              try {
                const data = JSON.stringify({
                  type: 'error',
                  error: error.message,
                  fatal: true,
                  timestamp: Date.now(),
                });
                safeEnqueue(`data: ${data}\n\n`);
                safeClose();
              } catch {
                // Controller 可能已关闭，忽略错误
              }
            },
            onRalphComplete: async (result) => {
              console.log('[Ralph Loop] ========================================');
              console.log('[Ralph Loop] 任务完成!');
              console.log('[Ralph Loop] - 迭代次数:', result.iterations);
              console.log('[Ralph Loop] - 完成原因:', result.completionReason);
              console.log('[Ralph Loop] - 原因:', result.reason || '无');
              console.log('[Ralph Loop] - Token 使用:', result.totalUsage);
              console.log('[Ralph Loop] ========================================');

              // 检查是否为中止完成，如果是则不触发队列
              if (result.completionReason === 'aborted') {
                console.log('[Ralph Loop] 任务被中止，不触发队列处理');
                
                // 计算 token 费用（中止时也有 token 使用）
                const { calculateCost, getModelPricingOrDefault } = await import('@/services/evaluation/ralph-loop-agent');
                const modelId = modelConfig?.models || 'claude-sonnet-4-20250514';
                const pricing = getModelPricingOrDefault(modelId);
                const estimatedCost = calculateCost(result.totalUsage, pricing);
                
                console.log('[Ralph Loop] 中止时的 Token 统计:');
                console.log('  - 输入 Token:', result.totalUsage.inputTokens);
                console.log('  - 输出 Token:', result.totalUsage.outputTokens);
                console.log('  - 总 Token:', result.totalUsage.totalTokens);
                
                // 更新状态为 cancelled（同时保存 token 统计）
                await prisma.evaluationSession.update({
                  where: { id: evaluation.id },
                  data: {
                    status: 'cancelled',
                    completedAt: new Date(),
                    errorMessage: result.reason || '用户手动中止',
                    // Token 统计（中止时也记录）
                    totalInputTokens: result.totalUsage.inputTokens || 0,
                    totalOutputTokens: result.totalUsage.outputTokens || 0,
                    totalTokens: result.totalUsage.totalTokens || 0,
                    estimatedCost,
                  },
                });
                
                await prisma.project.update({
                  where: { id },
                  data: { status: 'idle' },
                });

                // 从注册表移除 agent
                const { removeAgent } = await import('@/lib/agent-registry');
                removeAgent(evaluation.id);

                // 发送中止事件
                const data = JSON.stringify({
                  type: 'aborted',
                  evaluationId: evaluation.id,
                  message: '评估已被中止',
                  timestamp: Date.now(),
                });
                safeEnqueue(`data: ${data}\n\n`);
                safeClose();
                return;
              }

              // 从项目目录读取 vulnerabilities.json 文件
              if (project.projectPath) {
                try {
                  const vulnFilePath = join(project.projectPath, 'vulnerabilities.json');
                  console.log('[Ralph Loop] 读取漏洞文件:', vulnFilePath);
                  const fileContent = await readFile(vulnFilePath, 'utf-8');
                  const jsonReport = JSON.parse(fileContent);

                  if (jsonReport.summary) {
                    const summary = jsonReport.summary;
                    const toInt = (v: any) => typeof v === 'string' ? parseInt(v) || 0 : (v || 0);
                    const vulns = Array.isArray(jsonReport.vulnerabilities) ? jsonReport.vulnerabilities : [];
                    const isVulnerable = (v: any) => v.vulnerable === true || v.vulnerable === 'true';
                    evaluationResult = {
                      total: toInt(summary.total) || vulns.filter(isVulnerable).length,
                      critical: 0,
                      high: 0,
                      medium: 0,
                      low: 0,
                      info: 0,
                      skills_used: [],
                      vulnerabilities: vulns,
                    };
                    console.log('[Ralph Loop] 从 vulnerabilities.json 读取到漏洞:', vulns.length, '条，其中 vulnerable=true:', vulns.filter(isVulnerable).length, '条');
                  }
                } catch (e: any) {
                  if (e.code === 'ENOENT') {
                    console.warn('[Ralph Loop] vulnerabilities.json 不存在，跳过漏洞导入');
                  } else {
                    console.error('[Ralph Loop] 读取 vulnerabilities.json 失败:', e);
                  }
                }
              }

              // 保存评估结果到数据库
              if (evaluationResult) {
                try {
                  await prisma.evaluationResult.upsert({
                    where: { evaluationId: evaluation.id },
                    update: {
                      totalVulns: evaluationResult.total || 0,
                      criticalCount: evaluationResult.critical || 0,
                      highCount: evaluationResult.high || 0,
                      mediumCount: evaluationResult.medium || 0,
                      lowCount: evaluationResult.low || 0,
                      infoCount: evaluationResult.info || 0,
                      skillsUsed: JSON.stringify(evaluationResult.skills_used || []),
                      rawReport: JSON.stringify(evaluationResult),
                    },
                    create: {
                      evaluationId: evaluation.id,
                      totalVulns: evaluationResult.total || 0,
                      criticalCount: evaluationResult.critical || 0,
                      highCount: evaluationResult.high || 0,
                      mediumCount: evaluationResult.medium || 0,
                      lowCount: evaluationResult.low || 0,
                      infoCount: evaluationResult.info || 0,
                      skillsUsed: JSON.stringify(evaluationResult.skills_used || []),
                      rawReport: JSON.stringify(evaluationResult),
                    },
                  });
                  console.log('[Ralph Loop] 评估结果已保存到数据库');

                  // 只保存 vulnerable: true 的漏洞（兼容布尔和字符串 "true"）
                  const isVulnerable = (v: any) => v.vulnerable === true || v.vulnerable === 'true';
                  const vulnsToSave = evaluationResult.vulnerabilities.filter(isVulnerable);
                  console.log(`[Ralph Loop] 共 ${evaluationResult.vulnerabilities.length} 条，其中 vulnerable=true: ${vulnsToSave.length} 条`);

                  for (const vuln of vulnsToSave) {
                    await prisma.vulnerability.create({
                      data: {
                        projectId: id,
                        evaluationId: evaluation.id,
                        title: vuln.title || '未命名漏洞',
                        type: vuln.type || 'unknown',       // 漏洞类型字段
                        severity: vuln.severity || 'info',
                        description: vuln.description || '',
                        filePath: vuln.location || null,
                        codeSnippet: vuln.POC || null,
                        fixSuggestion: null,
                        aiAnalysis: vuln.description || null,
                        cwe: vuln.cwe_id || null,
                        skill: vuln.skill || null,          // 发现工具/skill字段
                        status: 'new',
                      },
                    });
                  }
                  if (vulnsToSave.length > 0) {
                    console.log(`[Ralph Loop] 保存了 ${vulnsToSave.length} 个漏洞详情`);
                  }
                } catch (e) {
                  console.error('[Ralph Loop] 保存评估结果失败:', e);
                }
              }

              // 更新评估状态
              // verified = 检测到完成信号；max-iterations = 跑完所有迭代（视为完成）
              const summaryLabel =
                result.completionReason === 'verified' ? '验证完成' : '迭代完成';
              
              // 计算 token 费用
              const { calculateCost, getModelPricingOrDefault } = await import('@/services/evaluation/ralph-loop-agent');
              const modelId = modelConfig?.models || 'claude-sonnet-4-20250514';
              const pricing = getModelPricingOrDefault(modelId);
              const estimatedCost = calculateCost(result.totalUsage, pricing);
              
              console.log('[Ralph Loop] Token 统计:');
              console.log('  - 输入 Token:', result.totalUsage.inputTokens);
              console.log('  - 输出 Token:', result.totalUsage.outputTokens);
              console.log('  - 总 Token:', result.totalUsage.totalTokens);
              console.log('  - 预估费用:', `$${estimatedCost.toFixed(4)}`);
              
              await prisma.evaluationSession.update({
                where: { id: evaluation.id },
                data: {
                  status: 'completed',
                  completedAt: new Date(),
                  summary: `[Ralph Loop] ${summaryLabel}。共迭代 ${result.iterations} 次。${result.reason || ''}`,
                  // Token 统计
                  totalInputTokens: result.totalUsage.inputTokens || 0,
                  totalOutputTokens: result.totalUsage.outputTokens || 0,
                  totalTokens: result.totalUsage.totalTokens || 0,
                  estimatedCost,
                },
              });

              await prisma.project.update({
                where: { id },
                data: { status: 'completed' },
              });

              // 从注册表移除 agent
              const { removeAgent } = await import('@/lib/agent-registry');
              removeAgent(evaluation.id);
              console.log(`[Ralph Loop] Agent 完成，已从注册表移除: ${evaluation.id}`);

              // 处理队列 - 启动下一个排队评估
              const { processQueue } = await import('@/services/evaluation-queue');
              processQueue().catch(err => console.error('[Queue] 处理队列失败:', err));

              // 发送审计完成事件
              const { emitEvaluationComplete } = require('@/lib/event-bus');
              emitEvaluationComplete(evaluation.id, evaluationResult);
              
              // 发送完成事件（SSE）
              const data = JSON.stringify({
                type: 'done',
                evaluationId: evaluation.id,
                result: evaluationResult,
                ralphResult: {
                  iterations: result.iterations,
                  completionReason: result.completionReason,
                  reason: result.reason,
                },
                message: '评估工作已完成',
                timestamp: Date.now(),
              });
              safeEnqueue(`data: ${data}\n\n`);
              safeClose();
            },
          };

          // 启动 Ralph Loop
          console.log('='.repeat(60));
          console.log('[Evaluation] 🚀 启动 Ralph Loop 评估');
          console.log('[Evaluation] 评估ID:', evaluation.id);
          console.log('[Evaluation] 项目ID:', id);
          console.log('[Evaluation] 工作目录:', project.projectPath || '未设置');
          console.log('='.repeat(60));
          
          await agent.loop({
            evaluationId: evaluation.id,
            projectId: id,
            context: {
              projectName: project.name,
              projectDescription: project.description || undefined,
              environmentUrl: project.environmentUrl || undefined,
              files,
              taskDescription: taskDescription || undefined,
              initialMessage,
              workflowName,
            },
            callbacks,
          });
          
          console.log('='.repeat(60));
          console.log('[Evaluation] ✅ Ralph Loop 完成');
          console.log('='.repeat(60));
          
        } catch (error) {
          console.error('[Evaluation] 启动失败:', error);
          const errorMessage = error instanceof Error ? error.message : '未知错误';

          // 发送错误事件
          const data = JSON.stringify({
            type: 'error',
            error: errorMessage,
            timestamp: Date.now(),
          });
          safeEnqueue(`data: ${data}\n\n`);
          safeClose();

          // 更新状态
          await prisma.evaluationSession.update({
            where: { id: evaluation.id },
            data: {
              status: 'failed',
              errorMessage,
              completedAt: new Date(),
            },
          });

          await prisma.project.update({
            where: { id },
            data: { status: 'failed' },
          });
        }
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
    console.error('启动项目错误:', error);
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
 */
async function getModelConfig(modelId?: string | null) {
  // 如果提供了 modelId，直接使用该模型
  if (modelId) {
    const selectedModel = await prisma.modelConfig.findUnique({
      where: { id: modelId },
    });
    if (selectedModel && selectedModel.isActive) {
      return selectedModel;
    }
    console.warn(`[getModelConfig] 指定的模型 ${modelId} 不存在或未激活，将使用默认模型`);
  }
  
  // 使用数据库配置
  const defaultModel = await prisma.modelConfig.findFirst({
    where: {
      isActive: true,
      isDefault: true,
    },
  });

  if (!defaultModel) {
    const firstModel = await prisma.modelConfig.findFirst({
      where: { isActive: true },
    });
    return firstModel;
  }

  return defaultModel;
}

/**
 * 获取工作流预览
 */
async function getWorkflowPreview(workflowId: string, userId: string): Promise<{ markdown: string; name: string } | null> {
  try {
    // 获取用户的活跃配置（包含工作流配置）
    const userConfig = await prisma.opencodeConfig.findFirst({
      where: {
        userId: userId,
        isActive: true,
      },
    });

    let workflowConfig = {
      startNodeLabel: '开始',
      startNodeDescription: 'Agent编排的起始点',
      endNodeLabel: '结束',
      endNodeDescription: 'Agent编排的结束点',
    };

    // 从用户的 OpencodeConfig 中读取工作流配置
    if (userConfig?.workflowConfig) {
      try {
        const parsed = JSON.parse(userConfig.workflowConfig);
        workflowConfig = { ...workflowConfig, ...parsed };
        console.log('[WorkflowPreview] 加载工作流配置:', workflowConfig);
      } catch (e) {
        console.error('[WorkflowPreview] 解析工作流配置失败:', e);
      }
    } else {
      console.log('[WorkflowPreview] 使用默认工作流配置');
    }

    // 查询工作流及其节点和边
    const workflow = await prisma.workflow.findFirst({
      where: {
        id: workflowId,
        OR: [
          { userId },
          { shares: { some: { sharedWith: userId } } },
        ],
      },
      include: {
        nodes: true,
        edges: true,
      },
    });

    if (!workflow) {
      return null;
    }

    // 转换节点数据
    const nodes = workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: {
        x: node.positionX,
        y: node.positionY,
      },
      data: node.data ? JSON.parse(node.data) : {},
    }));

    // 转换边数据
    const edges = workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      data: edge.data ? JSON.parse(edge.data) : undefined,
    }));

    // 生成 Markdown 预览
    const markdown = generatePreviewMarkdown(nodes, edges, workflowConfig, workflow.name);

    return { markdown, name: workflow.name };
  } catch (error) {
    console.error('获取工作流预览失败:', error);
    return null;
  }
}

/**
 * 生成工作流的 Markdown 预览
 */
function generatePreviewMarkdown(
  nodes: any[],
  edges: any[],
  workflowConfig: {
    startNodeLabel: string;
    startNodeDescription: string;
    endNodeLabel: string;
    endNodeDescription: string;
  },
  workflowName: string
): string {
  let markdown = `# ${workflowName}\n\n`;

  // 找到开始节点
  const startNode = nodes.find(n => n.type === 'start');
  // 找到结束节点
  const endNode = nodes.find(n => n.type === 'end');
  // 找到所有任务节点（从开始节点直接连接的）
  const taskNodes: { node: typeof nodes[0]; subtasks: typeof nodes }[] = [];

  // 构建边的关系映射
  const outEdges = new Map<string, typeof edges>();
  edges.forEach(e => {
    if (!outEdges.has(e.source)) {
      outEdges.set(e.source, []);
    }
    outEdges.get(e.source)!.push(e);
  });

  // 记录已处理的节点
  const processedNodes = new Set<string>();

  // 从开始节点开始，按顺序获取任务节点
  if (startNode) {
    processedNodes.add(startNode.id);
    const startEdges = outEdges.get(startNode.id) || [];

    // 遍历从开始节点出发的边，找到任务节点
    const processTask = (taskId: string) => {
      const taskNode = nodes.find(n => n.id === taskId && n.type === 'task');
      if (!taskNode || processedNodes.has(taskId)) return;
      processedNodes.add(taskId);

      const subtasks: typeof nodes = [];

      // 找到从任务节点底部(subtask handle)连接出去的子任务
      const taskOutEdges = outEdges.get(taskId) || [];
      taskOutEdges.forEach(edge => {
        // 检查是否是子任务连接（sourceHandle 为 'subtask' 或底部连接）
        const isSubtaskEdge = edge.sourceHandle === 'subtask' ||
          (edge.sourceHandle === null && nodes.find(n => n.id === edge.target)?.type === 'subtask');

        if (isSubtaskEdge) {
          // 收集所有子任务（包括链式连接的子任务）
          const collectSubtasks = (subtaskId: string) => {
            const subtaskNode = nodes.find(n => n.id === subtaskId && n.type === 'subtask');
            if (subtaskNode && !processedNodes.has(subtaskId)) {
              processedNodes.add(subtaskId);
              subtasks.push(subtaskNode);

              // 检查这个子任务是否连接到其他子任务
              const subtaskOutEdges = outEdges.get(subtaskId) || [];
              subtaskOutEdges.forEach(subEdge => {
                collectSubtasks(subEdge.target);
              });
            }
          };
          collectSubtasks(edge.target);
        }
      });

      taskNodes.push({ node: taskNode, subtasks });
    };

    // 按边的顺序处理任务节点
    startEdges.forEach(edge => {
      if (edge.target) {
        const targetNode = nodes.find(n => n.id === edge.target);
        if (targetNode?.type === 'task') {
          processTask(edge.target);
        }
      }
    });

    // 处理链式任务连接（任务到任务）
    let currentTask: typeof nodes[0] | undefined = taskNodes.length > 0 ? taskNodes[taskNodes.length - 1].node : undefined;
    while (currentTask) {
      const taskOutEdges = outEdges.get(currentTask.id) || [];
      const nextTaskEdge = taskOutEdges.find(e => (e.sourceHandle === 'out' || !e.sourceHandle) && nodes.find(n => n.id === e.target)?.type === 'task');
      if (nextTaskEdge) {
        processTask(nextTaskEdge.target);
        currentTask = taskNodes.find(t => t.node.id === nextTaskEdge.target)?.node;
      } else {
        break;
      }
    }
  }

  // 输出开始节点
  if (startNode) {
    const startLabel = workflowConfig.startNodeLabel || '开始';
    const startDesc = workflowConfig.startNodeDescription || 'Agent编排的起始点';
    const startType = NODE_TYPE_MAP[startNode.type as keyof typeof NODE_TYPE_MAP];
    markdown += `## 1. ${startLabel}\n`;
    markdown += `**类型**: ${startType?.label || startNode.type}  \n`;
    markdown += `**描述**: ${startDesc}\n\n`;
  }

  // 输出任务节点和子任务
  taskNodes.forEach((task, taskIdx) => {
    const taskData = task.node.data || {};
    const taskNumber = taskIdx + 2; // 从2开始（1是开始节点）
    const taskType = NODE_TYPE_MAP[task.node.type as keyof typeof NODE_TYPE_MAP];

    markdown += `## ${taskNumber}. ${taskData.label || taskType?.label || '任务'}\n`;
    markdown += `**类型**: ${taskType?.label || task.node.type}  \n`;
    if (taskData.description) {
      markdown += `**描述**: ${taskData.description}`;
    }
    markdown += '\n\n';

    // 输出子任务
    task.subtasks.forEach((subtask, subtaskIdx) => {
      const subtaskData = subtask.data || {};
      const subtaskType = NODE_TYPE_MAP[subtask.type as keyof typeof NODE_TYPE_MAP];
      const subtaskNumber = `${taskNumber}.${subtaskIdx + 1}`;

      markdown += `### ${subtaskNumber}. ${subtaskData.label || subtaskType?.label || '子任务'}\n`;
      markdown += `**类型**: ${subtaskType?.label || subtask.type}  \n`;
      if (subtaskData.description) {
        markdown += `**描述**: ${subtaskData.description}`;
      }
      markdown += '\n\n';
    });
  });

  // 输出结束节点
  if (endNode) {
    const endLabel = workflowConfig.endNodeLabel || '结束';
    const endDesc = workflowConfig.endNodeDescription || 'Agent编排的结束点';
    const endNumber = taskNodes.length + 2; // 开始节点 + 任务节点数 + 1
    const endType = NODE_TYPE_MAP[endNode.type as keyof typeof NODE_TYPE_MAP];
    markdown += `## ${endNumber}. ${endLabel}\n`;
    markdown += `**类型**: ${endType?.label || endNode.type}  \n`;
    markdown += `**描述**: ${endDesc}\n\n`;
  }

  return markdown;
}
