// src/services/evaluation/enhanced-caller.ts

import { ClaudeAgentService, ClaudeAgentCallbacks, createClaudeAgentService, AppMcpServerConfig, ToolPermissionRule, AgentDefinition } from '@/services/ai';
import { parseAndSaveResults } from './result-parser';
import { prisma } from '@/lib/prisma';
import { recordWatchdogActivity } from '@/lib/stream-watchdog';
import { completeSkillExecution } from '@/services/skill-execution-tracker';
import { updateAnalysisReport, parseAnalysisFromOutput } from '@/services/analysis-report';
import { updateSkillExecutionLog } from '@/services/skill-execution-log';
import { generateId } from '@/lib/id-generator';
import { updateContextWindowFromError, isContextOverflowError } from '@/lib/context-window-updater';

import { logger, LOG_MODULES } from '@/lib/logger';

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
  duration: number;
}

export interface EnhancedEvaluationConfig {
  modelConfigId?: string;  // ModelConfig ID，用于自动更新 contextWindow
  providerType: 'claude' | 'openai';  // 数据库中只存储这两种类型
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  cwd?: string;
  // SDK 高级配置
  mcpServers?: AppMcpServerConfig[];
  toolPermissions?: ToolPermissionRule[];
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  settingSources?: ('project' | 'user' | 'local')[];
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
  allowDangerouslySkipPermissions?: boolean;
  resumeSession?: string;
  temperature?: number;  // 模型温度，默认 0.3
  contextWindow?: number;  // 模型的 context window 大小，用于 autoCompactWindow
  workflowNodeId?: string;  // 工作流节点 ID，用于保存 session_id 到 NodeExecution 表
  allowedTools?: string[];  // 允许的工具列表（包含注册的 Skills）
  skills?: string[];  // Skills 配置（传递给子Agent）
  agents?: Record<string, AgentDefinition>;  // 子Agent定义（SDK官方推荐传递MCP/Skills的方式）
}

export interface EnhancedEvaluationCallbacks {
  onChunk: (text: string) => void;
  onThinking?: (thinking: string) => void;
  onToolCall: (toolUseId: string, name: string, parameters: Record<string, unknown>) => void;
  onToolResult: (toolUseId: string, content: unknown, isError?: boolean) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
  onNodeStatusChange?: (nodeId: string, status: string, nodeLabel?: string, nodeType?: string) => void;
  onUsage?: (usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    totalCostUsd?: number;
    modelUsage?: Record<string, {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
    }>;
  }) => void;
  onStopReason?: (data: { stopReason: string | null; terminalReason?: string }) => void;
  onCompaction?: (data: { trigger: string; summaryLength: number }) => void;
}

export interface WorkflowNode {
  id: string;
  type: string;
  label: string;
  order: number;
}

/**
 * 增强版评估调用器
 * 使用 Claude Agent SDK，支持工具调用和工作目录
 * 
 * 消息管理策略：
 * - 不在评估过程中保存消息到数据库
 * - 依赖 Claude SDK 的会话管理（通过 resume 参数）
 * - 只在会话结束时保存结构化评估结果（漏洞统计等）
 */
export class EnhancedEvaluationCaller {
  private agentService: ClaudeAgentService;
  private currentEvaluationId: string | null = null;
  private currentProjectId: string | null = null;
  private currentWorkflowNodeId: string | null = null;  // 当前工作流节点 ID
  private currentSkillExecutionId: string | null = null;  // 当前 Skill 执行记录 ID
  private currentSkillId: string | null = null;  // 当前执行的 Skill ID
  private modelConfigId: string | null = null;  // ModelConfig ID，用于自动更新 contextWindow
  private aborted: boolean = false;  // 中止标志

