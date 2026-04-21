import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildFullSkill,
  getStandardOutputTemplate,
  extractModelResponse,
  extractCwe,
  type SkillIntent,
} from '@/lib/skill-builder';
import { routeRequestWithDefaultModel, getDefaultModelInfo, RouteError } from '@/lib/model-client';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 生成 Skill 定义 API
 * POST /api/skills/generate
 * 
 * 调用大模型生成完整的 Skill 定义
 * 使用 skill-builder 公共模块自动补齐 YAML 和输出格式
 */
export async function POST(request: NextRequest) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const body = await request.json();
    const { intent, skillOutputTemplate: customOutputTemplate } = body;

    if (!intent) {
      return NextResponse.json({ details: { error: '缺少意图数据' } }, { status: 400 });
    }

    // 获取模型配置
    const modelInfo = await getDefaultModelInfo();
    if (!modelInfo) {
      logger.errorNoUser(LOG_MODULES.SKILL, '模型配置不存在');
      return NextResponse.json(
        { details: { error: '模型配置不存在，请先在系统设置中配置 AI 模型' } },
        { status: 500 }
      );
    }

    // 详细日志：模型配置信息
    logger.debug(LOG_MODULES.SKILL, '========== Skill 生成模型配置 ==========');
    logger.debug(LOG_MODULES.SKILL, 'Provider Type', { details: { providerType: modelInfo.providerType } });
    logger.debug(LOG_MODULES.SKILL, 'API Base URL', { details: { apiBaseUrl: modelInfo.apiBaseUrl } });
    logger.debug(LOG_MODULES.SKILL, 'Default Model', { details: { defaultModel: modelInfo.defaultModel } });
    logger.debug(LOG_MODULES.SKILL, 'API Key (前8位)', { details: { apiKeyPrefix: modelInfo.apiKey?.substring(0, 8) + '...' } });
    logger.debug(LOG_MODULES.SKILL, '=========================================');

    logger.debug(LOG_MODULES.SKILL, '用户使用模型', { userId: payload.userId, details: { model: modelInfo.defaultModel } });

    // 使用公共模块构建提示词
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(intent as SkillIntent);

    // 获取标准输出格式（优先使用自定义，其次使用系统配置）
    let outputTemplate = customOutputTemplate;
    if (!outputTemplate) {
      outputTemplate = await getStandardOutputTemplate();
    }

    // 调用大模型（使用统一的 model-client，自动统计 Token）
    // max_tokens 和 temperature 从模型配置中读取
    logger.debug(LOG_MODULES.SKILL, '开始调用大模型');
    const response = await routeRequestWithDefaultModel(
      [{ role: 'user', content: userPrompt }],
      {
        system: systemPrompt,
        // max_tokens 和 temperature 从模型配置中读取，不再硬编码
        context: {
          userId: payload.userId,
          username: payload.username,
          scene: 'skill-generate',
          description: `Skill生成: ${intent.name || '未命名'}`,
        },
      }
    );
    logger.debug(LOG_MODULES.SKILL, '大模型响应完成');

    // 检查是否被截断
    const stopReason = response.stop_reason || response.choices?.[0]?.finish_reason;
    if (stopReason === 'max_tokens' || stopReason === 'length') {
      throw new Error('模型输出达到 token 限制被截断，请增加 max_tokens 配置');
    }

    // 使用公共模块提取响应内容
    const generatedContent = extractModelResponse(response);
    
    if (!generatedContent || generatedContent.trim() === '') {
      throw new Error('模型响应为空，请检查模型配置或重试');
    }

    logger.debug(LOG_MODULES.SKILL, '生成的 Markdown 长度', { details: { length: generatedContent.length } });

    // 使用公共模块构建 Skill（不拼接输出格式，输出格式由前端动态拼接）
    const fullContent = buildFullSkill(
      intent as SkillIntent,
      generatedContent,
      null, // 不传输出模板
      { addFrontmatter: true, addOutputFormat: false, addTitle: true }
    );

    // 构建返回对象
    const skillName = intent.name || 'generated-skill';
    const skill = {
      name: skillName,
      displayName: intent.name || skillName,
      description: intent.description || '',
      category: intent.category || 'code-audit',
      cwe: extractCwe(generatedContent),
      content: fullContent,
    };

    logger.logNoUser(LOG_MODULES.SKILL, 'Skill 生成成功', { details: { name: skill.name } });
    return NextResponse.json({ skill });
  } catch (error) {
    // 详细错误日志
    logger.errorNoUser(LOG_MODULES.SKILL, '========== Skill 生成失败 ==========');
    if (error instanceof Error) {
      logger.errorNoUser(LOG_MODULES.SKILL, 'Error name', { details: { name: error.name } });
      logger.errorNoUser(LOG_MODULES.SKILL, 'Error message', { details: { message: error.message } });
      logger.errorNoUser(LOG_MODULES.SKILL, 'Error stack', { details: { stack: error.stack?.substring(0, 500) } });
    } else {
      logger.errorNoUser(LOG_MODULES.SKILL, 'Unknown error', { details: { error: String(error) } });
    }
    logger.errorNoUser(LOG_MODULES.SKILL, '====================================');
    
    let errorMessage = '生成失败';
    let errorDetails: any = {};
    
    if (error instanceof Error) {
      errorDetails.name = error.name;
      errorDetails.message = error.message;
      
      if (error.name === 'AbortError') {
        errorMessage = '大模型响应超时，请稍后重试';
      } else if (error.message.includes('fetch failed')) {
        errorMessage = '大模型连接失败，请检查网络或 API 配置';
        errorDetails.hint = '请检查：1) API Base URL 是否正确 2) API Key 是否有效 3) 网络是否能访问模型服务';
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = '无法连接到模型服务，请检查 API 地址是否正确';
      } else if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
        errorMessage = '连接模型服务超时，请检查网络或重试';
      } else {
        errorMessage = `生成失败: ${error.message}`;
      }
    }
    
    return NextResponse.json({ details: { error: errorMessage, ...errorDetails } }, { status: 500 });
  }
}