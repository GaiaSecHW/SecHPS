import { getCcrConfig, CcrConfig, CcrProviderConfig } from './config';
import { ConfigService } from './llms/services/config';
import { TransformerService } from './llms/services/transformer';
import { ProviderService } from './llms/services/provider';
import { LLMProvider, UnifiedChatRequest } from './llms/types/llm';
import { TransformerContext } from './llms/types/transformer';
import { AnthropicTransformer } from './llms/transformer/anthropic.transformer';

// 创建全局的 Anthropic 转换器实例（用于 OpenAI 类型提供商）
let anthropicTransformer: AnthropicTransformer | null = null;

function getAnthropicTransformer(): AnthropicTransformer {
  if (!anthropicTransformer) {
    anthropicTransformer = new AnthropicTransformer();
    (anthropicTransformer as any).logger = console;
  }
  return anthropicTransformer;
}

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
      console.error('[CCR] ERROR: Invalid model format:', targetModel);
      throw new RouteError(`Invalid model format: ${targetModel}`, 400);
    }

    // 获取提供商
    const provider = providerService.getProvider(routeInfo.providerName);
    if (!provider) {
      console.error('[CCR] ERROR: Provider not found:', routeInfo.providerName);
      throw new RouteError(`Provider not found: ${routeInfo.providerName}`, 404);
    }

    console.log(`[CCR] Routing: ${provider.name} (${provider.providerType}) -> ${routeInfo.modelName}`);

    // 构建转换上下文
    const context: TransformerContext = {
      provider,
      model: routeInfo.modelName,
    };

    // 根据提供商类型决定是否需要格式转换
    const isClaudeProvider = provider.providerType === 'claude';
    let internalRequest: any;
    let needsResponseConversion = false;

    if (isClaudeProvider) {
      // Claude 类型：直接使用原始请求格式
      internalRequest = {
        model: routeInfo.modelName,
        messages: request.messages || [],
        max_tokens: request.max_tokens || 4096,
        temperature: request.temperature || 0.7,
        stream: request.stream || false,
        tools: request.tools,
        tool_choice: request.tool_choice,
        system: request.system,
      };
    } else {
      // OpenAI 类型：需要转换格式
      needsResponseConversion = true;

      // 使用 AnthropicTransformer 转换请求
      const transformer = getAnthropicTransformer();
      const unifiedRequest = await transformer.transformRequestOut(request, context);

      internalRequest = {
        model: routeInfo.modelName,
        messages: unifiedRequest.messages || [],
        max_tokens: unifiedRequest.max_tokens || 4096,
        temperature: unifiedRequest.temperature || 0.7,
        stream: unifiedRequest.stream || false,
        tools: unifiedRequest.tools,
        tool_choice: unifiedRequest.tool_choice,
      };

      if (unifiedRequest.reasoning) {
        internalRequest.reasoning = unifiedRequest.reasoning;
      }
    }

    // 转发到内部大模型
    const response = await fetchInternalModel(provider, internalRequest);

    // 如果需要，转换响应格式
    let finalResponse = response;

    if (needsResponseConversion) {
      const transformer = getAnthropicTransformer();

      // 将响应对象转换为 Response 对象以便使用 transformResponseIn
      const mockResponse = new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' }
      });

      const convertedResponse = await transformer.transformResponseIn(mockResponse, context);
      finalResponse = await convertedResponse.json();
    }

    return finalResponse;
  } catch (error) {
    console.error('[CCR] ERROR routeRequest:', error);
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

    console.log(`[CCR] Stream Routing: ${provider.name} (${provider.providerType}) -> ${routeInfo.modelName}`);

    // 构建转换上下文
    const context: TransformerContext = {
      provider,
      model: routeInfo.modelName,
    };

    // 根据提供商类型决定是否需要格式转换
    const isClaudeProvider = provider.providerType === 'claude';
    let internalRequest: any;

    if (isClaudeProvider) {
      // Claude 类型：直接使用原始请求格式
      internalRequest = {
        model: routeInfo.modelName,
        messages: request.messages || [],
        max_tokens: request.max_tokens || 4096,
        temperature: request.temperature || 0.7,
        stream: true,
        tools: request.tools,
        tool_choice: request.tool_choice,
        system: request.system,
      };
    } else {
      // OpenAI 类型：需要转换格式
      // 使用 AnthropicTransformer 转换请求
      const transformer = getAnthropicTransformer();
      const unifiedRequest = await transformer.transformRequestOut(request, context);

      internalRequest = {
        model: routeInfo.modelName,
        messages: unifiedRequest.messages || [],
        max_tokens: unifiedRequest.max_tokens || 4096,
        temperature: unifiedRequest.temperature || 0.7,
        stream: true,
        tools: unifiedRequest.tools,
        tool_choice: unifiedRequest.tool_choice,
      };

      if (unifiedRequest.reasoning) {
        internalRequest.reasoning = unifiedRequest.reasoning;
      }
    }

    // 转发到内部大模型（流式）
    await fetchInternalModelStream(
      provider,
      internalRequest,
      isClaudeProvider,
      onChunk,
      onError,
      onComplete
    );
  } catch (error) {
    console.error('[CCR] ERROR routeStreamRequest:', error);
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
      'x-api-key': provider.apiKey || '',
      'anthropic-version': '2023-06-01',
    },
    body: request,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[CCR] CLAUDE API ERROR:', response.status, errorText);
    throw new RouteError(
      `Claude API error: ${response.status} ${response.statusText}`,
      response.status,
      { error: errorText }
    );
  }

  return await response.json();
}

