/**
 * 简化的模型调用服务
 * 
 * 支持两种类型：
 * - openai: 使用 http://xxx/v1/chat/completions
 * - claude: 使用 http://xxx/v1/messages
 * 
 * 保持与原 CCR router 相同的接口
 */

import { prisma } from '@/lib/prisma';

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
