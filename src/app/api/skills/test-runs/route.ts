import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Skill 测试运行 API
 * POST /api/skills/test-runs
 * 
 * 真实调用大模型进行 Skill 测试，支持多用户并发
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的 token' }, { status: 401 });
    }

    const body = await request.json();
    const { testCase, skillData, runType } = body;

    if (!testCase || !skillData) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const startTime = Date.now();

    // 获取模型配置
    const modelConfig = await getModelConfig();
    
    if (!modelConfig) {
      return NextResponse.json(
        { error: '模型配置不存在，请先在系统设置中配置 AI 模型' },
        { status: 500 }
      );
    }

    console.log('[test-runs] 用户:', payload.userId, '使用模型:', modelConfig.defaultModel, '提供商:', modelConfig.providerType);
    
    // 构建提示词
    let prompt = '';
    if (runType === 'with_skill' && skillData.systemPrompt) {
      prompt = `${skillData.systemPrompt}\n\n用户请求: ${testCase.prompt}`;
    } else {
      prompt = testCase.prompt;
    }

    // 添加测试文件内容（如果有）
    if (testCase.testFiles && testCase.testFiles.length > 0) {
      prompt += '\n\n测试文件:\n';
      testCase.testFiles.forEach((file: string) => {
        prompt += `- ${file}\n`;
      });
    }

    // 添加期望输出（如果有）
    if (testCase.expectedOutput) {
      prompt += `\n\n期望输出格式:\n${testCase.expectedOutput}`;
    }

    console.log('[test-runs] 发送的提示词长度:', prompt.length);
    console.log('[test-runs] 提示词内容:', prompt.substring(0, 500) + '...');

    // 调用大模型
    const output = await callModelForTest(modelConfig, prompt);
    const duration = Date.now() - startTime;

    return NextResponse.json({
      output,
      duration,
      tokens: 0,
    });
  } catch (error) {
    console.error('[test-runs] 测试运行失败:', error);
    return NextResponse.json(
      { error: `测试运行失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}

/**
 * GET 接口 - 获取评估运行列表（当前返回空，未来可实现持久化存储）
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的 token' }, { status: 401 });
    }

    // TODO: 未来可从数据库读取用户的历史评估记录
    return NextResponse.json({
      runs: [],
      notes: '评估数据由大模型实时生成',
    });
  } catch (error) {
    console.error('[test-runs] 获取评估列表失败:', error);
    return NextResponse.json(
      { error: '获取评估列表失败' },
      { status: 500 }
    );
  }
}

/**
 * 获取模型配置（从数据库，支持多用户共享）
 */
async function getModelConfig(): Promise<{
  providerType: string;
  apiKey: string;
  apiBaseUrl: string;
  defaultModel: string;
} | null> {
  try {
    const config = await prisma.modelConfig.findFirst({
      where: { isActive: true, isDefault: true },
    });

    if (config) {
      let models: string[] = ['default'];
      try {
        const parsed = JSON.parse(config.models);
        models = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        models = [config.models || 'default'];
      }

      return {
        providerType: config.providerType,
        apiKey: config.apiKey,
        apiBaseUrl: config.apiBaseUrl,
        defaultModel: models[0] || 'default',
      };
    }
  } catch (error) {
    console.error('[test-runs] 获取模型配置失败:', error);
  }

  return null;
}

/**
 * 调用大模型进行测试（无状态，支持并发）
 */
async function callModelForTest(
  config: { providerType: string; apiKey: string; apiBaseUrl: string; defaultModel: string },
  prompt: string
): Promise<string> {
  // 设置 2 分钟超时
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    if (config.providerType === 'claude') {
      // Claude API 格式
      let apiUrl = config.apiBaseUrl;
      if (!apiUrl.includes('/v1/messages') && !apiUrl.endsWith('/messages')) {
        apiUrl = apiUrl.replace(/\/$/, '') + '/v1/messages';
      }

      console.log('[test-runs] Claude API URL:', apiUrl);
      console.log('[test-runs] 开始调用模型...');

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.defaultModel,
          max_tokens: 4096,
          messages: [
            { role: 'user', content: prompt }
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API 错误 (${response.status}): ${errorText}`);
      }

      console.log('[test-runs] 收到响应，开始解析...');
      const data = await response.json();
      console.log('[test-runs] 响应解析完成');
      
      // 解析响应 - Claude 格式 content 数组
      if (data.content && Array.isArray(data.content)) {
        const textBlock = data.content.find((block: any) => block.type === 'text');
        if (textBlock?.text) {
          console.log('[test-runs] 输出长度:', textBlock.text.length);
          return textBlock.text;
        }
      }
      throw new Error('无法解析模型响应');
    } else {
      // OpenAI 格式
      let apiUrl = config.apiBaseUrl;
      if (!apiUrl.endsWith('/chat/completions')) {
        apiUrl = apiUrl.replace(/\/$/, '') + '/v1/chat/completions';
      }

      console.log('[test-runs] OpenAI API URL:', apiUrl);
      console.log('[test-runs] 开始调用模型...');

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.defaultModel,
          max_tokens: 4096,
          messages: [
            { role: 'user', content: prompt }
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 错误 (${response.status}): ${errorText}`);
      }

      console.log('[test-runs] 收到响应，开始解析...');
      const data = await response.json();
      console.log('[test-runs] 响应解析完成');

      const content = data.choices?.[0]?.message?.content || '';
      console.log('[test-runs] 输出长度:', content.length);
      return content;
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