/**
 * 调用 OpenAI 格式的内部大模型
 */
async function fetchOpenAIModel(provider: LLMProvider, request: any): Promise<any> {
  // 构建完整的 API URL
  // OpenAI 格式的 API 需要 /chat/completions 路径
  let apiUrl = provider.baseUrl;
  if (!apiUrl.endsWith('/chat/completions')) {
    apiUrl = apiUrl.replace(/\/$/, '');
    apiUrl = `${apiUrl}/chat/completions`;
  }

  const requestBody = JSON.stringify(request);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey || ''}`,
    },
    body: requestBody,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[CCR] OPENAI API ERROR:', response.status, errorText);
    throw new RouteError(
      `Internal model error: ${response.status} ${response.statusText}`,
      response.status,
      { error: errorText }
    );
  }

  return await response.json();
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
  isClaudeProvider: boolean,
  onChunk: (chunk: any) => void,
  onError: (error: Error) => void,
  onComplete: () => void
): Promise<void> {
  try {
    // 根据 providerType 选择调用方式
    if (isClaudeProvider) {
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
    const requestBody = { ...request, stream: true };

    const response = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[CCR] CLAUDE API STREAM ERROR:', response.status, errorText);
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
    console.error('[CCR] CLAUDE STREAM ERROR:', error);
    onError(error instanceof Error ? error : new Error('Unknown error'));
  }
}

/**
 * 调用 OpenAI 格式的内部大模型（流式）
 * 将 OpenAI 流式响应转换为 Anthropic 格式
 */
async function fetchOpenAIModelStream(
  provider: LLMProvider,
  request: any,
  onChunk: (chunk: any) => void,
  onError: (error: Error) => void,
  onComplete: () => void
): Promise<void> {
  try {
    // 构建完整的 API URL
    let apiUrl = provider.baseUrl;
    if (!apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl.replace(/\/$/, '');
      apiUrl = `${apiUrl}/chat/completions`;
    }

    const requestBody = { ...request, stream: true };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey || ''}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[CCR] OPENAI API STREAM ERROR:', response.status, errorText);
      onError(new RouteError(
        `Internal model error: ${response.status} ${response.statusText}`,
        response.status,
        { error: errorText }
      ));
      return;
    }

    // 使用 AnthropicTransformer 转换流式响应
    const transformer = getAnthropicTransformer();
    const context: TransformerContext = {
      provider,
      model: request.model,
      req: { id: `req_${Date.now()}` } as any, // 用于日志
    };

    // 转换响应流
    const convertedResponse = await transformer.transformResponseIn(response, context);

    // 读取转换后的流
    const reader = convertedResponse.body?.getReader();
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
    console.error('[CCR] OPENAI STREAM ERROR:', error);
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
