// src/app/api/skills/match/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

/**
 * Skill 匹配请求
 */
interface MatchRequest {
  taskName: string;
  taskDescription: string;
  workflowId: string;
  topK?: number;
}

/**
 * Skill 匹配结果
 */
interface SkillMatch {
  skillId: string;
  skillName: string;
  displayName: string;
  category: string;
  techStack: string[];
  relevance: number;
  reason: string;
}

/**
 * POST /api/skills/match
 * 根据任务信息匹配相关 Skills
 */
export async function POST(request: Request) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 解析请求体
    const body: MatchRequest = await request.json();
    const { taskName, taskDescription, workflowId, topK = 5 } = body;

    // 验证必填字段
    if (!taskName || !taskDescription) {
      return NextResponse.json(
        { error: '缺少必填字段：任务名称和任务描述' },
        { status: 400 }
      );
    }

    // 获取工作流信息（包含技术栈）
    let workflowTechStack: string[] = [];
    if (workflowId) {
      const workflow = await prisma.workflow.findUnique({
        where: { id: workflowId },
        select: { techStack: true },
      });
      if (workflow?.techStack) {
        try {
          workflowTechStack = JSON.parse(workflow.techStack);
        } catch {
          // 忽略解析错误
        }
      }
    }

    // 获取所有可用的 Skills（公共 + 当前用户私有）
    const skills = await prisma.skill.findMany({
      where: {
        isActive: true,
        isLatest: true,
        OR: [
          { userId: null },           // 公共 Skills
          { userId: payload.userId }, // 用户私有 Skills
        ],
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        category: true,
        techStack: true,
        cwe: true,
      },
    });

    if (skills.length === 0) {
      return NextResponse.json({
        matches: [],
        analyzedAt: new Date().toISOString(),
      });
    }

    // 构建技能列表摘要
    const skillSummaries = skills.map(skill => {
      let techStackArr: string[] = [];
      if (skill.techStack) {
        try {
          techStackArr = JSON.parse(skill.techStack);
        } catch {
          // 忽略解析错误
        }
      }
      return {
        id: skill.id,
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        category: skill.category,
        techStack: techStackArr,
        cwe: skill.cwe,
      };
    });

    // 构建匹配 Prompt
    const prompt = buildMatchPrompt(
      taskName,
      taskDescription,
      workflowTechStack,
      skillSummaries,
      topK
    );

    // 获取模型配置
    const modelConfig = await prisma.modelConfig.findFirst({
      where: {
        isActive: true,
        isDefault: true,
      },
    });

    if (!modelConfig) {
      // 如果没有配置模型，使用简单的关键词匹配
      const matches = simpleKeywordMatch(taskName, taskDescription, workflowTechStack, skillSummaries, topK);
      
      // 保存预测结果
      try {
        await prisma.skillPrediction.create({
          data: {
            userId: payload.userId,
            workflowId,
            taskName,
            taskDescription,
            matches: JSON.stringify(matches),
            method: 'keyword',
            workflowTechStack: workflowTechStack.length > 0 ? JSON.stringify(workflowTechStack) : null,
            matchCount: matches.length,
          },
        });
      } catch (saveError) {
        console.error('保存预测结果失败:', saveError);
      }
      
      return NextResponse.json({
        matches,
        analyzedAt: new Date().toISOString(),
        method: 'keyword',
      });
    }