  constructor(config: EnhancedEvaluationConfig) {
    logger.info(LOG_MODULES.EVALUATION, '初始化 EnhancedEvaluationCaller');
    logger.info(LOG_MODULES.EVALUATION, `Provider类型: ${config.providerType}`);
    logger.info(LOG_MODULES.EVALUATION, `模型: ${config.model}`);
    logger.info(LOG_MODULES.EVALUATION, `工作目录: ${config.cwd || '未设置'}`);
    logger.info(LOG_MODULES.EVALUATION, `系统提示词类型: ${typeof config.systemPrompt}`);

    logger.info(LOG_MODULES.EVALUATION, `config.mcpServers=${config.mcpServers?.length || 0}个`);
    if (config.mcpServers && config.mcpServers.length > 0) {
      logger.info(LOG_MODULES.EVALUATION, `MCP服务器=${config.mcpServers.map(s => s.name).join(', ')}`);
      logger.info(LOG_MODULES.EVALUATION, `第一个MCP详情=${JSON.stringify(config.mcpServers[0])}`);
    } else {
      logger.warn(LOG_MODULES.EVALUATION, 'config.mcpServers 为空！');
    }
    
    // 设置 workflowNodeId（用于保存 session_id 到 NodeExecution 表）
    this.currentWorkflowNodeId = config.workflowNodeId || null;
    
    // 保存 modelConfigId（用于自动更新 contextWindow）
    this.modelConfigId = config.modelConfigId || null;
    
    // 确定 baseUrl
    let agentBaseUrl: string | undefined;
    let agentApiKey = config.apiKey;

    // 直接使用配置的 baseUrl，不再使用内部 claude-proxy
    agentBaseUrl = config.baseUrl;

    this.agentService = createClaudeAgentService({
      apiKey: agentApiKey,
      model: config.model,
      maxTokens: config.maxTokens,
      cwd: config.cwd,
      baseUrl: agentBaseUrl,
      allowedTools: config.allowedTools || ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash', 'Skill'],
      mcpServers: config.mcpServers,
      toolPermissions: config.toolPermissions,
      systemPrompt: config.systemPrompt,
      settingSources: config.settingSources,
      permissionMode: config.permissionMode,
      allowDangerouslySkipPermissions: config.allowDangerouslySkipPermissions,
      resumeSession: config.resumeSession,
      temperature: config.temperature ?? 0.7,  // 传递温度参数
      contextWindow: config.contextWindow,  // 传递 context window 用于 SDK Compaction
      skills: config.skills,  // Skills 配置
      agents: config.agents,  // 子Agent定义（SDK官方推荐方式）
    });
    logger.info(LOG_MODULES.EVALUATION, 'ClaudeAgentService 初始化完成');
    logger.info(LOG_MODULES.EVALUATION, `Base URL: ${agentBaseUrl}`);
    logger.info(LOG_MODULES.EVALUATION, `权限模式: ${config.permissionMode}`);
    logger.info(LOG_MODULES.EVALUATION, `允许跳过权限: ${config.allowDangerouslySkipPermissions}`);
    logger.info(LOG_MODULES.EVALUATION, `allowedTools: ${config.allowedTools?.length || 8} tools`);
  }

  /**
   * 设置工作目录
   */
  setWorkingDirectory(dir: string): void {
    this.agentService.setWorkingDirectory(dir);
  }

  /**
   * 获取工作目录
   */
  getWorkingDirectory(): string | undefined {
    return this.agentService.getWorkingDirectory();
  }

