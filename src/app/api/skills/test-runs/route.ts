import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

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
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的 token' } }, { status: 401 });
    }

    const body = await request.json();
    const { testCase, skillData, runType } = body;

    if (!testCase || !skillData) {
      return NextResponse.json({ details: { error: '缺少必要参数' } }, { status: 400 });
    }

    const startTime = Date.now();

    // 获取模型配置
    const modelConfig = await getModelConfig();
    
    if (!modelConfig) {
      return NextResponse.json(
        { details: { error: '模型配置不存在，请先在系统设置中配置 AI 模型' } },
        { status: 500 }
      );
    }

    logger.debug(LOG_MODULES.SKILL, '用户使用模型', { userId: payload.userId, details: { model: modelConfig.defaultModel, provider: modelConfig.providerType } });
    
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

    logger.debug(LOG_MODULES.SKILL, '发送的提示词', { details: { promptLength: prompt.length, promptPreview: prompt.substring(0, 200) } });

    // 调用大模型
    const output = await callModelForTest(modelConfig, prompt);
    const duration = Date.now() - startTime;

    return NextResponse.json({
      output,
      duration,
      tokens: 0,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '测试运行失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    
    // 友好的错误信息
    let errorMessage = '测试运行失败';
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = '大模型响应超时，请稍后重试或使用更快的模型';
      } else if (error.message === 'fetch failed' || error.cause instanceof Error && error.cause.name === 'AbortError') {
        errorMessage = '大模型响应超时，请稍后重试或使用更快的模型';
      } else if (error.message.includes('fetch failed')) {
        errorMessage = '大模型连接失败，请检查网络或 API 配置';
      } else {
        errorMessage = `测试运行失败: ${error.message}`;
      }
    }
    
    return NextResponse.json(
      { details: { error: errorMessage } },
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
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的 token' } }, { status: 401 });
    }

    // TODO: 未来可从数据库读取用户的历史评估记录
    return NextResponse.json({
      runs: [],
      notes: '评估数据由大模型实时生成',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取评估列表失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { details: { error: '获取评估列表失败' } },
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
      logger.errorNoUser(LOG_MODULES.SKILL, '获取模型配置失败', { details: { error: error instanceof Error ? error.message : String(error) } });
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
  // 设置 10 分钟超时
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000);

  try {
    if (config.providerType === 'claude') {
      // Claude API 格式
      let apiUrl = config.apiBaseUrl;
      if (!apiUrl.includes('/v1/messages') && !apiUrl.endsWith('/messages')) {
        apiUrl = apiUrl.replace(/\/$/, '') + '/v1/messages';
      }

      logger.debug(LOG_MODULES.SKILL, 'Claude API URL', { details: { apiUrl } });
      logger.debug(LOG_MODULES.SKILL, '开始调用模型');

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.defaultModel,
          max_tokens: 32000,
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

      logger.debug(LOG_MODULES.SKILL, '收到响应，开始解析');
      const data = await response.json();
      logger.debug(LOG_MODULES.SKILL, '响应解析完成');
      
      // 检查是否因为 token 限制被截断
      const stopReason = data.stop_reason || data.choices?.[0]?.finish_reason;
      if (stopReason === 'max_tokens' || stopReason === 'length') {
        logger.errorNoUser(LOG_MODULES.SKILL, 'Claude 响应被截断', { details: { stopReason } });
        throw new Error('模型输出达到 token 限制被截断');
      }
      
      // 解析响应 - Claude 格式 content 数组
      if (data.content && Array.isArray(data.content)) {
        const textBlock = data.content.find((block: any) => block.type === 'text');
        if (textBlock?.text) {
          logger.debug(LOG_MODULES.SKILL, '输出长度', { details: { length: textBlock.text.length } });
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

      logger.debug(LOG_MODULES.SKILL, 'OpenAI API URL', { details: { apiUrl } });
      logger.debug(LOG_MODULES.SKILL, '开始调用模型');

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.defaultModel,
          max_tokens: 32000,
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

      logger.debug(LOG_MODULES.SKILL, '收到响应，开始解析');
      const data = await response.json();
      logger.debug(LOG_MODULES.SKILL, '响应解析完成');
      
      // 检查是否因为 token 限制被截断
      const stopReason = data.stop_reason || data.choices?.[0]?.finish_reason;
      if (stopReason === 'max_tokens' || stopReason === 'length') {
        logger.errorNoUser(LOG_MODULES.SKILL, 'OpenAI 响应被截断', { details: { stopReason } });
        throw new Error('模型输出达到 token 限制被截断');
      }

      const content = data.choices?.[0]?.message?.content || '';
      logger.debug(LOG_MODULES.SKILL, '输出长度', { details: { length: content.length } });
      return content;
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