// 调用 LLM 进行匹配
    const matches = await callLLMForMatch(modelConfig, prompt, skillSummaries, topK);
    
    // 保存预测结果到数据库
    try {
      await prisma.skillPrediction.create({
        data: {
          userId: payload.userId,
          workflowId,
          taskName,
          taskDescription,
          matches: JSON.stringify(matches),
          method: 'llm',
          workflowTechStack: workflowTechStack.length > 0 ? JSON.stringify(workflowTechStack) : null,
          matchCount: matches.length,
        },
      });
    } catch (saveError) {
      console.error('保存预测结果失败:', saveError);
      // 不影响主流程，只记录错误
    }
 
    return NextResponse.json({
      matches,
      workflowTechStack,
      analyzedAt: new Date().toISOString(),
      method: 'llm',
    });
  } catch (error) {
    console.error('Skill match error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * 构建匹配 Prompt
 */
function buildMatchPrompt(
  taskName: string,
  taskDescription: string,
  workflowTechStack: string[],
  skills: Array<{
    id: string;
    name: string;
    displayName: string;
    description: string;
    category: string;
    techStack: string[];
    cwe: string | null;
  }>,
  topK: number
): string {
  const techStackStr = workflowTechStack.length > 0
    ? workflowTechStack.join(', ')
    : '未指定';

  const skillsTable = skills.map(s => 
    `| ${s.id} | ${s.displayName} | ${s.description.substring(0, 100)}${s.description.length > 100 ? '...' : ''} | ${s.category} | ${s.techStack.join(', ') || '通用'} | ${s.cwe || '-'} |`
  ).join('\n');

  return `你是一个Skill匹配专家。分析以下任务，从可用的Skills中选择最匹配的。

## 任务信息
- 名称: ${taskName}
- 描述: ${taskDescription}

## 编排信息
- 适合的技术栈: ${techStackStr}

## 可用Skills列表
| ID | 名称 | 描述 | 类别 | 技术栈 | CWE |
|----|------|------|------|--------|-----|
${skillsTable}

## 匹配要求
1. 优先匹配技术栈一致的Skills
2. 技术栈为空的Skills视为通用Skill，也应当考虑
3. 根据任务描述判断核心需求（安全检测？代码审计？认证相关？）
4. 考虑Skill的类别和CWE编号的关联性
5. 返回最相关的Top-${topK} Skills

## 输出格式
严格返回JSON数组，不要包含任何其他文字:
[
  {
    "skillId": "Skill的ID",
    "relevance": 0.95,
    "reason": "简短的中文解释为什么匹配"
  }
]`;
}

/**
 * 调用 LLM 进行匹配
 */
async function callLLMForMatch(
  modelConfig: {
    apiBaseUrl: string;
    apiKey: string;
    models: string;
    providerType: string;
  },
  prompt: string,
  skills: Array<{ id: string; name: string; displayName: string; description: string; category: string; techStack: string[] }>,
  topK: number
): Promise<SkillMatch[]> {
  try {
    // 解析 models JSON 字符串并取第一个模型
    let modelName = 'default';
    try {
      const parsedModels = JSON.parse(modelConfig.models);
      modelName = Array.isArray(parsedModels) ? parsedModels[0] : modelConfig.models;
    } catch {
      // 解析失败，直接使用原始值
      modelName = modelConfig.models.split(',')[0].trim();
    }
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${modelConfig.apiKey}`,
    };

    // 处理 API URL 和请求格式
    let apiUrl = modelConfig.apiBaseUrl;
    let body: Record<string, unknown>;
    
    if (modelConfig.providerType === 'claude') {
      // Claude API
      if (!apiUrl.includes('/v1/messages') && !apiUrl.endsWith('/messages')) {
        apiUrl = apiUrl.replace(/\/$/, '') + '/v1/messages';
      }
      // Claude 使用不同的 headers
      delete headers['Authorization'];
      headers['x-api-key'] = modelConfig.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      
      // Claude 请求格式：system 在 messages 中作为 role: "system"
      body = {
        model: modelName,
        max_tokens: 2000,
        system: prompt,
        messages: [{ role: 'user', content: '请从上面的 Skills 列表中选择最匹配的Skills并返回JSON格式结果' }],
      };
    } else {
      // OpenAI 兼容 API
      if (!apiUrl.endsWith('/chat/completions')) {
        apiUrl = apiUrl.replace(/\/$/, '') + '/v1/chat/completions';
      }
      
      body = {
        model: modelName,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      };
    }

    console.log('[match] 调用 LLM API:', apiUrl);
    console.log('[match] Provider:', modelConfig.providerType);
    console.log('[match] Model:', modelName);
    console.log('[match] Request body:', JSON.stringify(body).substring(0, 500));
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('LLM API error:', response.status, errorText);
      return simpleKeywordMatch('', '', [], skills, topK);
    }

    const llmResponse = await response.json();
    console.log('[match] LLM response:', JSON.stringify(llmResponse).substring(0, 500));
    
    // 解析响应
    let content = '';
    if (modelConfig.providerType === 'claude') {
      // Claude 响应格式
      console.log('[match] Claude response content:', llmResponse.content);
      if (Array.isArray(llmResponse.content)) {
        const textBlock = llmResponse.content.find((block: any) => block.type === 'text');
        content = textBlock?.text || '';
      } else if (typeof llmResponse.content === 'string') {
        content = llmResponse.content;
      }
    } else {
      // OpenAI 响应格式
      content = llmResponse.choices?.[0]?.message?.content || '';
    }
    
    console.log('[match] Extracted content type:', typeof content);
    console.log('[match] Extracted content:', content.substring(0, 200));

    // 解析 LLM 返回的 JSON
    console.log('[match] Parsing content, type:', typeof content);
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log('[match] No JSON array found in content, using fallback');
      return simpleKeywordMatch('', '', [], skills, topK);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // 构建 SkillMatch 结果
    const matches: SkillMatch[] = [];
    for (const item of parsed) {
      const skill = skills.find(s => s.id === item.skillId);
      if (skill) {
        matches.push({
          skillId: skill.id,
          skillName: skill.name,
          displayName: skill.displayName,
          category: skill.category,
          techStack: skill.techStack,
          relevance: Math.min(1, Math.max(0, item.relevance || 0.5)),
          reason: item.reason || '匹配成功',
        });
      }
    }

    return matches.slice(0, topK);
  } catch (error) {
    console.error('LLM match error:', error);
    return simpleKeywordMatch('', '', [], skills, topK);
  }
}

/**
 * 简单关键词匹配（作为降级方案）
 */
function simpleKeywordMatch(
  taskName: string,
  taskDescription: string,
  workflowTechStack: string[],
  skills: Array<{
    id: string;
    name: string;
    displayName: string;
    description: string;
    category: string;
    techStack: string[];
  }>,
  topK: number
): SkillMatch[] {
  const searchText = `${taskName} ${taskDescription}`.toLowerCase();
  
  // 关键词权重映射
  const categoryKeywords: Record<string, string[]> = {
    'code-audit': ['sql', '注入', 'injection', 'xss', '漏洞', '漏洞检测', '代码审计', '审计', '安全检测'],
    'auth': ['认证', '授权', '登录', '密码', 'jwt', 'oauth', '鉴权', 'authentication', 'authorization'],
    'sensitive': ['敏感', '密钥', '泄露', '硬编码', 'password', 'secret', 'key'],
    'api': ['api', '接口', 'rest', 'graphql', 'endpoint'],
    'config': ['配置', 'config', '设置', 'setting'],
    'crypto': ['加密', '解密', 'crypto', 'cipher', 'ssl', 'tls'],
    'web': ['web', '网页', '网站', 'http', '请求'],
    'business': ['业务', '逻辑', '流程', 'workflow'],
    'client': ['客户端', 'client', '前端', 'frontend'],
    'cloud': ['云', 'cloud', 'aws', 'azure', 'kubernetes', 'docker'],
  };

  // 计算每个 Skill 的得分
  const scoredSkills = skills.map(skill => {
    let score = 0;
    const skillText = `${skill.name} ${skill.displayName} ${skill.description}`.toLowerCase();
    
    // 1. 类别匹配得分
    const keywords = categoryKeywords[skill.category] || [];
    for (const keyword of keywords) {
      if (searchText.includes(keyword)) {
        score += 0.3;
        break;
      }
    }

    // 2. 技术栈匹配得分
    if (workflowTechStack.length > 0 && skill.techStack.length > 0) {
      const matchCount = skill.techStack.filter(ts => 
        workflowTechStack.some(wts => 
          ts.toLowerCase() === wts.toLowerCase() ||
          ts.toLowerCase().includes(wts.toLowerCase()) ||
          wts.toLowerCase().includes(ts.toLowerCase())
        )
      ).length;
      if (matchCount > 0) {
        score += 0.4 * (matchCount / skill.techStack.length);
      }
    }

    // 3. 名称/描述相似度
    const skillWords = skillText.split(/\s+/);
    const taskWords = searchText.split(/\s+/);
    const commonWords = skillWords.filter(w => taskWords.includes(w));
    score += Math.min(0.3, commonWords.length * 0.05);

    return {
      skill,
      score,
    };
  });

  // 排序并返回 Top-K
  const sorted = scoredSkills
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return sorted.map(s => ({
    skillId: s.skill.id,
    skillName: s.skill.name,
    displayName: s.skill.displayName,
    category: s.skill.category,
    techStack: s.skill.techStack,
    relevance: Math.min(1, s.score),
    reason: `关键词匹配得分: ${(s.score * 100).toFixed(0)}%`,
  }));
}
