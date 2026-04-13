// src/services/evaluation/enhanced-caller.ts

import { ClaudeAgentService, ClaudeAgentCallbacks, createClaudeAgentService, AppMcpServerConfig, ToolPermissionRule } from '@/services/ai';
import { parseAndSaveResults } from './result-parser';
import { prisma } from '@/lib/prisma';

// ============================================
// 日志工具
// ============================================

const LOG_PREFIX = '[EnhancedCaller]';

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

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
  duration: number;
}

export interface EnhancedEvaluationConfig {
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
}

export interface EnhancedEvaluationCallbacks {
  onChunk: (text: string) => void;
  onToolCall: (name: string, parameters: Record<string, unknown>) => void;
  onToolResult: (name: string, result: ToolResult) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
  onNodeStatusChange?: (nodeId: string, status: string, nodeLabel?: string, nodeType?: string) => void;
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

  constructor(config: EnhancedEvaluationConfig) {
    // 日志：记录从路由/配置加载的系统提示词配置
    logInfo('初始化 EnhancedEvaluationCaller');
    logInfo(`Provider类型: ${config.providerType}`);
    logInfo(`模型: ${config.model}`);
    logInfo(`工作目录: ${config.cwd || '未设置'}`);
    logInfo(`系统提示词类型: ${typeof config.systemPrompt}`);
    
    // 确定 baseUrl
    let agentBaseUrl: string | undefined;
    let agentApiKey = config.apiKey;

    if (config.providerType === 'openai') {
      // OpenAI 类型：连接内部 CCR 代理
      if (typeof window === 'undefined') {
        agentBaseUrl = process.env.NEXT_PUBLIC_APP_URL
          ? `${process.env.NEXT_PUBLIC_APP_URL}/api/claude-proxy`
          : 'http://localhost:3000/api/claude-proxy';
      } else {
        agentBaseUrl = '/api/claude-proxy';
      }
    } else {
      agentBaseUrl = config.baseUrl;
    }

    this.agentService = createClaudeAgentService({
      apiKey: agentApiKey,
      model: config.model,
      maxTokens: config.maxTokens,
      cwd: config.cwd,
      baseUrl: agentBaseUrl,
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash'],
      mcpServers: config.mcpServers,
      toolPermissions: config.toolPermissions,
      systemPrompt: config.systemPrompt,
      settingSources: config.settingSources,
      permissionMode: config.permissionMode,
      allowDangerouslySkipPermissions: config.allowDangerouslySkipPermissions,
      resumeSession: config.resumeSession,
    });
    logInfo(`ClaudeAgentService 初始化完成`);
    logInfo(`Base URL: ${agentBaseUrl}`);
    logInfo(`权限模式: ${config.permissionMode}`);
    logInfo(`允许跳过权限: ${config.allowDangerouslySkipPermissions}`);
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
      onChunk: callbacks.onChunk,
      onToolUse: (name, input) => {
        callbacks.onToolCall(name, input);
      },
      onToolResult: (name, result) => {
        const toolResult: ToolResult = {
          success: true,
          output: result,
          duration: 0,
        };
        callbacks.onToolResult(name, toolResult);
      },
      onComplete: async (fullResponse) => {
        // 日志：单次迭代完成
        logInfo('========================================');
        logInfo('单次迭代完成');
        logInfo(`评估ID: ${this.currentEvaluationId}`);
        logInfo(`项目ID: ${this.currentProjectId}`);
        logInfo(`响应长度: ${fullResponse.length} 字符`);
        logInfo(`响应预览: ${fullResponse.substring(0, 500)}...`);
        logInfo('========================================');

        // 会话结束时才保存数据
        if (this.currentEvaluationId && this.currentProjectId && fullResponse.trim()) {
          logInfo('开始解析并保存漏洞结果...');
          try {
            const result = await parseAndSaveResults(this.currentEvaluationId, this.currentProjectId, fullResponse);
            if (result.success) {
              logSuccess(`漏洞入库成功: ${result.vulnCount} 个`);
            } else {
              logWarn(`漏洞入库失败: ${result.error}`);
            }
          } catch (parseError) {
            logError('解析保存结果时发生异常:', parseError);
          }
        } else {
          logWarn('跳过漏洞解析: 评估ID、项目ID或响应为空');
        }
        callbacks.onComplete(fullResponse);
      },
      onError: callbacks.onError,
      onSessionId: async (sessionId) => {
        console.log('[Evaluation] 捕获 SDK 会话 ID:', sessionId);
        if (this.currentEvaluationId) {
          try {
            await prisma.evaluationSession.update({
              where: { id: this.currentEvaluationId },
              data: { opencodeSessionId: sessionId },
            });
          } catch (e) {
            console.error('[Evaluation] 保存 opencodeSessionId 失败:', e);
          }
        }
      },
    };

