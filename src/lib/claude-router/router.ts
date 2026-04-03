import { getCcrConfig, CcrConfig, CcrProviderConfig } from './config';
import { ConfigService } from './llms/services/config';
import { TransformerService } from './llms/services/transformer';
import { ProviderService } from './llms/services/provider';
import { LLMProvider, UnifiedChatRequest } from './llms/types/llm';
import { TransformerContext } from './llms/types/transformer';

/**
 * 路由请求上下文
 */
export interface RouteContext {
  config: CcrConfig;
  provider: LLMProvider;
  targetModel: string;
  scenarioType: 'default' | 'background' | 'think' | 'longContext' | 'webSearch';
}

/**
 * 路由错误
 */
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

/**
 * 根据请求特征选择路由场景类型
 */
function determineScenarioType(request: any): 'default' | 'background' | 'think' | 'longContext' | 'webSearch' {
  // 检查是否有 thinking 参数
  if (request.thinking) {
    return 'think';
  }

  // 检查是否有 web_search 工具
  if (Array.isArray(request.tools) && request.tools.some((tool: any) => tool.type?.startsWith('web_search'))) {
    return 'webSearch';
  }

  // 检查是否是 Haiku 模型（用于后台任务）
  if (request.model?.includes('claude') && request.model?.includes('haiku')) {
    return 'background';
  }

  // 默认场景
  return 'default';
}

/**
 * 根据场景类型选择目标模型
 */
function selectTargetModel(
  config: CcrConfig,
  scenarioType: 'default' | 'background' | 'think' | 'longContext' | 'webSearch',
  request: any
): string {
  const router = config.router;

  // 根据场景类型选择路由
  switch (scenarioType) {
    case 'think':
      return router.think || router.default;
    case 'webSearch':
      return router.webSearch || router.default;
    case 'background':
      return router.background || router.default;
    case 'longContext':
      return router.longContext || router.default;
    default:
      return router.default;
  }
}

/**
 * 初始化 CCR 服务
 */
async function initializeCcrServices() {
  const config = await getCcrConfig();

  // 创建 ConfigService
  const configService = new ConfigService({
    initialConfig: {
      providers: config.providers,
      Router: config.router,
    },
    useJsonFile: false,
    useEnvironmentVariables: false,
  });

  // 创建 TransformerService
  const transformerService = new TransformerService(
    configService,
    console
  );
  await transformerService.initialize();

  // 创建 ProviderService
  const providerService = new ProviderService(
    configService,
    transformerService,
    console
  );

  return {
    config,
    configService,
    transformerService,
    providerService,
  };
}

/**
 * 解析模型路由信息
 */
function parseModelRoute(modelString: string): { providerName: string; modelName: string } | null {
  const parts = modelString.split(',');
  if (parts.length >= 2) {
    return {
      providerName: parts[0],
      modelName: parts.slice(1).join(','),
    };
  }
  return null;
}

/**
 * 路由请求到内部大模型
 */
