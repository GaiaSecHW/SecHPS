/**
 * 简化的模型调用服务
 * 
 * 支持两种类型：
 * - openai: 使用 http://xxx/v1/chat/completions
 * - claude: 使用 http://xxx/v1/messages
 * 
 * 功能：
 * - 统一模型调用接口
 * - 自动 Token 统计
 * - 支持用户上下文
 * - 支持超时控制
 * - 自动裁剪历史消息（避免 token 超限）
 */

import { prisma } from '@/lib/prisma';
import type { TokenUsageContext, CallScene } from '@/types/call-scene';
import { Agent, setGlobalDispatcher } from 'undici';
import { logger, LOG_MODULES } from '@/lib/logger';

// 设置全局 undici agent，延长 headers/body timeout 以支持长时间请求
setGlobalDispatcher(new Agent({
  headersTimeout: 7200000,
  bodyTimeout: 7200000,
  keepAliveTimeout: 7200000,
  keepAliveMaxTimeout: 7200000,
}));

logger.info(LOG_MODULES.MODEL, 'Undici agent configured: headersTimeout=7200000ms, bodyTimeout=7200000ms');

// ============================================================================
// Token 裁剪配置
// ============================================================================

/** 默认 context window 大小 */
export const DEFAULT_CONTEXT_WINDOW = 163804;

/** 模型 context window 配置表 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'MiniMax-M2.5': 163804,
  'MiniMax-M2.5-highspeed': 163804,
  'MiniMax-M2.7': 204800,
  'MiniMax-M2': 204800,
  'claude-3-5-sonnet': 200000,
  'claude-3-7-sonnet': 200000,
  'gpt-4o': 128000,
  'gpt-4-turbo': 128000,
  'deepseek-v3': 163840,
};

/**
 * 简化的 token 估算（不使用 tiktoken，仅估算）
 * 规则：平均 1 token ≈ 4 字符
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * 估算消息列表的 token 数
 */
function estimateMessagesTokens(messages: Array<{ role: string; content: string | any[] }>): number {
  let total = 0;
  for (const message of messages) {
    total += 4; // 消息格式开销
    const content = message.content;
    if (typeof content === 'string') {
      total += estimateTokens(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'text' && part.text) {
          total += estimateTokens(part.text);
        }
      }
    }
  }
  return total;
}

/**
 * 获取模型的 context window 大小
 */
export function getModelContextWindow(model: string): number {
  const modelName = model.split('/').pop() || model;
  for (const [key, window] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (modelName.toLowerCase().includes(key.toLowerCase())) {
      return window;
    }
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * 裁剪历史消息（保留最近的对话）
 * 
 * @param messages 原始消息列表
 * @param options 裁剪选项
 * @returns 裁剪后的消息列表
 */
export function trimMessages(
  messages: Array<{ role: string; content: string | any[] }>,
  options: {
    model?: string;
    maxTokens?: number;
    contextWindow?: number;
    trimRatio?: number;
    preserveSystem?: boolean;
    minMessages?: number;
  } = {}
): Array<{ role: string; content: string | any[] }> {
  const {
    model,
    maxTokens = 8000,
    contextWindow,
    trimRatio = 0.75,
    preserveSystem = true,
    minMessages = 2,
  } = options;
  
  const windowSize = contextWindow || (model ? getModelContextWindow(model) : DEFAULT_CONTEXT_WINDOW);
  const maxInputTokens = Math.floor((windowSize - maxTokens) * trimRatio);
  
  // 分离 system 和其他消息
  const systemMessages: Array<{ role: string; content: string | any[] }> = [];
  const otherMessages: Array<{ role: string; content: string | any[] }> = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg);
    } else {
      otherMessages.push(msg);
    }
  }
  
  const systemTokens = estimateMessagesTokens(systemMessages);
  const availableForHistory = maxInputTokens - systemTokens;
  
  if (availableForHistory <= 0) {
    logger.warn(LOG_MODULES.MODEL, `System prompt too large (${systemTokens} tokens)`);
    return preserveSystem ? systemMessages : [];
  }
  
  // 从最新消息开始保留
  const trimmedHistory: Array<{ role: string; content: string | any[] }> = [];
  let currentTokens = 0;
  
  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const msg = otherMessages[i];
    const msgTokens = estimateMessagesTokens([msg]);
    
    if (currentTokens + msgTokens <= availableForHistory) {
      trimmedHistory.unshift(msg);
      currentTokens += msgTokens;
    } else {
      break;
    }
  }
  
  // 确保最少保留 minMessages 条
  if (trimmedHistory.length < minMessages && otherMessages.length >= minMessages) {
    const forcedMessages = otherMessages.slice(-minMessages);
    trimmedHistory.length = 0;
    trimmedHistory.push(...forcedMessages);
    logger.warn(LOG_MODULES.MODEL, `Force keeping ${minMessages} messages`);
  }

  const result = preserveSystem ? [...systemMessages, ...trimmedHistory] : trimmedHistory;

  logger.info(LOG_MODULES.MODEL, `${messages.length} -> ${result.length} messages, ~${estimateMessagesTokens(result)} tokens`);

  return result;
}

