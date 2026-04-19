// src/app/api/projects/[id]/start/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';
import { createRalphLoopAgent, RalphLoopAgentCallbacks, securityAuditVerifier, createCombinedVerifier } from '@/services/evaluation';
import { AppMcpServerConfig } from '@/services/ai/claude-agent';
import { claudeProjectManager } from '@/lib/claude-project-sync';
import { mkdir, writeFile, readFile, access, rm } from 'fs/promises';
import { join } from 'path';
import { copySkillsToProject, copySkillsByIds } from '@/services/skill-files';
import { matchSkillsByCategoryValues } from '@/services/skill-matcher';
import { registerAgent } from '@/lib/agent-registry';
import { buildExperiencePromptWithMeta } from '@/services/autonomous-evolution/system-prompt-builder';
import { createWatchdog, stopWatchdog, recordWatchdogActivity } from '@/lib/stream-watchdog';
import { createEmptyAnalysisReport } from '@/services/analysis-report';
import { createSkillExecutionsForEvaluation } from '@/services/skill-execution-tracker';

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
    let enableMcp = true;
    let enableToolPermissions = true;
    let queuedEvaluationId: string | null = null; // 队列启动时复用的评估ID
    try {
      const body = await request.json();
      workflowId = body.workflowId || null;
      agentTeamId = body.agentTeamId || null;
      modelId = body.modelId || null;
      roleModels = body.roleModels || null;
      enableMcp = body.enableMcp !== false;
      enableToolPermissions = body.enableToolPermissions !== false;
      queuedEvaluationId = body.queuedEvaluationId || null;
    } catch {
      // 如果没有请求体，继续执行
    }

    console.log('[启动评估] workflowId:', workflowId, 'modelId:', modelId, 'roleModels:', roleModels?.length || 0);

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
          id: `eval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

    // 加载 MCP 服务器配置（用户私有 + 共享 + 项目级别）
    let mcpServers: any[] = [];
    if (enableMcp) {
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
      mcpServers = [...allServers.filter(s => !projectNames.has(s.name))];
      // 添加项目配置（优先级最高）
      mcpServers = [...mcpServers, ...projectMcpServers];
      
      console.log(`[启动评估] 加载 MCP 服务器: 共享 ${sharedMcpServers.length} 个, 用户私有 ${userMcpServers.length} 个, 项目 ${projectMcpServers.length} 个, 合并后 ${mcpServers.length} 个`);
    }

    // 加载工具权限配置
    let toolPermissions: any[] = [];
    if (enableToolPermissions) {
      toolPermissions = await prisma.toolPermission.findMany({
        where: { projectId: id },
      });
    }

    // 检查是否有运行中的评估会话
    const runningEvaluations = project.EvaluationSession || [];
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
        console.warn('[启动评估] workflowConfig JSON 解析失败');
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

    // 注入自主进化经验到 System Prompt（预注入在开头，高关注度位置）
    let injectedExperiences: { id: string; title: string; errorCategory: string; hitCount: number }[] = [];
    try {
      const expResult = await buildExperiencePromptWithMeta();
      if (expResult.prompt) {
        // 预注入放在 System Prompt 开头（高关注度位置）
        const originalPrompt = sdkOptions.systemPrompt || '';
        sdkOptions.systemPrompt = expResult.prompt + '\n\n' + originalPrompt;
        injectedExperiences = expResult.experiences;
        console.log(`[启动评估] 已预注入自主进化经验到 System Prompt 开头，共 ${expResult.count} 条（Top 3 限制）:`);
        expResult.experiences.forEach((e, i) => {
          console.log(`[启动评估]   ${i + 1}. [${e.errorCategory}] ${e.title} (命中${e.hitCount}次)`);
        });
      } else {
        console.log('[启动评估] 无已启用的自主进化经验（isInjected=true 的记录为空）');
      }
    } catch (err) {
      console.warn('[启动评估] 注入自主进化经验失败:', err);
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
          console.log(`[启动评估] 已清理: ${target.path}`);
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
          console.log(`[启动评估] 已创建目录: ${dir}`);
        } catch (error) {
          console.error(`[启动评估] 创建目录失败: ${dir}`, error);
        }
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
        console.log('[启动评估] 项目技术栈:', projectTechStack?.join(', ') || '无');
      } catch {
        console.warn('[启动评估] 项目技术栈解析失败，将拷贝所有 Skills');
        projectTechStack = null;
      }
    } else {
      console.log('[启动评估] 项目未设置技术栈，将拷贝所有启用的 Skills');
    }
    
    if (project.projectPath) {
      try {
        console.log('[启动评估] 开始同步 Skills 到项目目录');
        
        // workflowId 必须提供，否则拒绝执行
        if (!workflowId) {
          return NextResponse.json(
            { error: '必须指定工作流编排（workflowId），无法启动评估' },
            { status: 400 }
          );
        }

        // 按 WorkflowNode 加载 Skills

        // 查询 Workflow 的所有节点
        const workflowNodes = await prisma.workflowNode.findMany({
          where: { workflowId },
          select: {
            id: true,
            data: true,
            vulnerabilityCategories: true,
            skills: true,
          },
        });

        console.log(`[启动评估] 找到 ${workflowNodes.length} 个 WorkflowNode`);

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
              console.log(`[启动评估] Node ${node.id}: 模式 3 - 漏洞分类 ${categoryValues.join(', ')}`);
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
              console.log(`[启动评估] Node ${node.id}: 匹配到 ${matchedIds.length} 个 Skills`);
              continue;
            }
          }

          // 模式 2：手工指定
          if (node.skills) {
            console.log(`[启动评估] Node ${node.id}: 模式 2 - 手工指定 Skills`);
            try {
              const skillIds = JSON.parse(node.skills);
              if (Array.isArray(skillIds)) {
                allSkillIds.push(...skillIds);
                console.log(`[启动评估] Node ${node.id}: 指定了 ${skillIds.length} 个 Skills`);
              }
            } catch {
              console.warn(`[启动评估] Node ${node.id}: skills 字段 JSON 解析失败`);
            }
            continue;
          }

          // 模式 1：自定义描述 - 由大模型根据描述自主加载 Skills
          // 不预设 Skills，让 Agent 通过 Skill 工具自主选择
          console.log(`[启动评估] Node ${node.id}: 模式 1 - 自定义描述，由 Agent 自主加载 Skills`);
          hasDescriptionModeNode = true;
        }

        // 去重
        uniqueSkillIds = [...new Set(allSkillIds)];
        console.log(`[启动评估] 合并后共 ${uniqueSkillIds.length} 个唯一 Skill IDs（模式2/3）`);

        // 模式 1：拷贝所有技术栈匹配的 Skills，供 Agent 自主选择
        if (hasDescriptionModeNode) {
          console.log('[启动评估] 存在自定义描述节点，拷贝所有技术栈匹配的 Skills 供 Agent 自主选择');
          copyResult = await copySkillsToProject(
            project.projectPath,
            payload.userId,
            undefined,
            projectTechStack
          );
          console.log(`[启动评估] 已拷贝 ${copyResult.success} 个 Skills 供模式 1 节点自主选择`);
          
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
        
        console.log(`[启动评估] Skills 同步完成:`);
        console.log(`  - 成功: ${copyResult.success}`);
        console.log(`  - 失败: ${copyResult.failed}`);
        console.log(`  - 拷贝的 Skills: ${copyResult.copiedSkills.join(', ')}`);
        
        // 区分必须执行的 Skills（模式2/3）和可选择的 Skills（模式1）
        const mandatorySkillIds = uniqueSkillIds; // 模式 2/3 指定的 Skills
        const availableSkillIds = copyResult.skillIds.filter(id => !mandatorySkillIds.includes(id)); // 模式 1 可选择的 Skills
        
        console.log(`[启动评估] 必须执行的 Skills（模式2/3）: ${mandatorySkillIds.length} 个`);
        console.log(`[启动评估] 可选择的 Skills（模式1）: ${availableSkillIds.length} 个`);
        
        // 记录使用的 Skills ID 列表（记录所有拷贝的 Skills）
        if (copyResult.skillIds.length > 0) {
          const skills = await prisma.skill.findMany({
            where: { id: { in: copyResult.skillIds } },
            select: { id: true, name: true, displayName: true, description: true, severity: true },
          });
          const skillsUsed = skills.map(s => ({ skillId: s.id, skillName: s.name }));
          skillsUsedJson = JSON.stringify(skillsUsed);
          console.log(`[启动评估] 使用的 Skills ID: ${copyResult.skillIds.length} 个`);
          
          // 构建 Skills 使用说明，区分必须执行和可选择
          const mandatorySkills = skills.filter(s => mandatorySkillIds.includes(s.id));
          const availableSkills = skills.filter(s => availableSkillIds.includes(s.id));
          
          const skillsPrompt = buildSkillsUsagePromptV2(mandatorySkills, availableSkills);
          if (skillsPrompt) {
            const originalPrompt = sdkOptions.systemPrompt || '';
            sdkOptions.systemPrompt = originalPrompt + '\n\n' + skillsPrompt;
            console.log(`[启动评估] 已将 Skills 使用说明追加到系统提示词`);
          }
        }
        
        // 追加评估报告分析要求
        const analysisPrompt = buildAnalysisReportPrompt();
        sdkOptions.systemPrompt = (sdkOptions.systemPrompt || '') + analysisPrompt;
        console.log(`[启动评估] 已将评估报告分析要求追加到系统提示词`);
        
        if (copyResult.failed > 0) {
          copyResult.errors.forEach(err => {
            console.error(`    - ${err}`);
          });
        }
      } catch (error) {
        console.error('[启动评估] Skills 同步失败:', error);
        // Skills 同步失败应该阻止评估启动
        return NextResponse.json({
          error: `Skills 同步失败: ${error instanceof Error ? error.message : String(error)}`,
        }, { status: 500 });
      }
    }
    
    // ========================================
    // 生成用户提示词（从 WorkflowNode 动态生成）
    // ========================================
    
    // 查询 Workflow 的所有节点（包含 type 用于排序）
    const workflowNodes = await prisma.workflowNode.findMany({
      where: { workflowId },
      select: {
        id: true,
        type: true,
        data: true,
        vulnerabilityCategories: true,
        skills: true,
      },
    });
    
    if (workflowNodes.length === 0) {
      return NextResponse.json({
        error: '工作流配置缺少节点，无法启动评估',
      }, { status: 400 });
    }
    
    // 按拓扑顺序排序节点
    const nodeOrder = new Map<string, number>();
    let order = 0;
    const startNode = workflowNodes.find(n => n.type === 'start');
    if (startNode) {
      nodeOrder.set(startNode.id, order++);
      const queue = [startNode.id];
      const visited = new Set([startNode.id]);
      // 查询边用于拓扑排序
      const edges = await prisma.workflowEdge.findMany({
        where: { workflowId },
        select: { sourceId: true, targetId: true },
      });
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const currentOrder = nodeOrder.get(currentId)!;
        edges.filter(e => e.sourceId === currentId).forEach(edge => {
          if (!visited.has(edge.targetId)) {
            visited.add(edge.targetId);
            nodeOrder.set(edge.targetId, currentOrder + 1);
            queue.push(edge.targetId);
          }
        });
      }
    }
    workflowNodes.forEach(node => { if (!nodeOrder.has(node.id)) nodeOrder.set(node.id, order++); });
    const sortedNodes = [...workflowNodes].sort((a, b) => (nodeOrder.get(a.id) ?? 999) - (nodeOrder.get(b.id) ?? 999));
    
    // 计算总任务数
    const totalTasks = sortedNodes.length;
    
    // 获取所有 Skills 信息（用于生成用户提示词中的 Skills 列表）
    const allSkillsMap = new Map<string, { id: string; name: string; displayName: string | null; description: string | null }>();
    if (uniqueSkillIds.length > 0) {
      const skillsData = await prisma.skill.findMany({
        where: { id: { in: uniqueSkillIds } },
        select: { id: true, name: true, displayName: true, description: true },
      });
      skillsData.forEach(s => allSkillsMap.set(s.id, s));
    }
    
    // 生成用户提示词
    let userPrompt = '';
    let taskIndex = 0;
    
    for (const node of sortedNodes) {
      // 解析 node.data
      let nodeData: { label?: string; description?: string; skillLoadingMode?: string; skills?: string; vulnerabilityCategories?: string[] } = {};
      if (node.data) {
        try {
          nodeData = JSON.parse(node.data);
        } catch {
          console.warn(`[启动评估] Node ${node.id} data JSON 解析失败`);
        }
      }
      
      // 开始节点 - 使用系统配置的描述
      if (node.type === 'start') {
        userPrompt += `## 任务 1：${workflowConfigParsed?.startNodeLabel || '开始'}\n\n`;
        if (workflowConfigParsed?.startNodeDescription) {
          userPrompt += `${workflowConfigParsed.startNodeDescription}\n\n`;
        }
        userPrompt += '---\n\n';
        continue;
      }
      
      // 结束节点 - 使用系统配置的描述
      if (node.type === 'end') {
        userPrompt += `## 任务 ${totalTasks}：${workflowConfigParsed?.endNodeLabel || '结束'}\n\n`;
        if (workflowConfigParsed?.endNodeDescription) {
          userPrompt += `${workflowConfigParsed.endNodeDescription}\n\n`;
        }
        userPrompt += '---\n\n';
        continue;
      }
      
      // 其他任务节点
      taskIndex++;
      userPrompt += `## 任务 ${taskIndex + 1}：${nodeData.label || '未命名任务'}\n\n`;
      
      // 节点描述
      if (nodeData.description) {
        userPrompt += `${nodeData.description}\n\n`;
      }
      
      // Skill 加载模式
      const mode = nodeData.skillLoadingMode || 'description';
      
      if (mode === 'manual' && nodeData.skills) {
        // 模式2：手工指定 Skills
        let skillIds: string[] = [];
        try { skillIds = JSON.parse(nodeData.skills); } catch { /* ignore */ }
        if (skillIds.length > 0) {
          userPrompt += `请执行以下安全检查任务，必须执行所有指定的 Skills：\n\n`;
          userPrompt += `必须执行的 Skills：\n`;
          skillIds.forEach((id, i) => {
            const skill = allSkillsMap.get(id);
            userPrompt += `${i + 1}. ${skill ? (skill.displayName || skill.name) : id}\n`;
          });
          userPrompt += '\n请确保以上所有 Skills 都被执行，不要遗漏。\n\n';
        }
      } else if (mode === 'vulnerability' && node.vulnerabilityCategories) {
        // 模式3：漏洞分类
        let categoryValues: string[] = [];
        try { categoryValues = JSON.parse(node.vulnerabilityCategories); } catch { /* ignore */ }
        if (categoryValues.length > 0) {
          const matchedIds = await matchSkillsByCategoryValues(categoryValues, projectTechStack);
          if (matchedIds.length > 0) {
            userPrompt += `请执行以下安全检查任务，必须执行所有匹配的 Skills：\n\n`;
            userPrompt += `必须执行的 Skills：\n`;
            matchedIds.forEach((id, i) => {
              const skill = allSkillsMap.get(id);
              userPrompt += `${i + 1}. ${skill ? (skill.displayName || skill.name) : id}\n`;
            });
            userPrompt += '\n请确保以上所有 Skills 都被执行，不要遗漏。\n\n';
          }
        }
      }
      // 模式1：自定义描述 - 只有描述，不需要额外提示
      
      userPrompt += '---\n\n';
    }
    
    // 检查用户提示词是否为空
    if (!userPrompt.trim()) {
      return NextResponse.json({
        error: '工作流节点缺少描述，无法启动评估',
      }, { status: 400 });
    }
    
    const initialMessage = userPrompt;
    
    console.log('[启动评估] 系统提示词长度:', globalConfig.customSystemPrompt.length);
    console.log('[启动评估] 用户提示词长度:', initialMessage.length);
    console.log('[启动评估] 用户提示词前200字符:', initialMessage.substring(0, 200) + '...');
    
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
          workflowId: workflowId,
          roleModels: roleModels ? JSON.stringify(roleModels) : null,
          skillsUsed: skillsUsedJson,  // 记录使用的 Skills
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
          id: `eval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          projectId: id,
          workflowId: workflowId,
          agentTeamId: agentTeamId, // 关联 Agent Team
          modelConfigId: modelConfig.id, // 关联模型配置
          roleModels: roleModels ? JSON.stringify(roleModels) : null,
          skillsUsed: skillsUsedJson,  // 记录使用的 Skills
          status: 'running',
          modelName: modelConfig.name, // 保存模型名称
          providerType: modelConfig.providerType, // 保存提供商类型
        },
      });
      console.log('[启动评估] 创建新评估记录:', evaluation.id, 'workflowId:', workflowId, 'roleModels:', roleModels?.length || 0, 'skillsUsed:', skillsUsedJson ? JSON.parse(skillsUsedJson).length : 0);
    }

    // 创建 Skill 执行记录（记录所有使用的 Skills）
    if (copyResult && copyResult.skillIds && copyResult.skillIds.length > 0) {
      try {
        await createSkillExecutionsForEvaluation({
          skillIds: copyResult.skillIds,
          projectId: id,
          evaluationId: evaluation.id,
        });
        console.log(`[启动评估] 已创建 ${copyResult.skillIds.length} 个 Skill 执行记录`);
      } catch (error) {
        console.error('[启动评估] 创建 Skill 执行记录失败:', error);
        // 不阻止评估启动
      }
    }

    // 记录经验引用（哪些经验被注入到本次评估）
    if (injectedExperiences.length > 0) {
      await prisma.experienceUsageLog.createMany({
        data: injectedExperiences.map((e, index) => ({
          id: `explog-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
          experienceId: e.id,
          evaluationId: evaluation.id,
          projectId: id,
        })),
      });
      console.log(`[启动评估] 已记录 ${injectedExperiences.length} 条经验引用`);
    }

    // 创建空的分析报告（评估过程中由大模型填充）
    try {
      await createEmptyAnalysisReport({
        evaluationId: evaluation.id,
        projectId: id,
      });
      console.log(`[启动评估] 已创建分析报告记录`);
    } catch (error) {
      console.error('[启动评估] 创建分析报告记录失败:', error);
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
        console.log(`[启动评估] 已创建 Skill 执行记录文件: ${logPath}`);
      } catch (error) {
        console.error('[启动评估] 创建 Skill 执行记录文件失败:', error);
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
    
    // Skill 执行验证器：检查所有必须执行的 Skills 是否都已执行
    const mandatorySkillIds = copyResult?.skillIds ? 
      copyResult.skillIds.filter(id => uniqueSkillIds.includes(id)) : 
      uniqueSkillIds;
    
    const skillExecutionVerifier = async (context: any) => {
      // 如果没有必须执行的 Skills，跳过验证
      if (mandatorySkillIds.length === 0) {
        return { complete: true, reason: '无必须执行的 Skills' };
      }
      
      try {
        // 查询已执行的 Skills
        const executedSkills = await prisma.skillExecution.findMany({
          where: {
            evaluationId: evaluation.id,
            status: 'completed',
          },
          select: { skillId: true },
        });
        
        const executedSkillIds = new Set(executedSkills.map(e => e.skillId));
        const missingSkillIds = mandatorySkillIds.filter(id => !executedSkillIds.has(id));
        
        if (missingSkillIds.length === 0) {
          console.log(`[Verifier] 所有必须的 Skills 已执行 (${mandatorySkillIds.length}/${mandatorySkillIds.length})`);
          return { complete: true, reason: '所有必须的 Skills 已执行' };
        } else {
          console.log(`[Verifier] 还有 ${missingSkillIds.length} 个 Skills 未执行`);
          return { 
            complete: false, 
            reason: `还有 ${missingSkillIds.length} 个必须的 Skills 未执行` 
          };
        }
      } catch (error) {
        console.error('[Verifier] Skill 执行验证失败:', error);
        return { complete: true, reason: '验证失败，跳过 Skill 检查' };
      }
    };

    const verifier = createCombinedVerifier([
      vulnFileVerifier,
      skillExecutionVerifier,
    ], 'all'); // 全部验证器通过才算完成
    
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
          
          // 记录迭代活动到 Watchdog
          recordWatchdogActivity(evaluation.id, 'iteration', { iteration, duration });
          
          // 保存迭代记录到数据库（包含模型信息）
          try {
            await prisma.evaluationIteration.create({
              data: {
                id: `iter-${Date.now()}-${iteration}-${Math.random().toString(36).substr(2, 9)}`,
                evaluationSessionId: evaluation.id,
                iterationNumber: iteration,
                status: 'completed',
                duration,
                completedAt: new Date(),
                updatedAt: new Date(),
                // 添加模型信息
                modelConfigId: modelConfig.id,
                modelName: modelConfig.name,
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
    console.log('[Ralph Loop] 系统提示词已传递，长度:', sdkOptions.systemPrompt?.length || 0);
    console.log('[Ralph Loop] 系统提示词前300字符:', sdkOptions.systemPrompt?.substring(0, 300) || '未设置');

    // 注册 agent 到注册表（用于后续中止）
    registerAgent(evaluation.id, agent);
    console.log(`[Evaluation] Agent 已注册: ${evaluation.id}`);

    // 启动 SSE 流健康检查 Watchdog
    const watchdog = createWatchdog({
      evaluationId: evaluation.id,
      projectId: id,
      idleTimeout: 5 * 60 * 1000,  // 5 分钟空闲超时
      maxRunTime: 30 * 60 * 1000,  // 30 分钟最大运行时间
      onTimeout: (reason) => {
        console.error(`[Watchdog] 评估超时中止: ${reason}`);
      },
      onHeartbeat: (stats) => {
        // 心跳日志由 Watchdog 内部处理
      },
    });
    console.log(`[Evaluation] Watchdog 已启动: ${evaluation.id}`);

    // 构建文件列表
    const files = project.ProjectFile.map(f => ({
      name: f.fileName,
      type: f.fileType,
      size: f.fileSize,
    }));

    // 系统提示词已设置（customSystemPrompt），评估指令由用户在 customSystemPrompt 中自行维护

    // 日志：启动评估前的完整信息
    console.log('[启动评估] ========================================');
    console.log('[启动评估] 启动评估前检查:');
    console.log('[启动评估] - 项目ID:', id);
    console.log('[启动评估] - 项目名称:', project.name);
    console.log('[启动评估] - 项目路径:', project.projectPath || '未设置');
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
    console.log('[启动评估] - 用户提示词:', initialMessage?.substring(0, 300) || '无');
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
                  id: `nodeexec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
                    id: `token-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
                  id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

                // 停止 Watchdog
                stopWatchdog(evaluation.id);

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
                      id: `result-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
                        id: `vuln-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
                        updatedAt: new Date(),
                      },
                    });
                  }
                  if (vulnsToSave.length > 0) {
                    console.log(`[Ralph Loop] 保存了 ${vulnsToSave.length} 个漏洞详情`);
                    
                    // ===== 新增：Skill 匹配和 Mapping 创建 =====
                    // 根据 vulnerabilities.json 的 skill 字段匹配 Skill 并创建 Mapping 记录
                    try {
                      // 1. 获取本次评估使用的 Skill 列表
                      let usedSkills: { skillId: string; skillName: string }[] = [];
                      if (evaluation.skillsUsed) {
                        usedSkills = JSON.parse(evaluation.skillsUsed);
                      }
                      
                      // 2. 构建 Skill 名称 -> ID 映射
                      const skillNameToId = new Map<string, string>();
                      for (const s of usedSkills) {
                        skillNameToId.set(s.skillName, s.skillId);
                        // 也添加小写版本用于模糊匹配
                        skillNameToId.set(s.skillName.toLowerCase(), s.skillId);
                      }
                      
                      // 3. 统计每个 Skill 发现的漏洞数量
                      const skillFindings = new Map<string, { skillId: string; count: number; matchType: string }>();
                      
                      for (const vuln of vulnsToSave) {
                        if (vuln.skill) {
                          const reportedSkillName = vuln.skill;
                          let matchedSkillId: string | null = null;
                          let matchType = 'unmatched';
                          
                          // 精确匹配
                          if (skillNameToId.has(reportedSkillName)) {
                            matchedSkillId = skillNameToId.get(reportedSkillName)!;
                            matchType = 'exact';
                          }
                          // 模糊匹配（小写）
                          else if (skillNameToId.has(reportedSkillName.toLowerCase())) {
                            matchedSkillId = skillNameToId.get(reportedSkillName.toLowerCase())!;
                            matchType = 'fuzzy';
                          }
                          // 尝试从数据库查询
                          else {
                            const dbSkill = await prisma.skill.findFirst({
                              where: { name: reportedSkillName, isLatest: true, isActive: true },
                              select: { id: true },
                            });
                            if (dbSkill) {
                              matchedSkillId = dbSkill.id;
                              matchType = 'exact';
                            }
                          }
                          
                          if (matchedSkillId) {
                            const existing = skillFindings.get(matchedSkillId);
                            if (existing) {
                              existing.count++;
                            } else {
                              skillFindings.set(matchedSkillId, { skillId: matchedSkillId, count: 1, matchType });
                            }
                          }
                        }
                      }
                      
                      // 4. 更新 Skill 统计并创建 Mapping 记录
                      for (const [skillId, info] of skillFindings) {
                        // 更新 vulnerabilityCount
                        await prisma.skill.update({
                          where: { id: skillId },
                          data: { vulnerabilityCount: { increment: info.count } },
                        });
                        
                        // 为每个漏洞创建 Mapping 记录
                        const relatedVulns = vulnsToSave.filter(v => v.skill && 
                          (skillNameToId.get(v.skill) === skillId || 
                           skillNameToId.get(v.skill?.toLowerCase()) === skillId));
                        
                        for (const vuln of relatedVulns) {
                          // 查找刚创建的漏洞记录
                          const dbVuln = await prisma.vulnerability.findFirst({
                            where: {
                              projectId: id,
                              evaluationId: evaluation.id,
                              title: vuln.title || '未命名漏洞',
                            },
                            orderBy: { createdAt: 'desc' },
                            select: { id: true },
                          });
                          
                          if (dbVuln) {
                            await prisma.skillVulnerabilityMapping.create({
                              data: {
                                skillId,
                                vulnerabilityId: dbVuln.id,
                                evaluationId: evaluation.id,
                                projectId: id,
                                skillNameReported: vuln.skill,
                                matchType: info.matchType,
                              },
                            }).catch(() => {
                              // 忽略唯一约束冲突
                            });
                          }
                        }
                        
                        console.log(`[Ralph Loop] Skill ${skillId} 发现 ${info.count} 个漏洞 (${info.matchType} 匹配)`);
                      }
                    } catch (mappingError) {
                      console.error('[Ralph Loop] Skill 匹配失败:', mappingError);
                    }
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
                  endReason: 'completed',
                  endMessage: result.completionReason === 'verified' 
                    ? '评估任务已完成，结果已验证' 
                    : `评估结束: ${result.reason || '达到迭代上限'}`,
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

              // 停止 Watchdog
              stopWatchdog(evaluation.id);
              console.log(`[Ralph Loop] Watchdog 已停止: ${evaluation.id}`);

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
              initialMessage,
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
              endReason: 'error',
              endMessage: errorMessage,
              errorMessage,
              completedAt: new Date(),
            },
          });

          await prisma.project.update({
            where: { id },
            data: { status: 'failed' },
          });

          // 停止 Watchdog
          stopWatchdog(evaluation.id);
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
      console.warn(`[getModelConfig] 用户 ${userId} 无权使用模型 ${modelId}`);
    }
    console.warn(`[getModelConfig] 指定的模型 ${modelId} 不存在或未激活，将使用默认模型`);
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
