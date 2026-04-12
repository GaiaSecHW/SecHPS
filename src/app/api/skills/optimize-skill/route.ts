import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * 优化完整 Skill 的 API
 * POST /api/skills/optimize-skill
 * 
 * 让大模型优化整个 Skill 定义，包括：
 * - 名称、描述
 * - 系统提示词
 * - 用户提示词
 * - 工具列表
 * - 触发关键词
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

    // 构建提示词
    const systemPrompt = `你是一个专业的 AI Skill 优化专家。你的任务是在用户已有 Skill 内容的基础上进行优化和补充，而不是推翻重写。

## 核心原则
1. **保留用户意图**：用户已经写好的内容代表他的意图，必须完整保留，不得删除或替换
2. **补充遗漏**：如果用户内容有缺失的部分（如缺少系统提示词、工具列表等），在不改变现有内容的前提下补充完整
3. **优化表达**：可以改善措辞、补充细节、使描述更清晰，但不改变原有语义
4. **提升触发准确性**：在现有描述基础上补充触发关键词，使 Skill 更容易被正确识别
5. **禁止推翻重写**：不允许因为"觉得自己写得更好"就删掉用户内容重新写一套

## 优化优先级
- 高优先级：补充明显缺失的字段、修复明显错误
- 中优先级：丰富系统提示词的检测细节、补充边缘案例
- 低优先级：润色描述文字

请按照以下 JSON 格式返回优化后的 Skill 定义（只返回 JSON）：
{
  "name": "skill-name",
  "displayName": "显示名称",
  "description": "优化后的描述（保留用户原意）",
  "category": "code-audit",
  "cwe": "CWE-78",
  "systemPrompt": "在用户原有系统提示词基础上优化补充...",
  "userPrompt": "在用户原有用户提示词基础上优化补充...",
  "tools": ["tool1", "tool2"],
  "triggerKeywords": ["关键词1", "关键词2"],
  "triggerAccuracy": 0.92,
  "suggestions": ["补充了哪些内容", "优化了哪些表达"],
  "changes": ["本次主要改动说明，明确哪些是新增，哪些是保留"]
}`;

    // 构建用户提示词，包含当前 Skill 的完整信息
    let userPrompt = `请在以下用户已编写的 Skill 内容基础上进行优化补充，不得删除用户已有内容：

## 用户当前编写的完整 Skill 内容（必须保留，只可补充优化）
\`\`\`
${skillData.content || skillData.systemPrompt || '（空）'}
\`\`\`

## Skill 基本信息
- 名称: ${skillData.name || '未命名'}
- 显示名称: ${skillData.displayName || '未命名'}
- 描述: ${skillData.description || '无'}
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

    // 添加评估结果（关键数据）
    if (evaluationData && evaluationData.runs && evaluationData.runs.length > 0) {
      userPrompt += `\n\n## 评估结果分析`;
      
      const completedRuns = evaluationData.runs.filter((r: any) => r.status === 'completed');
      const failedRuns = evaluationData.runs.filter((r: any) => r.status === 'failed');
      const withSkillRuns = completedRuns.filter((r: any) => r.type === 'with_skill');
      const withoutSkillRuns = completedRuns.filter((r: any) => r.type === 'without_skill');
      
      userPrompt += `\n- 完成的测试: ${completedRuns.length} 个`;
      userPrompt += `\n- 失败的测试: ${failedRuns.length} 个`;
      userPrompt += `\n- 使用 Skill 的测试: ${withSkillRuns.length} 个`;
      userPrompt += `\n- 不使用 Skill 的测试: ${withoutSkillRuns.length} 个`;
      
      // 添加具体的输出对比
      if (withSkillRuns.length > 0 && withoutSkillRuns.length > 0) {
        userPrompt += `\n\n### 输出对比示例`;
        withSkillRuns.slice(0, 2).forEach((run: any) => {
          const correspondingWithout = withoutSkillRuns.find((r: any) => r.testCaseId === run.testCaseId);
          if (run.output || correspondingWithout?.output) {
            userPrompt += `\n\n**测试: ${testCases?.find((tc: any) => tc.id === run.testCaseId)?.name || '未知'}**`;
            if (run.output) {
              userPrompt += `\n使用 Skill 输出: ${run.output.substring(0, 500)}${run.output.length > 500 ? '...' : ''}`;
            }
            if (correspondingWithout?.output) {
              userPrompt += `\n不使用 Skill 输出: ${correspondingWithout.output.substring(0, 300)}${correspondingWithout.output.length > 300 ? '...' : ''}`;
            }
          }
        });
      }
      
      // 添加失败原因分析
      if (failedRuns.length > 0) {
        userPrompt += `\n\n### 失败原因`;
        failedRuns.slice(0, 3).forEach((run: any) => {
          userPrompt += `\n- ${testCases?.find((tc: any) => tc.id === run.testCaseId)?.name || '未知'}: ${run.error || '未知错误'}`;
        });
      }
    }

    // 添加迭代历史（用户反馈）
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

    userPrompt += `\n\n请根据以上所有信息，特别是评估结果和用户反馈，优化整个 Skill 定义，解决发现的问题，提高触发准确性和执行效果。`;

    // 调用大模型
    console.log('[optimize-skill] 开始调用大模型...');
    const response = await callModel(modelConfig, systemPrompt, userPrompt);
    console.log('[optimize-skill] 大模型响应完成');

    // 解析响应
    const content = response.content || response.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('模型响应为空');
    }

    // 提取文本内容
    let textContent = '';
    if (Array.isArray(content)) {
      const textBlock = content.find((block: any) => block.type === 'text');
      textContent = textBlock?.text || '';
    } else {
      textContent = content;
    }

    // 解析 JSON
    let jsonStr = textContent.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    const result = JSON.parse(jsonStr);

    // 验证必要字段
    if (!result.systemPrompt) {
      throw new Error('优化结果缺少系统提示词');
    }

    console.log('[optimize-skill] Skill 优化成功');
    
    // 构建完整的 content 字段
    const optimizedContent = buildOptimizedContent(result);
    
    return NextResponse.json({
      optimizedSkill: {
        name: result.name || skillData.name,
        displayName: result.displayName || skillData.displayName,
        description: result.description || skillData.description,
        category: result.category || skillData.category,
        cwe: result.cwe || skillData.cwe,
        content: optimizedContent, // 添加完整的 content
        systemPrompt: result.systemPrompt,
        userPrompt: result.userPrompt || skillData.userPrompt,
        tools: result.tools || skillData.tools || [],
        triggerKeywords: result.triggerKeywords || [],
      },
      triggerAccuracy: result.triggerAccuracy || 0.85,
      suggestions: result.suggestions || [],
    });
  } catch (error) {
    console.error('[optimize-skill] 优化失败:', error);
    return NextResponse.json(
      { error: `优化失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}

/**
 * 构建优化后的完整 content
 */
function buildOptimizedContent(result: any): string {
  const lines: string[] = [];
  
  lines.push(`# ${result.displayName || result.name}`);
  lines.push('');
  
  if (result.description) {
    lines.push('## 描述');
    lines.push(result.description);
    lines.push('');
  }
  
  if (result.cwe) {
    lines.push('## CWE');
    lines.push(result.cwe);
    lines.push('');
  }
  
  if (result.systemPrompt) {
    lines.push('## 系统提示词');
    lines.push('```');
    lines.push(result.systemPrompt);
    lines.push('```');
    lines.push('');
  }
  
  if (result.userPrompt) {
    lines.push('## 用户提示词模板');
    lines.push('```');
    lines.push(result.userPrompt);
    lines.push('```');
    lines.push('');
  }
  
  if (result.tools && result.tools.length > 0) {
    lines.push('## 所需工具');
    result.tools.forEach((tool: string) => {
      lines.push(`- ${tool}`);
    });
    lines.push('');
  }
  
  if (result.triggerKeywords && result.triggerKeywords.length > 0) {
    lines.push('## 触发关键词');
    result.triggerKeywords.forEach((keyword: string) => {
      lines.push(`- ${keyword}`);
    });
    lines.push('');
  }
  
  return lines.join('\n');
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
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 3分钟超时

  try {
    if (config.providerType === 'claude') {
      let apiUrl = config.apiBaseUrl;
      if (!apiUrl.includes('/v1/messages') && !apiUrl.endsWith('/messages')) {
        apiUrl = apiUrl.replace(/\/$/, '') + '/v1/messages';
      }

      console.log('[optimize-skill] Claude API URL:', apiUrl);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.defaultModel,
          max_tokens: 8192,
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

      console.log('[optimize-skill] OpenAI API URL:', apiUrl);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.defaultModel,
          max_tokens: 8192,
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