/**
 * 动态计算安全的 max_tokens
 */
export function calculateSafeMaxTokens(
  messages: Array<{ role: string; content: string | any[] }>,
  model: string,
  options: {
    contextWindow?: number;
    bufferTokens?: number;
    minOutputTokens?: number;
    maxOutputTokens?: number;
  } = {}
): number {
  const {
    contextWindow,
    bufferTokens = 1000,
    minOutputTokens = 4096,
    maxOutputTokens = 32000,
  } = options;
  
  const windowSize = contextWindow || getModelContextWindow(model);
  const inputTokens = estimateMessagesTokens(messages);
  const available = windowSize - inputTokens - bufferTokens;
  
  if (available < minOutputTokens) {
    logger.warn(LOG_MODULES.MODEL, `Input large (${inputTokens} tokens), using minimum`);
    return minOutputTokens;
  }
  
  return Math.min(available, maxOutputTokens);
}

// ============================================================================
// 超时常量配置
// ============================================================================

/** 统一超时时间：2小时（Skill 进化等长时间任务） */
export const DEFAULT_TIMEOUT_MS = 7200000;
/** 长时间任务超时：2小时 */
export const LONG_TIMEOUT_MS = 7200000;
/** 连接测试超时：30秒（仅用于 testModelConnection） */
export const TEST_TIMEOUT_MS = 30000;

// ============================================================================
// 错误类型
// ============================================================================
export class RouteError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

// 模型配置接口
interface ModelConfig {
  id: string;
  name: string;
  providerType: 'openai' | 'claude';
  apiBaseUrl: string;
  apiKey: string;
  models: string[];
  maxTokens: number;
  temperature: number;
  isActive: boolean;
}

/**
 * 从数据库获取模型配置
 */
async function getModelConfig(modelId: string): Promise<ModelConfig | null> {
  const config = await prisma.modelConfig.findUnique({
    where: { id: modelId, isActive: true },
  });

  if (!config) return null;

  return {
    id: config.id,
    name: config.name,
    providerType: config.providerType as 'openai' | 'claude',
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey || '',
    models: Array.isArray(config.models) ? config.models : JSON.parse(config.models || '[]'),
    maxTokens: config.maxTokens ?? 32000,
    temperature: config.temperature ?? 0.3,
    isActive: config.isActive,
  };
}

/**
 * 根据模型名称查找配置
 */
async function findModelByName(modelName: string): Promise<ModelConfig | null> {
  // 支持格式: "provider/model" 或直接模型名
  const configs = await prisma.modelConfig.findMany({
    where: { isActive: true },
  });

  for (const config of configs) {
    const models = Array.isArray(config.models) ? config.models : JSON.parse(config.models || '[]');
    if (models.includes(modelName)) {
      return {
        id: config.id,
        name: config.name,
        providerType: config.providerType as 'openai' | 'claude',
        apiBaseUrl: config.apiBaseUrl,
        apiKey: config.apiKey || '',
        models,
        maxTokens: config.maxTokens ?? 32000,
        temperature: config.temperature ?? 0.3,
        isActive: config.isActive,
      };
    }
  }

  return null;
}

/**
 * 获取默认模型配置
 * 用于不需要指定模型名称的 API 调用
 */
export async function getDefaultModelConfig(): Promise<ModelConfig | null> {
  const config = await prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });

  if (!config) return null;

  const models = Array.isArray(config.models) 
    ? config.models 
    : JSON.parse(config.models || '[]');

  return {
    id: config.id,
    name: config.name,
    providerType: config.providerType as 'openai' | 'claude',
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey || '',
    models,
    maxTokens: config.maxTokens ?? 32000,
    temperature: config.temperature ?? 0.3,
    isActive: config.isActive,
  };
}

/**
 * 默认模型配置的返回类型
 */
export interface DefaultModelInfo {
  providerType: 'openai' | 'claude';
  apiKey: string;
  apiBaseUrl: string;
  defaultModel: string;
  maxTokens: number;
  temperature: number;
}

