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
 */

import { prisma } from '@/lib/prisma';
import type { TokenUsageContext, CallScene } from '@/types/call-scene';

// ============================================================================
// 超时常量配置
// ============================================================================

/** 统一超时时间：10分钟（与 MCP 一致） */
export const DEFAULT_TIMEOUT_MS = 600000;
/** 长时间任务超时：10分钟 */
export const LONG_TIMEOUT_MS = 600000;
/** 测试超时：10分钟 */
export const TEST_TIMEOUT_MS = 600000;

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
async function callOpenAI(config: ModelConfig, request: any, timeout: number = DEFAULT_TIMEOUT_MS): Promise<any> {
  let apiUrl = config.apiBaseUrl;
  
  // 确保 URL 正确
  if (!apiUrl.includes('/chat/completions')) {
    apiUrl = apiUrl.replace(/\/$/, '');
    apiUrl = `${apiUrl}/chat/completions`;
  }

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
      body: JSON.stringify(request),
      signal: controller.signal,
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
  } catch (error) {
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
  } catch (error) {
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
    url = apiBaseUrl.replace(/\/$/, '');
    if (!url.includes('/v1/messages') && !url.includes('/messages')) {
      url = `${url}/v1/messages`;
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
    url = apiBaseUrl.replace(/\/$/, '');
    if (!url.includes('/chat/completions')) {
      url = `${url}/v1/chat/completions`;
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
  
  console.log(`[ModelClient] Testing connection: ${modelName} (${providerType})`);
  console.log(`[ModelClient] URL: ${url}`);
  
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
      console.log(`[ModelClient] Test raw response (full):`);
      console.log(JSON.stringify(data, null, 2));
      
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
      
      console.log(`[ModelClient] Test extracted content: ${responseContent.substring(0, 100)}`);
      
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
    if (error instanceof Error && error.name === 'AbortError') {
      errorMessage = `连接超时 (${TEST_TIMEOUT_MS}ms)`;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    return { 
      success: false, 
      message: errorMessage, 
      error: String(error),
      duration
    };
  }
}

// 导出类型
export type { TokenUsageContext, CallScene } from '@/types/call-scene';
