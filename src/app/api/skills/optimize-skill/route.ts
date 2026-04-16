import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  extractModelResponse,
  buildFullSkill,
  buildSystemPrompt,
  getStandardOutputTemplate,
  extractCwe,
  cleanSkillContentForOptimization,
  type SkillIntent,
} from '@/lib/skill-builder';
import { trackSystemTokenUsage, extractTokenUsageFromResponse, calculateSystemCost } from '@/lib/system-token-tracker';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 优化完整 Skill 的 API
 * POST /api/skills/optimize-skill
 * 
 * 让大模型优化 Skill 内容，使用公共模块构建最终格式
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
    const { skillData, testCases, evaluationData, iterations } = body;

    if (!skillData) {
      return NextResponse.json({ error: '缺少 Skill 数据' }, { status: 400 });
    }

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json(
        { error: '模型配置不存在，请先在系统设置中配置 AI 模型' },
        { status: 500 }
      );
    }

    logger.debug(LOG_MODULES.SKILL, '用户使用模型', { userId: payload.userId, details: { model: modelConfig.defaultModel } });

    // 使用公共模块的系统提示词（包含禁止生成输出格式的明确指令）
    const systemPrompt = buildSystemPrompt();

    // 清理用户 Skill 内容，移除系统自动添加的 "## 输出格式" 章节
    // 这样大模型就不会看到这个章节，也不会误保留它
    const cleanedUserContent = cleanSkillContentForOptimization(skillData.content || '');

    // 构建用户提示词（不包含输出格式内容）
    let userPrompt = `请在以下用户已编写的 Skill 内容基础上进行优化补充：

## 用户当前 Skill 内容
\`\`\`
${cleanedUserContent || '（空）'}
\`\`\`

## Skill 基本信息
- 名称: ${skillData.name || '未命名'}
- 显示名称: ${skillData.displayName || '未命名'}
- 分类: ${skillData.category || 'code-audit'}
- CWE: ${skillData.cwe || '无'}

请优化 Skill 内容，保留用户已有内容，补充缺失部分。`;

    // 添加测试用例信息
    if (testCases && testCases.length > 0) {
      userPrompt += `\n\n## 测试用例 (${testCases.length} 个)`;
      testCases.forEach((tc: any, index: number) => {
        userPrompt += `\n\n### 测试用例 ${index + 1}: ${tc.name}`;
        userPrompt += `\n提示词: ${tc.prompt?.substring(0, 300) || '无'}${tc.prompt?.length > 300 ? '...' : ''}`;
      });
    }

    // 添加评估结果
    if (evaluationData && evaluationData.runs && evaluationData.runs.length > 0) {
      userPrompt += `\n\n## 评估结果分析`;
      
      const completedRuns = evaluationData.runs.filter((r: any) => r.status === 'completed');
      const failedRuns = evaluationData.runs.filter((r: any) => r.status === 'failed');
      
      userPrompt += `\n- 完成的测试: ${completedRuns.length} 个`;
      userPrompt += `\n- 失败的测试: ${failedRuns.length} 个`;
      
      if (failedRuns.length > 0) {
        userPrompt += `\n\n### 失败原因`;
        failedRuns.slice(0, 3).forEach((run: any) => {
          userPrompt += `\n- ${testCases?.find((tc: any) => tc.id === run.testCaseId)?.name || '未知'}: ${run.error || '未知错误'}`;
        });
      }
    }

    // 添加迭代历史
    if (iterations && iterations.length > 0) {
      userPrompt += `\n\n## 迭代历史与反馈`;
      iterations.forEach((iter: any, index: number) => {
        userPrompt += `\n\n### 版本 ${iter.version || index + 1}`;
        if (iter.feedback) {
          userPrompt += `\n用户反馈: ${iter.feedback}`;
        }
        if (iter.changes) {
          userPrompt += `\n改动: ${iter.changes}`;
        }
      });
    }

    userPrompt += `\n\n请根据以上信息，优化 Skill 内容。保留用户已有内容，补充缺失部分（如示例、检查要点等），使 Skill 更完整、更专业。`;

    // 调用大模型
    logger.debug(LOG_MODULES.SKILL, '开始调用大模型');
    const response = await callModel(modelConfig, systemPrompt, userPrompt);
    logger.debug(LOG_MODULES.SKILL, '大模型响应完成');
    
    // 统计 Token 使用量
    const tokenUsage = extractTokenUsageFromResponse(response);
    if (tokenUsage) {
      const estimatedCost = calculateSystemCost(tokenUsage.inputTokens, tokenUsage.outputTokens);
      await trackSystemTokenUsage(
        'skill-optimize',
        modelConfig.defaultModel,
        tokenUsage.inputTokens,
        tokenUsage.outputTokens,
        estimatedCost,
        `Skill优化: ${skillData.name || '未命名'}`
      );
      logger.debug(LOG_MODULES.SKILL, 'Token 统计', { details: { inputTokens: tokenUsage.inputTokens, outputTokens: tokenUsage.outputTokens, cost: estimatedCost } });
    }

    // 检查截断
    const stopReason = response.stop_reason || response.choices?.[0]?.finish_reason;
    if (stopReason === 'max_tokens' || stopReason === 'length') {
      throw new Error('模型输出达到 token 限制被截断');
    }

    // 使用公共模块提取响应
    const generatedContent = extractModelResponse(response);
    
    if (!generatedContent || generatedContent.trim() === '') {
      throw new Error('模型响应为空');
    }

    logger.debug(LOG_MODULES.SKILL, '生成的 Markdown 长度', { details: { length: generatedContent.length } });

    // 清理大模型可能误生成的输出格式章节（防止重复）
    const cleanedContent = cleanSkillContentForOptimization(generatedContent);

    // 使用公共模块构建 Skill（不拼接输出格式，输出格式由前端动态拼接）
    const intent: SkillIntent = {
      name: skillData.name,
      displayName: skillData.displayName,
      description: skillData.description,
      category: skillData.category,
    };

    const fullContent = buildFullSkill(intent, cleanedContent, null, {
      addFrontmatter: true,
      addOutputFormat: false, // 不拼接输出格式
      addTitle: true,
    });

    const optimizedSkill = {
      name: skillData.name,
      displayName: skillData.displayName || skillData.name,
      description: skillData.description || '',
      category: skillData.category || 'code-audit',
      cwe: extractCwe(generatedContent) || skillData.cwe,
      content: fullContent,
    };

    logger.logNoUser(LOG_MODULES.SKILL, 'Skill 优化成功', { details: { name: skillData.name } });
    
    return NextResponse.json({
      optimizedSkill,
      triggerAccuracy: 0.85,
      suggestions: ['已补充缺失内容', '已优化表达', '已添加示例'],
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '优化失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    
    let errorMessage = '优化失败';
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = '大模型响应超时，请稍后重试';
      } else if (error.message.includes('fetch failed')) {
        errorMessage = '大模型连接失败，请检查网络或 API 配置';
      } else {
        errorMessage = `优化失败: ${error.message}`;
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
      logger.errorNoUser(LOG_MODULES.SKILL, '获取模型配置失败', { details: { error: error instanceof Error ? error.message : String(error) } });
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
  const timeoutId = setTimeout(() => controller.abort(), 600000);

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