/**
 * 获取默认模型信息（简化版）
 * 兼容现有 API 路由的 getModelConfig() 返回格式
 */
export async function getDefaultModelInfo(): Promise<DefaultModelInfo | null> {
  const config = await getDefaultModelConfig();
  if (!config) return null;
 
  return {
    providerType: config.providerType,
    apiKey: config.apiKey,
    apiBaseUrl: config.apiBaseUrl,
    defaultModel: config.models[0] || 'default',
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  };
}

/**
 * 从 API 响应中提取 Token 使用量
 */
function extractTokenUsage(response: any): { inputTokens: number; outputTokens: number } | null {
  try {
    if (!response || !response.usage) {
      return null;
    }
    
    const usage = response.usage;
    
    // Claude API 格式：input_tokens, output_tokens
    if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
      return {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
      };
    }
    
    // OpenAI 格式：prompt_tokens, completion_tokens
    if (usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined) {
      return {
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
      };
    }
    
    // 嵌套在 choices 中
    if (response.choices?.[0]?.usage) {
      const choiceUsage = response.choices[0].usage;
      if (choiceUsage.prompt_tokens !== undefined || choiceUsage.completion_tokens !== undefined) {
        return {
          inputTokens: choiceUsage.prompt_tokens || 0,
          outputTokens: choiceUsage.completion_tokens || 0,
        };
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * 计算费用（人民币）
 * 使用统一的定价：输入 ¥6/百万，输出 ¥22/百万
 */
function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * 6;
  const outputCost = (outputTokens / 1_000_000) * 22;
  return inputCost + outputCost;
}

/**
 * 记录 Token 使用到数据库
 */
async function recordTokenUsage(
  context: TokenUsageContext,
  model: string,
  providerType: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  try {
    const estimatedCost = calculateCost(inputTokens, outputTokens);
    
    await prisma.tokenUsage.create({
      data: {
        id: `token-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        userId: context.userId,
        username: context.username,
        evaluationId: context.evaluationId,
        projectId: context.projectId,
        apiProvider: providerType,
        modelName: model,
        callType: context.scene,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cachedTokens: 0,
        estimatedCost,
        status: 'success',
        requestStartedAt: new Date(),
        requestCompletedAt: new Date(),
      },
    });

    logger.info(LOG_MODULES.MODEL, `Token recorded: ${context.scene} | ${model} | ${inputTokens}+${outputTokens} | user=${context.userId}`);
  } catch (error) {
    logger.error(LOG_MODULES.MODEL, 'Failed to record token usage', { details: { error: error instanceof Error ? error.message : String(error) } });
  }
}

/**
 * 调用 OpenAI 格式的 API
 * URL: http://xxx/v1/chat/completions
 * 系统提示词：放在 messages 数组的第一个，role: "system"
 */
async function callOpenAI(config: ModelConfig, request: any, timeout: number = DEFAULT_TIMEOUT_MS): Promise<any> {
  const startTime = Date.now();
  let apiUrl = config.apiBaseUrl;

  // 如果 URL 以 # 结尾，不拼接路径，直接去掉 #
  if (apiUrl.endsWith('#')) {
    apiUrl = apiUrl.slice(0, -1);
  } else if (!apiUrl.includes('/chat/completions')) {
    // 确保 URL 正确
    apiUrl = apiUrl.replace(/\/$/, '');
    // 如果 URL 不包含 /v1，先添加 /v1
    if (!apiUrl.includes('/v1')) {
      apiUrl = `${apiUrl}/v1`;
    }
    apiUrl = `${apiUrl}/chat/completions`;
  }

  // OpenAI 格式：系统提示词放入 messages 数组
  let messages = request.messages || [];
  if (request.system) {
    logger.info(LOG_MODULES.MODEL, `OpenAI: 检测到系统提示词，长度: ${request.system.length} 字符`);
    messages = [
      { role: 'system', content: request.system },
      ...messages
    ];
    logger.info(LOG_MODULES.MODEL, 'OpenAI: 系统提示词已添加到 messages 数组开头');
  } else {
    logger.info(LOG_MODULES.MODEL, 'OpenAI: 未检测到系统提示词');
  }
  
  // 构建 OpenAI 请求体（不包含 system 字段）
  const openaiRequest = {
    model: request.model,
    messages,
    max_tokens: request.max_tokens,
    temperature: request.temperature,
    stream: request.stream,
    tools: request.tools,
    tool_choice: request.tool_choice,
  };

  // 详细日志：请求信息
  logger.info(LOG_MODULES.MODEL, '========== OpenAI API 调用 ==========');
  logger.info(LOG_MODULES.MODEL, `URL: ${apiUrl}`);
  logger.info(LOG_MODULES.MODEL, `Model: ${request.model || 'unknown'}`);
  logger.info(LOG_MODULES.MODEL, `API Key (前8位): ${config.apiKey?.substring(0, 8)}...`);
  logger.info(LOG_MODULES.MODEL, `Request body size: ${JSON.stringify(openaiRequest).length} bytes`);
  logger.info(LOG_MODULES.MODEL, `Messages count: ${messages.length}`);
  logger.info(LOG_MODULES.MODEL, `First message role: ${messages[0]?.role}`);
  logger.info(LOG_MODULES.MODEL, `First message content length: ${messages[0]?.content?.length || 0}`);
  logger.info(LOG_MODULES.MODEL, `Timeout: ${timeout}ms`);
  logger.info(LOG_MODULES.MODEL, '========================================');

  // 创建超时控制器
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(openaiRequest),
      signal: controller.signal,
    });

    logger.info(LOG_MODULES.MODEL, `OpenAI response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(LOG_MODULES.MODEL, `OpenAI API Error: ${response.status} ${errorText}`);
      throw new RouteError(
        `OpenAI API error: ${response.status} ${response.statusText}`,
        response.status,
        { error: errorText }
      );
    }

    return await response.json();
  } catch (error) {
    // 详细错误日志
    if (error instanceof Error) {
      logger.error(LOG_MODULES.MODEL, '========== OpenAI API 调用失败 ==========');
      logger.error(LOG_MODULES.MODEL, `Error name: ${error.name}`);
      logger.error(LOG_MODULES.MODEL, `Error message: ${error.message}`);
      logger.error(LOG_MODULES.MODEL, `URL: ${apiUrl}`);
      logger.error(LOG_MODULES.MODEL, `API Key (前8位): ${config.apiKey?.substring(0, 8)}...`);
      logger.error(LOG_MODULES.MODEL, '==============================================');
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new RouteError(`请求超时 (${timeout}ms)`, 408);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 调用 Claude 格式的 API
 * URL: http://xxx/v1/messages
 */
async function callClaude(config: ModelConfig, request: any, timeout: number = DEFAULT_TIMEOUT_MS): Promise<any> {
  const startTime = Date.now();
  let apiUrl = config.apiBaseUrl;
  
  // 如果 URL 以 # 结尾，不拼接路径，直接去掉 #
  if (apiUrl.endsWith('#')) {
    apiUrl = apiUrl.slice(0, -1);
  } else if (!apiUrl.includes('/v1/messages') && !apiUrl.includes('/messages')) {
    // 确保 URL 正确
    apiUrl = apiUrl.replace(/\/$/, '');
    if (apiUrl.includes('/chat/completions')) {
      // 从 OpenAI 格式转换
      const urlObj = new URL(apiUrl);
      apiUrl = `${urlObj.origin}/v1/messages`;
    } else {
      apiUrl = `${apiUrl}/v1/messages`;
    }
  }

  // 详细日志：请求信息
  logger.info(LOG_MODULES.MODEL, '========== Claude API 调用 ==========');
  logger.info(LOG_MODULES.MODEL, `URL: ${apiUrl}`);
  logger.info(LOG_MODULES.MODEL, `Model: ${request.model || 'unknown'}`);
  logger.info(LOG_MODULES.MODEL, `API Key (前8位): ${config.apiKey?.substring(0, 8)}...`);
  logger.info(LOG_MODULES.MODEL, `Request body size: ${JSON.stringify(request).length} bytes`);
  logger.info(LOG_MODULES.MODEL, `Timeout: ${timeout}ms`);
  logger.info(LOG_MODULES.MODEL, `Request keys: ${Object.keys(request).join(', ')}`);
  logger.info(LOG_MODULES.MODEL, `Has system prompt: ${!!request.system}`);
  logger.info(LOG_MODULES.MODEL, `System prompt length: ${request.system?.length || 0}`);
  logger.info(LOG_MODULES.MODEL, `Messages count: ${request.messages?.length || 0}`);
  logger.info(LOG_MODULES.MODEL, `First message length: ${request.messages?.[0]?.content?.length || 0}`);

  // 打印请求体结构（不含完整内容）
  logger.info(LOG_MODULES.MODEL, 'Request structure', { details: {
    model: request.model,
    max_tokens: request.max_tokens,
    temperature: request.temperature,
    stream: request.stream,
    system: request.system ? `[${request.system.length} chars]` : undefined,
    messages: request.messages?.map((m: any, i: number) => ({
      index: i,
      role: m.role,
      contentLength: m.content?.length || 0
    }))
  }});
  logger.info(LOG_MODULES.MODEL, '========================================');

  // 创建超时控制器
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    logger.info(LOG_MODULES.MODEL, `Claude response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(LOG_MODULES.MODEL, `Claude API Error: ${response.status} ${errorText}`);
      throw new RouteError(
        `Claude API error: ${response.status} ${response.statusText}`,
        response.status,
        { error: errorText }
      );
    }

    return await response.json();
  } catch (error) {
    // 详细错误日志
    const duration = Date.now() - startTime;
    logger.error(LOG_MODULES.MODEL, '========== Claude API 调用失败 ==========');
    logger.error(LOG_MODULES.MODEL, `Error type: ${error?.constructor?.name || typeof error}`);
    logger.error(LOG_MODULES.MODEL, `Error name: ${error instanceof Error ? error.name : 'N/A'}`);
    logger.error(LOG_MODULES.MODEL, `Error message: ${error instanceof Error ? error.message : String(error)}`);
    logger.error(LOG_MODULES.MODEL, `URL: ${apiUrl}`);
    logger.error(LOG_MODULES.MODEL, `API Key (前8位): ${config.apiKey?.substring(0, 8)}...`);
    logger.error(LOG_MODULES.MODEL, `Request body size: ${JSON.stringify(request).length} bytes`);
    logger.error(LOG_MODULES.MODEL, `Error duration: ${duration}ms`);
    
    // 尝试获取更详细的错误原因
    if (error instanceof Error && (error as any).cause) {
      logger.error(LOG_MODULES.MODEL, 'Error cause', { details: { cause: (error as any).cause } });
    }

    // 如果是 AggregateError，打印所有错误
    if (error instanceof AggregateError) {
      logger.error(LOG_MODULES.MODEL, 'AggregateError errors', { details: { errors: error.errors } });
    }

    // 如果是网络错误，打印可能的原因
    if (error instanceof Error && (error.message.includes('fetch failed') || error.message.includes('ECONN'))) {
      logger.error(LOG_MODULES.MODEL, '⚠️ 网络错误可能原因: 目标服务器不可达, 请求体过大被拒绝, 代理服务器不支持某些字段 (如 system), 连接被防火墙中断, 服务器处理超时并关闭连接');
    }
    logger.error(LOG_MODULES.MODEL, '==============================================');

    if (error instanceof Error && error.name === 'AbortError') {
      throw new RouteError(`请求超时 (${timeout}ms)`, 408);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 路由请求到模型
 * 
 * 与原 CCR routeRequest 保持相同接口
 */
export async function routeRequest(request: any): Promise<any> {
  try {
    const modelName = request.model;
    if (!modelName) {
      throw new RouteError('Model name is required', 400);
    }

    // 查找模型配置
    const config = await findModelByName(modelName);
    if (!config) {
      throw new RouteError(`Model not found: ${modelName}`, 404);
    }

    logger.info(LOG_MODULES.MODEL, `Routing: ${config.name} (${config.providerType}) -> ${modelName}`);

    // 构建请求体（使用 ModelConfig 中的 maxTokens 和 temperature）
    const internalRequest = {
      model: modelName,
      messages: request.messages || [],
      max_tokens: request.max_tokens ?? config.maxTokens ?? 32000,
      temperature: request.temperature ?? config.temperature ?? 0.3,
      stream: false,
      tools: request.tools,
      tool_choice: request.tool_choice,
      system: request.system,
    };

    // 根据类型调用不同的 API
    if (config.providerType === 'claude') {
      return await callClaude(config, internalRequest);
    } else {
      return await callOpenAI(config, internalRequest);
    }
  } catch (error) {
    logger.error(LOG_MODULES.MODEL, 'ERROR routeRequest', { details: { error: error instanceof Error ? error.message : String(error) } });
    if (error instanceof RouteError) {
      throw error;
    }
    throw new RouteError(
      error instanceof Error ? error.message : 'Unknown error',
      500,
      error
    );
  }
}

/**
 * 路由流式请求到模型
 * 
 * 与原 CCR routeStreamRequest 保持相同接口
 */
export async function routeStreamRequest(
  request: any,
  onChunk: (chunk: any) => void,
  onError: (error: Error) => void,
  onComplete: () => void
): Promise<void> {
  try {
    const modelName = request.model;
    if (!modelName) {
      throw new RouteError('Model name is required', 400);
    }

    // 查找模型配置
    const config = await findModelByName(modelName);
    if (!config) {
      throw new RouteError(`Model not found: ${modelName}`, 404);
    }

    logger.info(LOG_MODULES.MODEL, `Stream Routing: ${config.name} (${config.providerType}) -> ${modelName}`);

    // 构建请求体
    let messages = request.messages || [];
    
    // OpenAI 格式：系统提示词放入 messages 数组
    if (config.providerType === 'openai' && request.system) {
      messages = [
        { role: 'system', content: request.system },
        ...messages
      ];
    }

    const internalRequest: any = {
      model: modelName,
      messages,
      max_tokens: request.max_tokens ?? config.maxTokens ?? 32000,
      temperature: request.temperature ?? config.temperature ?? 0.3,
      stream: true,
      tools: request.tools,
      tool_choice: request.tool_choice,
    };

    // Claude 格式：系统提示词单独传
    if (config.providerType === 'claude' && request.system) {
      internalRequest.system = request.system;
    }

    // 确定 API URL
    let apiUrl = config.apiBaseUrl;
    if (config.providerType === 'claude') {
      // 如果 URL 以 # 结尾，不拼接路径，直接去掉 #
      if (apiUrl.endsWith('#')) {
        apiUrl = apiUrl.slice(0, -1);
      } else if (!apiUrl.includes('/v1/messages') && !apiUrl.includes('/messages')) {
        apiUrl = apiUrl.replace(/\/$/, '');
        if (apiUrl.includes('/chat/completions')) {
          const urlObj = new URL(apiUrl);
          apiUrl = `${urlObj.origin}/v1/messages`;
        } else {
          apiUrl = `${apiUrl}/v1/messages`;
        }
      }
    } else {
      // 如果 URL 以 # 结尾，不拼接路径，直接去掉 #
      if (apiUrl.endsWith('#')) {
        apiUrl = apiUrl.slice(0, -1);
      } else if (!apiUrl.includes('/chat/completions')) {
        apiUrl = apiUrl.replace(/\/$/, '');
        apiUrl = `${apiUrl}/chat/completions`;
      }
    }

    // 发起流式请求
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.providerType === 'claude') {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(internalRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new RouteError(
        `API error: ${response.status} ${response.statusText}`,
        response.status,
        { error: errorText }
      );
    }

    // 处理流式响应
    const reader = response.body?.getReader();
    if (!reader) {
      throw new RouteError('No response body', 500);
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            onComplete();
            return;
          }
          try {
            const chunk = JSON.parse(data);
            onChunk(chunk);
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    onComplete();
  } catch (error) {
    logger.error(LOG_MODULES.MODEL, 'ERROR routeStreamRequest', { details: { error: error instanceof Error ? error.message : String(error) } });
    onError(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 使用默认模型配置发起请求（带 Token 统计）
 * 
 * @param messages 消息数组
 * @param options 可选参数 + 用户上下文
 * @returns API 响应
  */
export async function routeRequestWithDefaultModel(
  messages: Array<{ role: string; content: string }>,
  options: {
    system?: string;
    max_tokens?: number;
    temperature?: number;
    context: TokenUsageContext;  // 必须传入用户上下文
  }
): Promise<any> {
  const config = await getDefaultModelConfig();
  if (!config) {
    throw new RouteError('未配置默认模型', 500);
  }

  const model = config.models[0] || 'default';
  const startTime = Date.now();
  
  // 使用配置中的值，如果 options 中没有指定
  const finalMaxTokens = options.max_tokens ?? config.maxTokens ?? 32000;
  const finalTemperature = options.temperature ?? config.temperature ?? 0.3;
  
  logger.info(LOG_MODULES.MODEL, `Using default model: ${config.name} (${config.providerType}) -> ${model}`);
  logger.info(LOG_MODULES.MODEL, `Config: maxTokens=${config.maxTokens}, temperature=${config.temperature}`);
  logger.info(LOG_MODULES.MODEL, `Final: maxTokens=${finalMaxTokens}, temperature=${finalTemperature}`);

  const request = {
    model,
    messages,
    max_tokens: finalMaxTokens,
    temperature: finalTemperature,
    system: options.system,
    stream: false,
  };

  try {
    let response: any;

    if (config.providerType === 'claude') {
      response = await callClaude(config, request);
    } else {
      response = await callOpenAI(config, request);
    }

    // 提取并记录 Token 使用
    const tokenUsage = extractTokenUsage(response);
    if (tokenUsage) {
      await recordTokenUsage(
        options.context,
        model,
        config.providerType,
        tokenUsage.inputTokens,
        tokenUsage.outputTokens
      );
    }

    const duration = Date.now() - startTime;
    logger.info(LOG_MODULES.MODEL, `Request completed in ${duration}ms`);
    
    return response;
  } catch (error) {
    // 记录失败
    if (error instanceof RouteError) {
      throw error;
    }
    throw new RouteError(
      error instanceof Error ? error.message : 'Unknown error',
      500,
      error
    );
  }
}

/**
 * 测试模型连接（统一入口）
 * 发送简单的 "Hi" 测试连通性，返回模型响应内容
 * 
 * @param modelConfig 模型配置
 * @param context 可选的用户上下文，用于记录 Token 使用
 * @returns 测试结果（包含响应内容）
 */
export async function testModelConnection(modelConfig: {
  providerType: string;
  apiKey: string;
  apiBaseUrl: string;
  modelName: string;
}, context?: TokenUsageContext): Promise<{ 
  success: boolean; 
  message: string; 
  error?: string;
  response?: string;      // 模型返回的内容
  usage?: {               // Token 使用量
    inputTokens: number;
    outputTokens: number;
  };
  duration?: number;      // 响应时间(ms)
}> {
  const { providerType, apiKey, apiBaseUrl, modelName } = modelConfig;
  const startTime = Date.now();
  
  // 构建 URL 和请求体
  let url: string;
  let headers: Record<string, string>;
  let body: any;
  
  if (providerType === 'claude') {
    url = apiBaseUrl;
    // 如果 URL 以 # 结尾，不拼接路径，直接去掉 #
    if (url.endsWith('#')) {
      url = url.slice(0, -1);
    } else {
      url = url.replace(/\/$/, '');
      if (!url.includes('/v1/messages') && !url.includes('/messages')) {
        url = `${url}/v1/messages`;
      }
    }
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
    body = {
      model: modelName,
      max_tokens: 512,
      messages: [{ role: 'user', content: '1+1' }],
    };
  } else {
    url = apiBaseUrl;
    // 如果 URL 以 # 结尾，不拼接路径，直接去掉 #
    if (url.endsWith('#')) {
      url = url.slice(0, -1);
    } else {
      url = url.replace(/\/$/, '');
      if (!url.includes('/chat/completions')) {
        // 如果 URL 不包含 /v1，先添加 /v1
        if (!url.includes('/v1')) {
          url = `${url}/v1`;
        }
        url = `${url}/chat/completions`;
      }
    }
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
    body = {
      model: modelName,
      max_tokens: 512,
      messages: [{ role: 'user', content: '1+1' }],
    };
  }
  
  logger.info(LOG_MODULES.MODEL, `Testing connection: ${modelName} (${providerType})`);
  logger.info(LOG_MODULES.MODEL, `URL: ${url}`);

  // 创建超时控制器
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    if (response.ok) {
      const data = await response.json();

      // 提取响应内容 - 支持多种 API 格式
      let responseContent = '';
      let inputTokens = 0;
      let outputTokens = 0;

      // 打印完整响应用于调试（不截断）
      logger.info(LOG_MODULES.MODEL, 'Test raw response (full):', { details: { response: data } });
      
      if (providerType === 'claude') {
        // Claude 格式: content[0].text 或 content[0].thinking（思考模型）
        if (data.content && Array.isArray(data.content)) {
          // 先找 text 类型的块
          const textBlock = data.content.find((block: any) => block.type === 'text');
          if (textBlock?.text) {
            responseContent = textBlock.text;
          }
          // 如果没有 text，找 thinking 类型的块（思考模型如 GLM-5, Qwen3.5）
          if (!responseContent) {
            const thinkingBlock = data.content.find((block: any) => block.type === 'thinking');
            if (thinkingBlock?.thinking) {
              responseContent = thinkingBlock.thinking;
            }
          }
          // 兼容：content 数组中直接有 text 字段
          if (!responseContent) {
            for (const block of data.content) {
              if (block.text) {
                responseContent = block.text;
                break;
              }
            }
          }
        }
        // 兼容：有些代理返回 Claude 格式但 content 是字符串
        if (!responseContent && typeof data.content === 'string') {
          responseContent = data.content;
        }
        // 兼容：直接返回 text 字段
        if (!responseContent && data.text) {
          responseContent = data.text;
        }
        // Token 使用量
        if (data.usage) {
          inputTokens = data.usage.input_tokens || 0;
          outputTokens = data.usage.output_tokens || 0;
        }
      } else {
        // OpenAI 格式: choices[0].message.content
        responseContent = data.choices?.[0]?.message?.content || '';
        
        // 兼容：有些 API 返回 choices[0].text（旧版 OpenAI 格式）
        if (!responseContent && data.choices?.[0]?.text) {
          responseContent = data.choices[0].text;
        }
        
        // 兼容：直接返回 content 字段
        if (!responseContent && data.content) {
          responseContent = typeof data.content === 'string' 
            ? data.content 
            : (data.content[0]?.text || '');
        }
        
        // 兼容：直接返回 text 字段
        if (!responseContent && data.text) {
          responseContent = data.text;
        }
        
        // 兼容：response 字段
        if (!responseContent && data.response) {
          responseContent = typeof data.response === 'string'
            ? data.response
            : JSON.stringify(data.response);
        }
        
        // 兼容：result 字段
        if (!responseContent && data.result) {
          responseContent = typeof data.result === 'string'
            ? data.result
            : JSON.stringify(data.result);
        }
        
        // Token 使用量 - 支持多种格式
        if (data.usage) {
          inputTokens = data.usage.prompt_tokens || data.usage.input_tokens || 0;
          outputTokens = data.usage.completion_tokens || data.usage.output_tokens || 0;
        }
        // 兼容：有些 API 把 token 放在 choices 里
        if (!inputTokens && data.choices?.[0]?.usage) {
          const choiceUsage = data.choices[0].usage;
          inputTokens = choiceUsage.prompt_tokens || choiceUsage.input_tokens || 0;
          outputTokens = choiceUsage.completion_tokens || choiceUsage.output_tokens || 0;
        }
      }
      
      // 如果还是没有提取到内容，把整个响应作为调试信息
      if (!responseContent) {
        responseContent = `[API响应格式未知，完整响应: ${JSON.stringify(data).substring(0, 200)}]`;
      }
      
      logger.info(LOG_MODULES.MODEL, `Test extracted content: ${responseContent.substring(0, 100)}`);
      
      // 记录 Token 使用到数据库（如果提供了用户上下文）
      if (context && inputTokens > 0) {
        await recordTokenUsage(
          context,
          modelName,
          providerType,
          inputTokens,
          outputTokens
        );
      }
      
      return { 
        success: true, 
        message: '模型连接成功',
        response: responseContent,
        usage: { inputTokens, outputTokens },
        duration
      };
    } else {
      const errorText = await response.text();
      let errorDetails = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson.error?.message || errorJson.message || errorText;
      } catch {
        // 保持原始文本
      }
      return { 
        success: false, 
        message: '模型连接失败', 
        error: `HTTP ${response.status}: ${errorDetails}`,
        duration
      };
    }
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    
    let errorMessage = '请求失败';
    let errorDetail = String(error);
    if (error instanceof Error && error.name === 'AbortError') {
      errorMessage = `连接超时 (${TEST_TIMEOUT_MS}ms)`;
      errorDetail = `请求在 ${TEST_TIMEOUT_MS}ms 内未收到响应，可能是目标服务器响应过慢或网络不稳定`;
    } else if (error instanceof Error) {
      errorMessage = error.message;
      if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
        errorMessage = '网络连接失败';
        errorDetail = `${error.message} — 目标服务器不可达，请检查: 1) API 地址是否正确 2) 服务器能否访问该地址 3) 是否有防火墙拦截`;
      } else if (error.message.includes('ECONNRESET')) {
        errorMessage = '连接被重置';
        errorDetail = `${error.message} — 目标服务器主动断开了连接，可能是请求格式不被支持或服务器过载`;
      } else if (error.message.includes('ETIMEDOUT')) {
        errorMessage = '连接超时';
        errorDetail = `${error.message} — TCP 连接建立超时，目标服务器可能不存在或网络不可达`;
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        errorMessage = 'DNS 解析失败';
        errorDetail = `${error.message} — API 地址域名无法解析，请检查 apiBaseUrl 是否正确`;
      } else if (error.message.includes('CERT') || error.message.includes('TLS') || error.message.includes('ssl')) {
        errorMessage = 'TLS/SSL 错误';
        errorDetail = `${error.message} — HTTPS 证书验证失败，可能是自签证书或不受信任的证书`;
      }
    }
    
    return { 
      success: false, 
      message: errorMessage, 
      error: errorDetail,
      duration
    };
  }
}

// 导出类型
export type { TokenUsageContext, CallScene } from '@/types/call-scene';
