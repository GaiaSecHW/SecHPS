import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildFullSkill,
  getStandardOutputTemplate,
  extractModelResponse,
  extractCwe,
  type SkillIntent,
} from '@/lib/skill-builder';

/**
 * 生成 Skill 定义 API
 * POST /api/skills/generate
 * 
 * 调用大模型生成完整的 Skill 定义
 * 使用 skill-builder 公共模块自动补齐 YAML 和输出格式
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
    const { intent, skillOutputTemplate: customOutputTemplate } = body;

    if (!intent) {
      return NextResponse.json({ error: '缺少意图数据' }, { status: 400 });
    }

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json(
        { error: '模型配置不存在，请先在系统设置中配置 AI 模型' },
        { status: 500 }
      );
    }

    console.log('[generate] 用户:', payload.userId, '使用模型:', modelConfig.defaultModel);

    // 使用公共模块构建提示词
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(intent as SkillIntent);

    // 获取标准输出格式（优先使用自定义，其次使用系统配置）
    let outputTemplate = customOutputTemplate;
    if (!outputTemplate) {
      outputTemplate = await getStandardOutputTemplate();
    }

    // 调用大模型
    console.log('[generate] 开始调用大模型...');
    const response = await callModel(modelConfig, systemPrompt, userPrompt);
    console.log('[generate] 大模型响应完成');

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

    console.log('[generate] 生成的 Markdown 长度:', generatedContent.length);

    // 使用公共模块构建完整 Skill（自动补齐 YAML + 输出格式）
    const fullContent = buildFullSkill(
      intent as SkillIntent,
      generatedContent,
      outputTemplate,
      { addFrontmatter: true, addOutputFormat: true, addTitle: true }
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

    console.log('[generate] Skill 生成成功:', skill.name);
    return NextResponse.json({ skill });
  } catch (error) {
    console.error('[generate] 生成 Skill 失败:', error);
    
    let errorMessage = '生成失败';
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = '大模型响应超时，请稍后重试';
      } else if (error.message.includes('fetch failed')) {
        errorMessage = '大模型连接失败，请检查网络或 API 配置';
      } else {
        errorMessage = `生成失败: ${error.message}`;
      }
    }
    
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * 获取模型配置
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
    console.error('[generate] 获取模型配置失败:', error);
  }

  return null;
}

/**
 * 调用大模型
 */
async function callModel(
  config: { providerType: string; apiKey: string; apiBaseUrl: string; defaultModel: string },
  systemPrompt: string,
  userPrompt: string
): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10分钟超时

  try {
    if (config.providerType === 'claude') {
      let apiUrl = config.apiBaseUrl;
      if (!apiUrl.includes('/v1/messages') && !apiUrl.endsWith('/messages')) {
        apiUrl = apiUrl.replace(/\/$/, '') + '/v1/messages';
      }

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
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API 错误 (${response.status}): ${errorText}`);
      }

      return await response.json();
    } else {
      let apiUrl = config.apiBaseUrl;
      if (!apiUrl.endsWith('/chat/completions')) {
        apiUrl = apiUrl.replace(/\/$/, '') + '/v1/chat/completions';
      }

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
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 错误 (${response.status}): ${errorText}`);
      }

      return await response.json();
    }
  } finally {
    clearTimeout(timeoutId);
  }
}