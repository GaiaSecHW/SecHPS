// src/app/api/admin/models/[id]/test/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// 测试模型连通性
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    // 获取模型配置
    const model = await prisma.modelConfig.findUnique({
      where: { id },
    });

    if (!model) {
      return NextResponse.json(
        { error: '模型配置不存在' },
        { status: 404 }
      );
    }

    // 解析模型列表
    let models: string[];
    try {
      models = JSON.parse(model.models);
    } catch (parseError) {
      return NextResponse.json(
        { error: '模型配置格式错误', details: 'models 字段不是有效的 JSON' },
        { status: 400 }
      );
    }
    if (!models || models.length === 0) {
      return NextResponse.json(
        { error: '模型配置中没有可用的模型' },
        { status: 400 }
      );
    }

    const modelName = models[0];

    // 构建测试请求 - 使用适配器
    const adapter = createApiAdapter(model.providerType, model.apiBaseUrl, model.apiKey, modelName);
    const { url, headers, body } = adapter;

    console.log(`[Model Test] Testing model: ${model.name} (${model.providerType})`);
    console.log(`[Model Test] URL: ${url}`);
    console.log(`[Model Test] Model name: ${modelName}`);

    // 发送测试请求
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5分钟超时

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      console.log(`[Model Test] Response status: ${response.status}`);
      console.log(`[Model Test] Response body:`, responseText.substring(0, 500));

      if (response.ok) {
        return NextResponse.json({
          success: true,
          message: '模型连接成功',
          modelName,
          providerType: model.providerType,
        });
      } else {
        // 尝试解析错误响应
        let errorDetails = responseText;
        try {
          const errorJson = JSON.parse(responseText);
          errorDetails = errorJson.error?.message || errorJson.message || responseText;
        } catch {
          // 保持原始文本
        }

        return NextResponse.json({
          success: false,
          message: '模型连接失败',
          error: `HTTP ${response.status}: ${errorDetails}`,
        }, { status: 200 });
      }
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      console.error(`[Model Test] Fetch error:`, fetchError);

      let errorMessage = '请求失败';
      if (fetchError.name === 'AbortError') {
        errorMessage = '大模型响应超时，请检查网络或使用更快的模型';
      }

      return NextResponse.json({
        success: false,
        message: errorMessage,
        error: fetchError.message || String(fetchError),
      }, { status: 200 });
    }
  } catch (error) {
    console.error('测试模型连接错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * API 适配器 - 根据不同的模型类型适配请求格式
 */
interface ApiAdapter {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function createApiAdapter(
  providerType: string,
  apiBaseUrl: string,
  apiKey: string,
  modelName: string
): ApiAdapter {
  const baseUrl = apiBaseUrl.trim().replace(/\/+$/, '');
  
  // 检测是否为兼容格式（如 GLM, DeepSeek 等使用 OpenAI 格式的 API）
  const isOpenAICompatible = isOpenAICompatibleApi(baseUrl);
  
  if (providerType === 'claude') {
    return createClaudeAdapter(baseUrl, apiKey, modelName);
  } else if (providerType === 'openai' || isOpenAICompatible) {
    return createOpenAIAdapter(baseUrl, apiKey, modelName);
  } else {
    // 默认使用 OpenAI 格式
    return createOpenAIAdapter(baseUrl, apiKey, modelName);
  }
}

/**
 * 检测是否为 OpenAI 兼容 API
 */
function isOpenAICompatibleApi(baseUrl: string): boolean {
  const knownPatterns = [
    'openai', 'anthropic', 'azure', 'google', 'meta',
    'deepseek', 'glm', 'qwen', 'moonshot', 'yi',
    'minimax', 'siliconflow', 'openrouter', 'vllm'
  ];
  
  const lowerUrl = baseUrl.toLowerCase();
  return knownPatterns.some(pattern => lowerUrl.includes(pattern)) ||
         lowerUrl.includes('v1/chat');
}

/**
 * Claude API 适配器
 */
function createClaudeAdapter(baseUrl: string, apiKey: string, modelName: string): ApiAdapter {
  let url = baseUrl;
  
  // Claude API 需要 /v1/messages 后缀
  if (!url.includes('/v1/messages')) {
    url = `${url}/v1/messages`;
  }
  
  return {
    url,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: {
      model: modelName,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    },
  };
}

/**
 * OpenAI API 适配器（包括兼容格式）
 */
function createOpenAIAdapter(baseUrl: string, apiKey: string, modelName: string): ApiAdapter {
  let url = baseUrl;
  
  // 自动添加正确的路径后缀
  if (!url.includes('/v1/chat/completions') && 
      !url.includes('/chat/completions') && 
      !url.includes('/completions')) {
    if (url.endsWith('/v1')) {
      url = `${url}/chat/completions`;
    } else if (!url.includes('/v1')) {
      url = `${url}/v1/chat/completions`;
    } else {
      url = `${url}/chat/completions`;
    }
  }
  
  return {
    url,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      model: modelName,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    },
  };
}