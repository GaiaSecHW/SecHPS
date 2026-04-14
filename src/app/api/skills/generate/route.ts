import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * 生成 Skill 定义 API
 * POST /api/skills/generate
 * 
 * 调用大模型生成完整的 Skill 定义
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
    const { intent, research } = body;

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

    // 构建提示词
    const systemPrompt = `你是一个专业的 AI Skill 设计专家。你的任务是根据用户的需求生成一个完整的、高质量的 Skill 定义。

Skill 是一个可被 AI 代理调用的能力单元，需要包含：
1. name: 技能标识符（kebab-case 格式，如 "java-cmd-injection-audit"）
2. displayName: 显示名称（简短描述性名称）
3. description: 详细描述（说明功能、触发场景、适用范围）
4. category: 分类（如 code-audit, web-security, api-security 等）
5. cwe: CWE 编号（如果适用）
6. systemPrompt: 系统提示词（指导 AI 如何执行这个 Skill）
7. userPrompt: 用户提示词模板（包含 {{input}} 占位符）
8. tools: 需要的工具列表（如 ["read_file", "search_pattern", "bash"]）

请按照以下 JSON 格式返回（只返回 JSON，不要添加其他文字）：
{
  "name": "skill-name",
  "displayName": "显示名称",
  "description": "详细描述...",
  "category": "code-audit",
  "cwe": "CWE-78",
  "systemPrompt": "系统提示词...",
  "userPrompt": "用户提示词模板...",
  "tools": ["tool1", "tool2"]
}`;

    const userPrompt = `请根据以下需求生成 Skill 定义：

## 用户意图
- 名称: ${intent.name || '未命名'}
- 描述: ${intent.description || '无'}
- 分类: ${intent.category || 'code-audit'}
- 功能说明: ${intent.whatDoesItDo || '无'}
- 触发条件: ${intent.whenShouldItTrigger || '无'}
- 期望输出: ${intent.expectedOutput || '无'}

## 研究结果
${research ? `
- 边缘情况: ${research.edgeCases?.join(', ') || '无'}
- 输入输出格式: ${research.inputOutputFormats || '无'}
- 成功标准: ${research.successCriteria?.join(', ') || '无'}
- 依赖项: ${research.dependencies?.join(', ') || '无'}
` : '未提供'}

请生成一个专业、完整、可直接使用的 Skill 定义。`;

    // 调用大模型
    console.log('[generate] 开始调用大模型...');
    const response = await callModel(modelConfig, systemPrompt, userPrompt);
    console.log('[generate] 大模型响应完成');

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

    const parsedSkill = JSON.parse(jsonStr);

    // 验证必要字段
    if (!parsedSkill.name || !parsedSkill.systemPrompt) {
      throw new Error('生成的 Skill 缺少必要字段');
    }

    // 构建完整的 Markdown 内容（包含所有详细信息）
    const fullContent = buildFullContent(parsedSkill);

    // 构建返回的 skill 对象
    const skill = {
      name: parsedSkill.name,
      displayName: parsedSkill.displayName || parsedSkill.name,
      description: parsedSkill.description || intent.description || '', // 简短描述，用于列表显示
      category: parsedSkill.category || intent.category || 'code-audit',
      cwe: parsedSkill.cwe,
      content: fullContent, // 完整的 Markdown 内容
    };

    console.log('[generate] Skill 生成成功:', skill.name);
    return NextResponse.json({ skill });
  } catch (error) {
    console.error('[generate] 生成 Skill 失败:', error);
    
    // 友好的错误信息
    let errorMessage = '生成失败';
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = '大模型响应超时，请稍后重试或使用更快的模型';
      } else if (error.message === 'fetch failed' || error.cause instanceof Error && error.cause.name === 'AbortError') {
        errorMessage = '大模型响应超时，请稍后重试或使用更快的模型';
      } else if (error.message.includes('fetch failed')) {
        errorMessage = '大模型连接失败，请检查网络或 API 配置';
      } else {
        errorMessage = `生成失败: ${error.message}`;
      }
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * 构建完整的 Markdown 内容
 */
function buildFullContent(skill: any): string {
  const lines: string[] = [];
  
  lines.push(`# ${skill.displayName || skill.name}`);
  lines.push('');
  
  // 基本信息
  if (skill.description) {
    lines.push('## 描述');
    lines.push(skill.description);
    lines.push('');
  }
  
  if (skill.cwe) {
    lines.push('## CWE');
    lines.push(skill.cwe);
    lines.push('');
  }
  
  // 系统提示词
  if (skill.systemPrompt) {
    lines.push('## 系统提示词');
    lines.push('```');
    lines.push(skill.systemPrompt);
    lines.push('```');
    lines.push('');
  }
  
  // 用户提示词
  if (skill.userPrompt) {
    lines.push('## 用户提示词模板');
    lines.push('```');
    lines.push(skill.userPrompt);
    lines.push('```');
    lines.push('');
  }
  
  // 工具
  if (skill.tools && skill.tools.length > 0) {
    lines.push('## 所需工具');
    skill.tools.forEach((tool: string) => {
      lines.push(`- ${tool}`);
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

      console.log('[generate] Claude API URL:', apiUrl);

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

      console.log('[generate] OpenAI API URL:', apiUrl);

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