  /**
   * 启动评估
   */
  async startEvaluation(
    evaluationId: string,
    projectId: string,
    context: {
      projectName: string;
      projectDescription?: string;
      environmentUrl?: string;
      files: Array<{ name: string; type: string; size: number }>;
      taskDescription?: string | null;
      initialMessage?: string | null;
      workflowName?: string | null;
    },
    callbacks: EnhancedEvaluationCallbacks
  ): Promise<void> {
    this.currentEvaluationId = evaluationId;
    this.currentProjectId = projectId;

    // 构建提示消息
    const promptParts: string[] = [];

    if (context.initialMessage) {
      promptParts.push(context.initialMessage);
    }

    if (context.taskDescription) {
      promptParts.push(context.taskDescription);
    }

    const agentCallbacks: ClaudeAgentCallbacks = {
      onChunk: (text) => {
        // 记录活动到 Watchdog
        if (this.currentEvaluationId) {
          recordWatchdogActivity(this.currentEvaluationId, 'message');
        }
        callbacks.onChunk(text);
      },
      onThinking: (thinking) => {
        // 扩展思考回调
        if (callbacks.onThinking) {
          callbacks.onThinking(thinking);
        }
      },
      onToolUse: async (id, name, input) => {
        // 记录活动到 Watchdog
        if (this.currentEvaluationId) {
          recordWatchdogActivity(this.currentEvaluationId, 'tool_call', { name, toolUseId: id });
        }
        
        // 检测 Skill 工具调用，创建执行记录并更新统计
        if (name === 'Skill' && this.currentEvaluationId) {
          // 支持多种参数格式: skill, skill_name, skill_id, name
          const skillName = (input as any)?.skill || (input as any)?.skill_name || (input as any)?.skill_id || (input as any)?.name;
          if (skillName) {
            logger.info(LOG_MODULES.EVALUATION, `检测到 Skill 调用: ${skillName}`);
            try {
              // 查找 Skill ID
              const skill = await prisma.skill.findFirst({
                where: { name: skillName, isLatest: true },
                select: { id: true },
              });
              
              if (skill) {
                // 创建执行记录
                const executionId = `sklexec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                await prisma.skillExecution.create({
                  data: {
                    id: executionId,
                    skillId: skill.id,
                    projectId: this.currentProjectId || '',
                    evaluationId: this.currentEvaluationId,
                    input: JSON.stringify(input),
                    status: 'running',
                    startedAt: new Date(),
                  },
                });
                
                // 更新 Skill 的 execCount（实际执行时才统计）
                await prisma.skill.update({
                  where: { id: skill.id },
                  data: {
                    execCount: { increment: 1 },
                    updatedAt: new Date(),
                  },
                });
                
                this.currentSkillExecutionId = executionId;
                this.currentSkillId = skill.id;

                // 更新 skill-execution-log.json 文件
                const projectPath = this.getWorkingDirectory();
                if (projectPath) {
                  await updateSkillExecutionLog(projectPath, skill.id, 'running');
                }

                logger.info(LOG_MODULES.EVALUATION, `Skill 执行记录已创建: ${skillName}, executionId=${executionId}`);
              }
            } catch (error) {
              logger.error(LOG_MODULES.EVALUATION, '记录 Skill 执行失败', { error: error instanceof Error ? error.message : String(error) });
            }
          }
        }
        
        callbacks.onToolCall(id, name, input);
      },
      onToolResult: async (toolUseId, content, isError) => {
        // 检测 Skill 工具结果，更新执行状态
        if (this.currentSkillExecutionId && this.currentSkillId) {
          try {
            // 解析结果中的漏洞数量
            const resultStr = typeof content === 'string' ? content : JSON.stringify(content);
            const findingsMatch = resultStr.match(/发现\s*(\d+)\s*个|found\s*(\d+)\s*vulnerabilit/i);
            const findingsCount = findingsMatch ? (parseInt(findingsMatch[1]) || parseInt(findingsMatch[2]) || 0) : 0;
            
            await completeSkillExecution({
              executionId: this.currentSkillExecutionId,
              skillId: this.currentSkillId,
              output: resultStr,
              findingsCount,
            });
            
            // 更新 skill-execution-log.json 文件
            const projectPath = this.getWorkingDirectory();
            if (projectPath) {
              await updateSkillExecutionLog(projectPath, this.currentSkillId, 'completed', findingsCount);
            }

            logger.info(LOG_MODULES.EVALUATION, `Skill 执行完成: findings=${findingsCount}`);
          } catch (error) {
            logger.error(LOG_MODULES.EVALUATION, '更新 Skill 执行状态失败', { error: error instanceof Error ? error.message : String(error) });
          } finally {
            this.currentSkillExecutionId = null;
            this.currentSkillId = null;
          }
        }
        
        callbacks.onToolResult(toolUseId, content, isError || false);
      },
      onUsage: (usage) => {
        // 记录 Token 活动到 Watchdog
        if (this.currentEvaluationId) {
          recordWatchdogActivity(this.currentEvaluationId, 'token', { 
            tokens: usage.inputTokens + usage.outputTokens 
          });
        }
        // Token 使用量回调
        logger.info(LOG_MODULES.EVALUATION, '收到 Token 使用量', { details: { usage } });
        callbacks.onUsage?.(usage);
      },
      onComplete: async (fullResponse) => {
        // 日志：单次迭代完成
        logger.info(LOG_MODULES.EVALUATION,'========================================');
        logger.info(LOG_MODULES.EVALUATION,'单次迭代完成');
        logger.info(LOG_MODULES.EVALUATION,`评估ID: ${this.currentEvaluationId}`);
        logger.info(LOG_MODULES.EVALUATION,`项目ID: ${this.currentProjectId}`);
        logger.info(LOG_MODULES.EVALUATION,`响应长度: ${fullResponse.length} 字符`);
        logger.info(LOG_MODULES.EVALUATION,`响应预览: ${fullResponse.substring(0, 500)}...`);
        logger.info(LOG_MODULES.EVALUATION,'========================================');

        // 会话结束时才保存数据
        if (this.currentEvaluationId && this.currentProjectId && fullResponse.trim()) {
          // 解析并保存分析报告
          logger.info(LOG_MODULES.EVALUATION,'开始解析分析报告...');
          try {
            const analysisData = parseAnalysisFromOutput(fullResponse);
            if (analysisData) {
              await updateAnalysisReport({
                evaluationId: this.currentEvaluationId,
                data: {
                  projectName: analysisData.projectOverview?.projectName,
                  description: analysisData.projectOverview?.description,
                  techStack: analysisData.projectOverview?.techStack,
                  projectType: analysisData.architecture?.projectType,
                  frontend: analysisData.architecture?.frontend,
                  backend: analysisData.architecture?.backend,
                  database: analysisData.architecture?.database,
                  directoryStructure: analysisData.architecture?.directoryStructure,
                  architectureSummary: analysisData.architecture?.summary,
                  apiEndpoints: analysisData.entryPoints?.apiEndpoints,
                  pageEntries: analysisData.entryPoints?.pageEntries,
                  userInputPoints: analysisData.entryPoints?.userInputPoints,
                  entryPointsSummary: analysisData.entryPoints?.summary,
                  authType: analysisData.authentication?.authType,
                  tokenStorage: analysisData.authentication?.tokenStorage,
                  tokenExpiry: analysisData.authentication?.tokenExpiry,
                  refreshMechanism: analysisData.authentication?.refreshMechanism,
                  authzModel: analysisData.authentication?.authzModel,
                  roles: analysisData.authentication?.roles,
                  sessionManagement: analysisData.authentication?.sessionManagement,
                  securityConfig: analysisData.authentication?.securityConfig,
                  authSummary: analysisData.authentication?.summary,
                  rawContent: fullResponse,
                },
              });
              logger.info(LOG_MODULES.EVALUATION,'分析报告保存成功');
            } else {
              logger.warn(LOG_MODULES.EVALUATION,'未从输出中解析到分析报告');
            }
          } catch (analysisError) {
            logger.error(LOG_MODULES.EVALUATION, '解析保存分析报告时发生异常', { details: { error: analysisError instanceof Error ? analysisError.message : String(analysisError) } });
          }
          
          // 漏洞入库流程已改为从 vulnerabilities.json 文件解析
          // 此处不再从 AI 响应文本中提取漏洞，避免误提取
          // 正确的漏洞入库路径：unified-execution-engine.ts 的 parseAndSaveVulnerabilities
          // logInfo('开始解析并保存漏洞结果...');
          // try {
          //   const result = await parseAndSaveResults(this.currentEvaluationId, this.currentProjectId, fullResponse);
          //   if (result.success) {
          //     logSuccess(`漏洞入库成功: ${result.vulnCount} 个`);
          //   } else {
          //     logWarn(`漏洞入库失败: ${result.error}`);
          //   }
          // } catch (parseError) {
          //   logError('解析保存结果时发生异常:', parseError);
          // }
        } else {
          logger.warn(LOG_MODULES.EVALUATION,'跳过漏洞解析: 评估ID、项目ID或响应为空');
        }
        callbacks.onComplete(fullResponse);
      },
      onError: (error: Error) => {
        // 自动学习：如果是 context 超限错误，尝试更新数据库
        if (this.modelConfigId && isContextOverflowError(error)) {
          logger.info(LOG_MODULES.EVALUATION,'检测到 context 超限错误，尝试自动学习 contextWindow');
          updateContextWindowFromError(this.modelConfigId, error).then((updated) => {
            if (updated) {
              logger.info(LOG_MODULES.EVALUATION,`contextWindow 已自动更新为 ${updated}`);
            }
          }).catch((e) => {
            logger.warn(LOG_MODULES.EVALUATION,'自动更新 contextWindow 失败:', e);
          });
        }
        callbacks.onError(error);
      },
      onSessionId: async (sessionId) => {
        logger.info(LOG_MODULES.EVALUATION, '捕获 SDK 会话 ID', { details: { sessionId, currentEvaluationId: this.currentEvaluationId, currentWorkflowNodeId: this.currentWorkflowNodeId } });
        
        // 优先保存到 NodeExecution 表（如果提供了 workflowNodeId）
        if (this.currentEvaluationId && this.currentWorkflowNodeId) {
          try {
            // 使用 upsert：如果记录存在则更新，否则创建新记录
            await prisma.nodeExecution.upsert({
              where: {
                evaluationSessionId_workflowNodeId: {
                  evaluationSessionId: this.currentEvaluationId,
                  workflowNodeId: this.currentWorkflowNodeId,
                },
              },
              update: {
                opencodeSessionId: sessionId,
                updatedAt: new Date(),
              },
              create: {
                id: generateId('nodeexec'),
                evaluationSessionId: this.currentEvaluationId,
                workflowNodeId: this.currentWorkflowNodeId,
                nodeLabel: this.currentWorkflowNodeId,  // 临时使用 ID 作为 label
                nodeType: 'task',
                status: 'running',
                startedAt: new Date(),  // 添加：节点启动时间
                opencodeSessionId: sessionId,
                updatedAt: new Date(),
              },
            });
            logger.info(LOG_MODULES.EVALUATION, 'opencodeSessionId 已保存到 NodeExecution 表');
          } catch (e) {
            logger.error(LOG_MODULES.EVALUATION, '保存到 NodeExecution 失败', { details: { error: e instanceof Error ? e.message : String(e) } });
          }
          return;
        }
        
        // 如果没有 workflowNodeId，尝试保存到 EvaluationSession 表
        if (this.currentEvaluationId) {
          // 检查是否是拼接的临时 ID（节点级 ID 格式: eval-xxx-node-0）
          if (this.currentEvaluationId.includes('-node-')) {
            logger.info(LOG_MODULES.EVALUATION, '跳过保存: 当前为节点级临时 ID，且未提供 workflowNodeId');
            return;
          }
          
          try {
            await prisma.evaluationSession.update({
              where: { id: this.currentEvaluationId },
              data: { opencodeSessionId: sessionId },
            });
            logger.info(LOG_MODULES.EVALUATION, 'opencodeSessionId 已保存到 EvaluationSession 表');
          } catch (e) {
            logger.error(LOG_MODULES.EVALUATION, '保存到 EvaluationSession 失败', { details: { error: e instanceof Error ? e.message : String(e) } });
          }
        }
      },
    };

    try {
      if (promptParts.length > 0) {
        const prompt = promptParts.join('\n\n---\n\n');

        // 日志：发送给 Claude 的完整信息
        await this.agentService.sendPrompt(prompt, agentCallbacks);
      }
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 中止评估
   */
  abort(): void {
    this.aborted = true;
    this.agentService.abort();
  }

  /**
   * 检查是否已中止
   */
  isAborted(): boolean {
    return this.aborted;
  }
}

/**
 * 创建增强评估调用器的工厂方法
 *
 * Claude 类型：直接连接 Claude API
 * OpenAI 类型：连接内部 CCR 代理，由 CCR 路由到目标 Provider
 */
export function createEnhancedEvaluationCaller(
  modelConfig: {
    id?: string;  // ModelConfig ID，用于自动更新 contextWindow
    providerType: string;
    apiKey: string;
    apiBaseUrl: string;
    models: string;  // 可以是 JSON 数组字符串或单个模型名称
    contextWindow?: number;  // 模型的 context window
  },
  workingDirectory?: string,
  sdkOptions?: {
    mcpServers?: AppMcpServerConfig[];
    toolPermissions?: ToolPermissionRule[];
    systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
    settingSources?: ('project' | 'user' | 'local')[];
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
    allowDangerouslySkipPermissions?: boolean;
    resumeSession?: string;
    workflowNodeId?: string;  // 工作流节点 ID，用于保存 session_id
  }
): EnhancedEvaluationCaller {
  // 支持两种格式：JSON 数组或单个字符串
  let model: string;
  try {
    const parsed = JSON.parse(modelConfig.models);
    model = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    // 如果不是 JSON，直接作为模型名称使用
    model = modelConfig.models;
  }
  
  if (!model) {
    throw new Error(`模型配置的 models 字段为空，必须配置至少一个模型。`);
  }

  const providerType: 'claude' | 'openai' =
    modelConfig.providerType === 'claude' ? 'claude' : 'openai';

  logger.info(LOG_MODULES.EVALUATION, `providerType: ${providerType}, model: ${model}, apiBaseUrl: ${modelConfig.apiBaseUrl}`);

  const caller = new EnhancedEvaluationCaller({
    modelConfigId: modelConfig.id,  // 传递 ModelConfig ID 用于自动更新 contextWindow
    providerType,
    apiKey: modelConfig.apiKey,
    baseUrl: modelConfig.apiBaseUrl || undefined,
    model,
    cwd: workingDirectory,
    contextWindow: modelConfig.contextWindow,  // 传递 contextWindow
    // SDK 高级配置
    mcpServers: sdkOptions?.mcpServers,
    toolPermissions: sdkOptions?.toolPermissions,
    systemPrompt: sdkOptions?.systemPrompt,
    settingSources: sdkOptions?.settingSources,
    permissionMode: sdkOptions?.permissionMode,
    allowDangerouslySkipPermissions: sdkOptions?.allowDangerouslySkipPermissions,
    resumeSession: sdkOptions?.resumeSession,
    workflowNodeId: sdkOptions?.workflowNodeId,
  });

  if (workingDirectory) {
    caller.setWorkingDirectory(workingDirectory);
  }

  return caller;
}
