import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { routeRequestWithDefaultModel, getDefaultModelInfo } from '@/lib/model-client';

/**
 * Skill 测试运行 API
 * POST /api/skills/test-runs
 * 
 * 真实调用大模型进行 Skill 测试，支持多用户并发
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponseNested(auth);
    }
    const { payload } = auth;

    const body = await request.json();
    const { testCase, skillData, runType } = body;

    if (!testCase || !skillData) {
      return NextResponse.json({ details: { error: '缺少必要参数' } }, { status: 400 });
    }

    const startTime = Date.now();

    // 获取模型配置
    const modelInfo = await getDefaultModelInfo();
    
    if (!modelInfo) {
      return NextResponse.json(
        { details: { error: '模型配置不存在，请先在系统设置中配置 AI 模型' } },
        { status: 500 }
      );
    }

    logger.debug(LOG_MODULES.SKILL, '用户使用模型', { userId: payload.userId, details: { model: modelInfo.defaultModel, provider: modelInfo.providerType } });
    
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

    // 调用大模型（使用统一的 model-client，自动统计 Token）
    // max_tokens 和 temperature 从模型配置中读取
    const response = await routeRequestWithDefaultModel(
      [{ role: 'user', content: prompt }],
      {
        // max_tokens 和 temperature 从模型配置中读取，不再硬编码
        context: {
          userId: payload.userId,
          username: payload.username,
          scene: 'skill-test',
          description: `Skill测试: ${skillData.name || '未命名'}`,
        },
      }
    );
    
    // 解析响应
    let output = '';
    if (response.content && Array.isArray(response.content)) {
      // Claude 格式
      const textBlock = response.content.find((block: any) => block.type === 'text');
      output = textBlock?.text || '';
    } else {
      // OpenAI 格式
      output = response.choices?.[0]?.message?.content || '';
    }
    
    const duration = Date.now() - startTime;
    logger.debug(LOG_MODULES.SKILL, '输出长度', { details: { length: output.length } });

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
    // Authenticate
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponseNested(auth);
    }
    const { payload } = auth;

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