    try {
      if (promptParts.length > 0) {
        const prompt = promptParts.join('\n\n---\n\n');

        // 日志：发送给 Claude 的完整信息
        console.log('[EnhancedEvaluationCaller] ========================================');
        console.log('[EnhancedEvaluationCaller] 启动评估 - 发送给 Claude 的信息:');
        console.log('[EnhancedEvaluationCaller] - 项目名称:', context.projectName);
        console.log('[EnhancedEvaluationCaller] - 项目描述:', context.projectDescription || '无');
        console.log('[EnhancedEvaluationCaller] - 环境URL:', context.environmentUrl || '无');
        console.log('[EnhancedEvaluationCaller] - 文件数:', context.files?.length || 0);
        console.log('[EnhancedEvaluationCaller] - 工作流名称:', context.workflowName || '无');
        console.log('[EnhancedEvaluationCaller] ----------------------------------------');
        console.log('[EnhancedEvaluationCaller] - 任务描述:', context.taskDescription?.substring(0, 200) || '无');
        console.log('[EnhancedEvaluationCaller] ----------------------------------------');
        console.log('[EnhancedEvaluationCaller] - 初始消息(用户提示词):', context.initialMessage?.substring(0, 300) || '无');
        console.log('[EnhancedEvaluationCaller] ----------------------------------------');
        console.log('[EnhancedEvaluationCaller] - 最终拼接的 prompt:', prompt.substring(0, 500) + '...');
        console.log('[EnhancedEvaluationCaller] ========================================');

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
    this.agentService.abort();
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
    providerType: string;
    apiKey: string;
    apiBaseUrl: string;
    models: string;  // 可以是 JSON 数组字符串或单个模型名称
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
  }
): EnhancedEvaluationCaller {
  // 支持两种格式：JSON 数组或单个字符串
  let model: string;
  try {
    const parsed = JSON.parse(modelConfig.models);
    model = Array.isArray(parsed) ? (parsed[0] || 'claude-sonnet-4-20250514') : parsed;
  } catch {
    // 如果不是 JSON，直接作为模型名称使用
    model = modelConfig.models || 'claude-sonnet-4-20250514';
  }

  const providerType: 'claude' | 'openai' =
    modelConfig.providerType === 'claude' ? 'claude' : 'openai';

  console.log(`[createEnhancedEvaluationCaller] providerType: ${providerType}, model: ${model}, apiBaseUrl: ${modelConfig.apiBaseUrl}`);

  const caller = new EnhancedEvaluationCaller({
    providerType,
    apiKey: modelConfig.apiKey,
    baseUrl: modelConfig.apiBaseUrl || undefined,
    model,
    cwd: workingDirectory,
    // SDK 高级配置
    mcpServers: sdkOptions?.mcpServers,
    toolPermissions: sdkOptions?.toolPermissions,
    systemPrompt: sdkOptions?.systemPrompt,
    settingSources: sdkOptions?.settingSources,
    permissionMode: sdkOptions?.permissionMode,
    allowDangerouslySkipPermissions: sdkOptions?.allowDangerouslySkipPermissions,
    resumeSession: sdkOptions?.resumeSession,
  });

  if (workingDirectory) {
    caller.setWorkingDirectory(workingDirectory);
  }

  return caller;
}
