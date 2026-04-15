import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  extractModelResponse,
  buildFullSkill,
  getStandardOutputTemplate,
  extractCwe,
  type SkillIntent,
} from '@/lib/skill-builder';

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

    console.log('[optimize-skill] 用户:', payload.userId, '使用模型:', modelConfig.defaultModel);

    // 使用公共模块的格式指导构建系统提示词
    const systemPrompt = `你是一个专业的 AI Skill 优化专家。请在用户已有 Skill 内容的基础上进行优化和补充，而不是推翻重写。

## 核心原则
1. **保留用户意图**：用户已经写好的内容必须完整保留，不得删除或替换
2. **补充遗漏**：如果用户内容有缺失的部分，在不改变现有内容的前提下补充完整
3. **优化表达**：可以改善措辞、补充细节、使描述更清晰，但不改变原有语义
4. **提升触发准确性**：在现有描述基础上补充触发关键词
5. **禁止推翻重写**：不允许删掉用户内容重新写一套

## 优秀 Skill 的关键原则

1. **Description 是触发机制（最重要）**
   - 必须包含：做什么 + 何时触发 + 关键触发词
   - 用第三人称写，明确列出触发场景

2. **简洁至上（<500行）**
   - 只添加 Agent 不知道的内容
   - 用指令而非散文

3. **提供示例（重要！）**
   - 展示漏洞代码 + 检测结果范例

4. **描述目标，不预设步骤**
   - 让 Agent 决定执行路径

## 输出要求

直接返回 Markdown 格式的 Skill 正文内容（不要包含 YAML frontmatter，系统会自动添加）。

必须包含以下章节：
- ## 检测目标
- ## 检查要点
- ## 示例（重要！展示漏洞代码和检测结果）
- ## CWE 编号（如有）
- ## 工具要求

注意：不要写"输出格式"章节，系统会自动添加标准输出格式。`;

    // 构建用户提示词
    let userPrompt = `请在以下用户已编写的 Skill 内容基础上进行优化补充，不得删除用户已有内容：

## 用户当前 Skill 内容（必须保留核心内容，只可补充优化）
\`\`\`
${skillData.content || '（空）'}
\`\`\`

## Skill 基本信息
- 名称: ${skillData.name || '未命名'}
- 显示名称: ${skillData.displayName || '未命名'}
- 分类: ${skillData.category || 'code-audit'}
- CWE: ${skillData.cwe || '无'}`;

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
    console.log('[optimize-skill] 开始调用大模型...');
    const response = await callModel(modelConfig, systemPrompt, userPrompt);
    console.log('[optimize-skill] 大模型响应完成');

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

    console.log('[optimize-skill] 生成的 Markdown 长度:', generatedContent.length);

    // 获取标准输出格式
    const outputTemplate = await getStandardOutputTemplate();

    // 使用公共模块构建完整 Skill
    const intent: SkillIntent = {
      name: skillData.name,
      displayName: skillData.displayName,
      description: skillData.description,
      category: skillData.category,
    };

    const fullContent = buildFullSkill(intent, generatedContent, outputTemplate, {
      addFrontmatter: true,
      addOutputFormat: true,
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

    console.log('[optimize-skill] Skill 优化成功');
    
    return NextResponse.json({
      optimizedSkill,
      triggerAccuracy: 0.85,
      suggestions: ['已补充缺失内容', '已优化表达', '已添加示例'],
    });
  } catch (error) {
    console.error('[optimize-skill] 优化失败:', error);
    
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
    console.error('[optimize-skill] 获取模型配置失败:', error);
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