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
    const { intent, research, skillOutputTemplate } = body;

    console.log('[generate] 接收到的 skillOutputTemplate 长度:', skillOutputTemplate?.length || 0);
    console.log('[generate] skillOutputTemplate 前100字符:', skillOutputTemplate?.substring(0, 100) || '无');

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
    let systemPrompt = `你是一个专业的 AI Skill 设计专家。你的任务是根据用户的需求生成一个完整的、高质量的 Skill 定义。

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

    // 如果有标准输出模板，添加到系统提示词中
    if (skillOutputTemplate && skillOutputTemplate.trim()) {
      console.log('[generate] 添加标准输出模板到系统提示词');
      systemPrompt += `\n\n## 重要：标准输出格式要求\n\n系统管理员定义了以下标准输出格式模板，生成的 Skill 必须严格遵循此格式：\n\n${skillOutputTemplate}\n\n请确保生成的 Skill 输出格式与上述模板保持一致。`;
    } else {
      console.log('[generate] 未提供标准输出模板');
    }

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
    console.log('[generate] 完整响应结构:', JSON.stringify(response, null, 2).substring(0, 1000));

    // 检查是否因为 token 限制被截断
    const stopReason = response.stop_reason || response.choices?.[0]?.finish_reason;
    if (stopReason === 'max_tokens' || stopReason === 'length') {
      console.error('[generate] 响应被截断，stop_reason:', stopReason);
      throw new Error('模型输出达到 token 限制被截断，请尝试简化提示词或增加 max_tokens 配置');
    }

    // 解析响应 - 支持多种响应格式
    let content = null;
    
    // Claude API 格式: response.content (array)
    if (response.content && Array.isArray(response.content)) {
      const textBlock = response.content.find((block: any) => block.type === 'text');
      content = textBlock?.text || '';
      console.log('[generate] 使用 Claude API 格式解析');
    }
    // OpenAI API 格式: response.choices[0].message.content
    else if (response.choices?.[0]?.message?.content) {
      content = response.choices[0].message.content;
      console.log('[generate] 使用 OpenAI API 格式解析');
    }
    // 直接返回文本
    else if (typeof response === 'string') {
      content = response;
      console.log('[generate] 直接字符串响应');
    }
    // 其他格式尝试提取
    else if (response.content) {
      content = response.content;
      console.log('[generate] 使用 response.content');
    }
    
    if (!content || (typeof content === 'string' && content.trim() === '')) {
      console.error('[generate] 模型响应为空，完整响应:', JSON.stringify(response));
      throw new Error('模型响应为空，请检查模型配置或重试');
    }

    const textContent = typeof content === 'string' ? content : JSON.stringify(content);
    console.log('[generate] 原始内容类型:', typeof content, '长度:', textContent.length);
    console.log('[generate] 原始内容前500字符:', textContent.substring(0, 500));

    // 解析 JSON - 更健壮的处理
    let jsonStr = textContent.trim();
    console.log('[generate] 清理后内容长度:', jsonStr.length);
    
    if (jsonStr.length === 0) {
      console.error('[generate] 清理后内容为空');
      throw new Error('模型返回的内容为空');
    }

    // 尝试多种方式提取 JSON
    let extractedJson = '';

    // 方式1: 查找 ```json ... ``` 代码块（优先，最明确）
    const jsonCodeBlockMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/s);
    if (jsonCodeBlockMatch) {
      extractedJson = jsonCodeBlockMatch[1].trim();
      console.log('[generate] 方式1提取（json代码块）, 长度:', extractedJson.length);
    }

    // 方式2: 查找 ``` ... ``` 代码块
    if (!extractedJson) {
      const codeBlockMatch = jsonStr.match(/```\s*([\s\S]*?)\s*```/s);
      if (codeBlockMatch) {
        extractedJson = codeBlockMatch[1].trim();
        console.log('[generate] 方式2提取（通用代码块）, 长度:', extractedJson.length);
      }
    }

    // 方式3: 查找 { ... } 对象（最外层，贪婪匹配）
    if (!extractedJson) {
      const objectMatch = jsonStr.match(/\{[\s\S]*\}/s);
      if (objectMatch) {
        extractedJson = objectMatch[0];
        console.log('[generate] 方式3提取（对象匹配）, 长度:', extractedJson.length);
      }
    }

    // 方式4: 如果都失败了，使用整个字符串（前提是看起来像 JSON）
    if (!extractedJson) {
      // 检查是否以 { 开头
      if (jsonStr.startsWith('{')) {
        extractedJson = jsonStr;
        console.log('[generate] 方式4（直接使用，以{开头）');
      } else {
        // 尝试找到第一个 { 开始的位置
        const firstBrace = jsonStr.indexOf('{');
        if (firstBrace !== -1) {
          extractedJson = jsonStr.substring(firstBrace);
          console.log('[generate] 方式5（从第一个{开始）');
        }
      }
    }

    jsonStr = extractedJson.trim();
    console.log('[generate] 最终解析的 JSON 长度:', jsonStr.length);
    
    if (jsonStr.length > 50) {
      console.log('[generate] 最终 JSON 内容（前500字符）:', jsonStr.substring(0, 500));
    } else {
      console.log('[generate] 最终 JSON 内容（完整）:', jsonStr);
    }

    // 验证 JSON 是否有效
    if (!jsonStr || jsonStr.length < 2) {
      console.error('[generate] ============ 提取失败 ============');
      console.error('[generate] 原始响应对象:', JSON.stringify(response, null, 2));
      console.error('[generate] 原始文本内容:', textContent);
      console.error('[generate] 尝试提取的 JSON:', extractedJson || '(空)');
      console.error('[generate] =================================');
      throw new Error('无法从模型响应中提取有效的 JSON。请尝试重新生成或检查模型配置。');
    }

    // 尝试解析 JSON
    let parsedSkill: any;
    try {
      parsedSkill = JSON.parse(jsonStr);
      console.log('[generate] JSON 解析成功:', parsedSkill.name);
    } catch (parseError) {
      console.error('[generate] ============ JSON 解析失败 ============');
      console.error('[generate] 解析错误:', parseError instanceof Error ? parseError.message : String(parseError));
      console.error('[generate] 提取的 JSON 长度:', jsonStr.length);
      console.error('[generate] 提取的 JSON:', jsonStr);
      console.error('[generate] 原始文本内容:', textContent);
      console.error('[generate] 完整响应对象:', JSON.stringify(response, null, 2));
      console.error('[generate] ======================================');
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`模型返回的格式不正确，无法解析 JSON。错误: ${errorMsg}。请尝试重新生成。`);
    }

// 验证必要字段
    if (!parsedSkill.name || !parsedSkill.systemPrompt) {
      throw new Error('生成的 Skill 缺少必要字段');
    }

    // 构建完整的 Markdown 内容（包含所有详细信息）
    const fullContent = buildFullContent(parsedSkill, skillOutputTemplate);

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
function buildFullContent(skill: any, skillOutputTemplate?: string): string {
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
  
  // 标准输出模板（作为独立章节）
  if (skillOutputTemplate && skillOutputTemplate.trim()) {
    lines.push('## 标准输出格式');
    lines.push(skillOutputTemplate);
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
          max_tokens: 32000,  // 足够大的 token 限制，确保完整输出
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
          max_tokens: 32000,  // 足够大的 token 限制，确保完整输出
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
