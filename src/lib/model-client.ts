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
 */

import { prisma } from '@/lib/prisma';
import type { TokenUsageContext, CallScene } from '@/types/call-scene';

// 错误类型
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
    
    console.log(`[ModelClient] Token recorded: ${context.scene} | ${model} | ${inputTokens}+${outputTokens} | user=${context.userId}`);
  } catch (error) {
    console.error('[ModelClient] Failed to record token usage:', error);
  }
}

/**
 * 调用 OpenAI 格式的 API
 * URL: http://xxx/v1/chat/completions
 */
async function callOpenAI(config: ModelConfig, request: any): Promise<any> {
  let apiUrl = config.apiBaseUrl;
  
  // 确保 URL 正确
  if (!apiUrl.includes('/chat/completions')) {
    apiUrl = apiUrl.replace(/\/$/, '');
    apiUrl = `${apiUrl}/chat/completions`;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[ModelClient] OpenAI API Error:', response.status, errorText);
    throw new RouteError(
      `OpenAI API error: ${response.status} ${response.statusText}`,
      response.status,
      { error: errorText }
    );
  }

  return await response.json();
}

/**
 * 调用 Claude 格式的 API
 * URL: http://xxx/v1/messages
 */
async function callClaude(config: ModelConfig, request: any): Promise<any> {
  let apiUrl = config.apiBaseUrl;
  
  // 确保 URL 正确
  if (!apiUrl.includes('/v1/messages') && !apiUrl.includes('/messages')) {
    apiUrl = apiUrl.replace(/\/$/, '');
    if (apiUrl.includes('/chat/completions')) {
      // 从 OpenAI 格式转换
      const urlObj = new URL(apiUrl);
      apiUrl = `${urlObj.origin}/v1/messages`;
    } else {
      apiUrl = `${apiUrl}/v1/messages`;
    }
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[ModelClient] Claude API Error:', response.status, errorText);
    throw new RouteError(
      `Claude API error: ${response.status} ${response.statusText}`,
      response.status,
      { error: errorText }
    );
  }

  return await response.json();
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

    console.log(`[ModelClient] Routing: ${config.name} (${config.providerType}) -> ${modelName}`);

    // 构建请求体
    const internalRequest = {
      model: modelName,
      messages: request.messages || [],
      max_tokens: request.max_tokens || 4096,
      temperature: request.temperature ?? 0.7,
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
    console.error('[ModelClient] ERROR routeRequest:', error);
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

    console.log(`[ModelClient] Stream Routing: ${config.name} (${config.providerType}) -> ${modelName}`);

    // 构建请求体
    const internalRequest = {
      model: modelName,
      messages: request.messages || [],
      max_tokens: request.max_tokens || 4096,
      temperature: request.temperature ?? 0.7,
      stream: true,
      tools: request.tools,
      tool_choice: request.tool_choice,
      system: request.system,
    };

    // 确定 API URL
    let apiUrl = config.apiBaseUrl;
    if (config.providerType === 'claude') {
      if (!apiUrl.includes('/v1/messages') && !apiUrl.includes('/messages')) {
        apiUrl = apiUrl.replace(/\/$/, '');
        if (apiUrl.includes('/chat/completions')) {
          const urlObj = new URL(apiUrl);
          apiUrl = `${urlObj.origin}/v1/messages`;
        } else {
          apiUrl = `${apiUrl}/v1/messages`;
        }
      }
    } else {
      if (!apiUrl.includes('/chat/completions')) {
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
    console.error('[ModelClient] ERROR routeStreamRequest:', error);
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
  
  console.log(`[ModelClient] Using default model: ${config.name} (${config.providerType}) -> ${model}`);

  const request = {
    model,
    messages,
    max_tokens: options.max_tokens || 4096,
    temperature: options.temperature ?? 0.7,
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
    console.log(`[ModelClient] Request completed in ${duration}ms`);
    
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

// 导出类型
export type { TokenUsageContext, CallScene } from '@/types/call-scene';