export async function routeRequest(request: any): Promise<any> {
  try {
    // 初始化服务
    const { config, providerService, transformerService } = await initializeCcrServices();

    // 确定场景类型
    const scenarioType = determineScenarioType(request);

    // 选择目标模型
    const targetModel = selectTargetModel(config, scenarioType, request);

    // 解析模型路由
    const routeInfo = parseModelRoute(targetModel);
    if (!routeInfo) {
      throw new RouteError(`Invalid model format: ${targetModel}`, 400);
    }

    // 获取提供商
    const provider = providerService.getProvider(routeInfo.providerName);
    if (!provider) {
      throw new RouteError(`Provider not found: ${routeInfo.providerName}`, 404);
    }

    // 构建转换上下文
    const context: TransformerContext = {
      provider,
      model: routeInfo.modelName,
    };

    // 转换请求格式（Anthropic → OpenAI）
    let transformedRequest: any = request;

    // 应用转换器
    if (provider.transformer?.use && Array.isArray(provider.transformer.use)) {
      for (const transformer of provider.transformer.use) {
        if (transformer.transformRequestOut) {
          transformedRequest = await transformer.transformRequestOut(request, context);
        }
      }
    }

    // 构建内部请求
    const internalRequest = {
      model: routeInfo.modelName,
      messages: transformedRequest.messages || [],
      max_tokens: transformedRequest.max_tokens || 4096,
      temperature: transformedRequest.temperature || 0.7,
      stream: transformedRequest.stream || false,
      tools: transformedRequest.tools,
      tool_choice: transformedRequest.tool_choice,
    };

    // 转发到内部大模型
    const response = await fetchInternalModel(provider, internalRequest);

    // 转换响应格式（OpenAI → Anthropic）
    let transformedResponse = response;

    if (provider.transformer?.use && Array.isArray(provider.transformer.use)) {
      for (const transformer of provider.transformer.use) {
        if (transformer.transformResponseOut) {
          transformedResponse = await transformer.transformResponseOut(response, context);
        }
      }
    }

    return transformedResponse;
  } catch (error) {
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
 * 路由流式请求到内部大模型
 */
export async function routeStreamRequest(
  request: any,
  onChunk: (chunk: any) => void,
  onError: (error: Error) => void,
  onComplete: () => void
): Promise<void> {
  try {
    // 初始化服务
    const { config, providerService, transformerService } = await initializeCcrServices();

    // 确定场景类型
    const scenarioType = determineScenarioType(request);

    // 选择目标模型
    const targetModel = selectTargetModel(config, scenarioType, request);

    // 解析模型路由
    const routeInfo = parseModelRoute(targetModel);
    if (!routeInfo) {
      throw new RouteError(`Invalid model format: ${targetModel}`, 400);
    }

    // 获取提供商
    const provider = providerService.getProvider(routeInfo.providerName);
    if (!provider) {
      throw new RouteError(`Provider not found: ${routeInfo.providerName}`, 404);
    }

    // 构建转换上下文
    const context: TransformerContext = {
      provider,
      model: routeInfo.modelName,
    };

    // 转换请求格式（Anthropic → OpenAI）
    let transformedRequest: any = request;

    // 应用转换器
    if (provider.transformer?.use && Array.isArray(provider.transformer.use)) {
      for (const transformer of provider.transformer.use) {
        if (transformer.transformRequestOut) {
          transformedRequest = await transformer.transformRequestOut(request, context);
        }
      }
    }

    // 构建内部请求
    const internalRequest = {
      model: routeInfo.modelName,
      messages: transformedRequest.messages || [],
      max_tokens: transformedRequest.max_tokens || 4096,
      temperature: transformedRequest.temperature || 0.7,
      stream: true, // 强制流式
      tools: transformedRequest.tools,
      tool_choice: transformedRequest.tool_choice,
    };

    // 转发到内部大模型（流式）
    await fetchInternalModelStream(
      provider,
      internalRequest,
      async (chunk) => {
        // 转换响应格式（OpenAI → Anthropic）
        let transformedChunk = chunk;

        if (provider.transformer?.use && Array.isArray(provider.transformer.use)) {
          for (const transformer of provider.transformer.use) {
            if (transformer.transformResponseOut) {
              transformedChunk = await transformer.transformResponseOut(chunk, context);
            }
          }
        }

        onChunk(transformedChunk);
      },
      onError,
      onComplete
    );
  } catch (error) {
    if (error instanceof RouteError) {
      onError(error);
    } else {
      onError(new RouteError(
        error instanceof Error ? error.message : 'Unknown error',
        500,
        error
      ));
    }
  }
}

/**
 * 调用内部大模型（非流式）
 * 支持两种代理方式：
 * - providerType: 'claude' - 直接调用 Claude API
 * - providerType: 'openai' - 调用 OpenAI 格式的内部大模型
 */
async function fetchInternalModel(provider: LLMProvider, request: any): Promise<any> {
  // 根据 providerType 选择调用方式
  if (provider.providerType === 'claude') {
    return await fetchClaudeApi(provider, request);
  } else {
    return await fetchOpenAIModel(provider, request);
  }
}

/**
 * 调用 Claude API（原生）
 */
async function fetchClaudeApi(provider: LLMProvider, request: any): Promise<any> {
  const response = await fetch(provider.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new RouteError(
      `Claude API error: ${response.status} ${response.statusText}`,
      response.status,
      { error: errorText }
    );
  }

  return response.json();
}

/**
 * 调用 OpenAI 格式的内部大模型
 */
async function fetchOpenAIModel(provider: LLMProvider, request: any): Promise<any> {
  const response = await fetch(provider.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new RouteError(
      `Internal model error: ${response.status} ${response.statusText}`,
      response.status,
      { error: errorText }
    );
  }

  return response.json();
}

/**
 * 调用内部大模型（流式）
 * 支持两种代理方式：
 * - providerType: 'claude' - 直接调用 Claude API（SSE 流）
 * - providerType: 'openai' - 调用 OpenAI 格式的内部大模型
 */
async function fetchInternalModelStream(
  provider: LLMProvider,
  request: any,
  onChunk: (chunk: any) => void,
  onError: (error: Error) => void,
  onComplete: () => void
): Promise<void> {
  try {
    // 根据 providerType 选择调用方式
    if (provider.providerType === 'claude') {
      await fetchClaudeApiStream(provider, request, onChunk, onError, onComplete);
    } else {
      await fetchOpenAIModelStream(provider, request, onChunk, onError, onComplete);
    }
  } catch (error) {
    onError(error instanceof Error ? error : new Error('Unknown error'));
  }
}

/**
 * 调用 Claude API（流式）
 */
async function fetchClaudeApiStream(
  provider: LLMProvider,
  request: any,
  onChunk: (chunk: any) => void,
  onError: (error: Error) => void,
  onComplete: () => void
): Promise<void> {
  try {
    const response = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ ...request, stream: true }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      onError(new RouteError(
        `Claude API error: ${response.status} ${response.statusText}`,
        response.status,
        { error: errorText }
      ));
      return;
    }

    // 处理 SSE 流
    const reader = response.body?.getReader();
    if (!reader) {
      onError(new Error('Response body is not readable'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

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
          } catch (error) {
            // 忽略解析错误
          }
        }
      }
    }

    onComplete();
  } catch (error) {
    onError(error instanceof Error ? error : new Error('Unknown error'));
  }
}

/**
 * 调用 OpenAI 格式的内部大模型（流式）
 */
async function fetchOpenAIModelStream(
  provider: LLMProvider,
  request: any,
  onChunk: (chunk: any) => void,
  onError: (error: Error) => void,
  onComplete: () => void
): Promise<void> {
  try {
    const response = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({ ...request, stream: true }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      onError(new RouteError(
        `Internal model error: ${response.status} ${response.statusText}`,
        response.status,
        { error: errorText }
      ));
      return;
    }

    // 处理 SSE 流
    const reader = response.body?.getReader();
    if (!reader) {
      onError(new Error('Response body is not readable'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

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
          } catch (error) {
            // 忽略解析错误
          }
        }
      }
    }

    onComplete();
  } catch (error) {
    onError(error instanceof Error ? error : new Error('Unknown error'));
  }
}

/**
 * 获取可用的模型列表
 */
export async function getAvailableModels(): Promise<string[]> {
  const { providerService } = await initializeCcrServices();
  return providerService.getAvailableModelNames();
}

/**
 * 获取当前配置
 */
export async function getCurrentConfig(): Promise<CcrConfig> {
  return getCcrConfig();
}
