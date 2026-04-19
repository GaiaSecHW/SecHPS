// src/app/api/skills/match/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { routeRequestWithDefaultModel, getDefaultModelInfo } from '@/lib/model-client';
import { analyzeSkillOverlap, type OverlapGroup } from '@/services/skill-overlap-analysis';
import { predictImpact, type ImpactPrediction } from '@/services/skill-impact-prediction';
import { generateRecommendations, type Recommendation } from '@/services/skill-recommendations';
import type { SimilarSkill, OverlapType } from '@/services/skill-similarity';

/**
 * Skill 匹配请求
 */
interface MatchRequest {
  taskName: string;
  taskDescription: string;
  topK?: number;
}

/**
 * Skill 匹配结果
 */
interface SkillMatch {
  skillId: string;
  skillName: string;
  displayName: string;
  relevance: number;
  reason: string;
}

/**
 * Governance Warning 结构
 */
interface GovernanceWarning {
  overlapGroups: OverlapGroup[];
  impact: ImpactPrediction[];
  recommendations: Recommendation[];
  hasOverlap: boolean;
}

/**
 * 将 SkillMatch 转换为 SimilarSkill（用于治理分析）
 */
function convertToSimilarSkill(matches: SkillMatch[]): SimilarSkill[] {
  return matches.map((match) => {
    const overlapType: OverlapType = 'trigger-overlap';
    const overlapScore = match.relevance * 0.8;

    return {
      skillId: match.skillId,
      skillName: match.skillName,
      displayName: match.displayName,
      cwe: null,
      similarity: match.relevance,
      overlapType,
      overlapScore,
      keywordScore: match.relevance * 0.7,
      reason: match.reason,
    };
  });
}

/**
 * 生成治理预警
 */
function generateGovernanceWarning(matches: SkillMatch[]): GovernanceWarning | null {
  // 少于2个匹配时无重复可能，跳过分析
  if (matches.length < 2) {
    return null;
  }
  
  try {
    // 转换为 SimilarSkill 格式
    const similarSkills = convertToSimilarSkill(matches);
    
    // 调用重叠分析
    const overlapAnalysis = analyzeSkillOverlap(similarSkills);
    
    // 如果没有重叠组，返回无重叠
    if (overlapAnalysis.groups.length === 0) {
      return {
        overlapGroups: [],
        impact: [],
        recommendations: [],
        hasOverlap: false,
      };
    }
    
    // 调用影响预测（批量）
    const impactPredictions = overlapAnalysis.groups.map(group => predictImpact(group));
    
    // 转换 ImpactPrediction 格式以匹配 skill-recommendations.ts 的期望
    const convertedImpactPredictions: import('@/services/skill-recommendations').ImpactPrediction[] = 
      impactPredictions.map(p => ({
        duplicateDetection: p.duplicateDetection,
        estimatedRedundantReports: p.estimatedRedundantReports,
        estimatedTokenIncrease: parseInt(p.estimatedTokenIncrease, 10),
        overallSeverity: p.overallSeverity,
        details: {
          affectedWorkflows: 0,
          userConfusionRisk: p.details.groupSize > 2 ? 0.5 : 0.2,
          selectionConflictRate: p.details.overlapScore,
        },
      }));
    
    // 调用建议生成（批量）并扁平化结果
    const allRecommendations = overlapAnalysis.groups.flatMap((group, idx) => 
      generateRecommendations(group, convertedImpactPredictions[idx])
    );
    
    return {
      overlapGroups: overlapAnalysis.groups,
      impact: impactPredictions,
      recommendations: allRecommendations,
      hasOverlap: true,
    };
  } catch (error) {
    // 分析失败不影响主流程，返回 null
    logger.errorNoUser(LOG_MODULES.SKILL, '治理预警生成失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return null;
  }
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
    const { taskName, taskDescription, topK = 5 } = body;

    // 验证必填字段
    if (!taskName || !taskDescription) {
      return NextResponse.json(
        { error: '缺少必填字段：任务名称和任务描述' },
        { status: 400 }
      );
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
        techStackId: true,
        vulnerabilityPatternId: true,
        cwe: true,
      },
    });

    if (skills.length === 0) {
      return NextResponse.json({
        matches: [],
        analyzedAt: new Date().toISOString(),
        governanceWarning: null,
      });
    }

    // 构建技能列表摘要
    const skillSummaries = skills.map(skill => {
      return {
        id: skill.id,
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        cwe: skill.cwe,
      };
    });

// 构建匹配 Prompt
    const prompt = buildMatchPrompt(
      taskName,
      taskDescription,
      skillSummaries,
      topK
    );

    // 获取模型配置
    const modelInfo = await getDefaultModelInfo();

    if (!modelInfo) {
      // 如果没有配置模型，使用简单的关键词匹配
      const matches = simpleKeywordMatch(taskName, taskDescription, skillSummaries, topK);
      
      // 保存预测结果
      try {
        await prisma.skillPrediction.create({
          data: {
            id: `pred-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            userId: payload.userId,
            taskName,
            taskDescription,
            matches: JSON.stringify(matches),
            method: 'keyword',
            matchCount: matches.length,
          },
        });
      } catch (saveError) {
        logger.errorWithUser(LOG_MODULES.SKILL, payload, '保存预测结果失败', undefined, { details: { error: saveError instanceof Error ? saveError.message : String(saveError) } });
      }
      
      // 生成治理预警
      const governanceWarning = generateGovernanceWarning(matches);
      
      return NextResponse.json({
        matches,
        analyzedAt: new Date().toISOString(),
        method: 'keyword',
        governanceWarning,
      });
    }

    // 调用 LLM 进行匹配（使用统一的 model-client，自动统计 Token）
    const matches = await callLLMForMatchWithDefaultModel(
      modelInfo,
      prompt,
      taskName,
      taskDescription,
      skillSummaries,
      topK,
      payload.userId,
      payload.username
    );
    
// 保存预测结果到数据库
    try {
      await prisma.skillPrediction.create({
        data: {
          id: `pred-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          userId: payload.userId,
          taskName,
          taskDescription,
          matches: JSON.stringify(matches),
          method: 'llm',
          matchCount: matches.length,
        },
      });
    } catch (saveError) {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, '保存预测结果失败', undefined, { details: { error: saveError instanceof Error ? saveError.message : String(saveError) } });
      // 不影响主流程，只记录错误
    }
  
    // 生成治理预警
    const governanceWarning = generateGovernanceWarning(matches);
    
    return NextResponse.json({
      matches,
      analyzedAt: new Date().toISOString(),
      method: 'llm',
      governanceWarning,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, 'Skill match 错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * 构建匹配 Prompt
 */
function buildMatchPrompt(
  taskName: string,
  taskDescription: string,
  skills: Array<{
    id: string;
    name: string;
    displayName: string;
    description: string;
    cwe: string | null;
  }>,
  topK: number
): string {
  const skillsTable = skills.map(s =>
    `| ${s.id} | ${s.displayName} | ${s.description.substring(0, 100)}${s.description.length > 100 ? '...' : ''} | ${s.cwe || '-'} |`
  ).join('\n');

  return `你是一个Skill匹配专家。分析以下任务，从可用的Skills中选择最匹配的。

## 任务信息
- 名称: ${taskName}
- 描述: ${taskDescription}

## 可用Skills列表
| ID | 名称 | 描述 | 类别 | 技术栈 | CWE |
|----|------|------|------|--------|-----|
${skillsTable}

## 匹配要求
1. 技术栈为空的Skills视为通用Skill，也应当考虑
2. 根据任务描述判断核心需求（安全检测？代码审计？认证相关？）
3. 考虑Skill的类别和CWE编号的关联性
4. 返回最相关的Top-${topK} Skills

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
 * 调用 LLM 进行匹配（使用统一 model-client）
 */
async function callLLMForMatchWithDefaultModel(
  modelInfo: {
    providerType: 'openai' | 'claude';
    apiKey: string;
    apiBaseUrl: string;
    defaultModel: string;
  },
  prompt: string,
  taskName: string,
  taskDescription: string,
  skills: Array<{ id: string; name: string; displayName: string; description: string; cwe?: string | null }>,
  topK: number,
  userId: string,
  username?: string
): Promise<SkillMatch[]> {
  try {
    logger.debug(LOG_MODULES.SKILL, '调用 LLM API', { details: { provider: modelInfo.providerType, model: modelInfo.defaultModel } });
    
    const response = await routeRequestWithDefaultModel(
      [{ role: 'user', content: '请从上面的 Skills 列表中选择最匹配的Skills并返回JSON格式结果' }],
      {
        system: prompt,
        max_tokens: 8192,
        temperature: 0.3,
        context: {
          userId,
          username,
          scene: 'skill-match',
          description: `Skill匹配: ${taskName}`,
        },
      }
    );
    
    logger.debug(LOG_MODULES.SKILL, 'LLM 响应接收', { details: { responsePreview: JSON.stringify(response).substring(0, 200) } });
    
    // 解析响应
    let content = '';
    if (modelInfo.providerType === 'claude') {
      // Claude 响应格式
      logger.debug(LOG_MODULES.SKILL, 'Claude 响应内容解析');
      if (Array.isArray(response.content)) {
        const textBlock = response.content.find((block: any) => block.type === 'text');
        content = textBlock?.text || '';
      } else if (typeof response.content === 'string') {
        content = response.content;
      }
    } else {
      // OpenAI 响应格式
      content = response.choices?.[0]?.message?.content || '';
    }
    
    logger.debug(LOG_MODULES.SKILL, '提取的内容', { details: { contentType: typeof content, contentPreview: content.substring(0, 100) } });

    // 解析 LLM 返回的 JSON
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.debug(LOG_MODULES.SKILL, '未找到 JSON 数组，使用降级方案');
      return simpleKeywordMatch(taskName, taskDescription, skills, topK);
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
          relevance: Math.min(1, Math.max(0, item.relevance || 0.5)),
          reason: item.reason || '匹配成功',
        });
      }
    }

    return matches.slice(0, topK);
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, 'LLM 匹配错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return simpleKeywordMatch(taskName, taskDescription, skills, topK);
  }
}

/**
 * 简单关键词匹配（作为降级方案）
 */
function simpleKeywordMatch(
  taskName: string,
  taskDescription: string,
  skills: Array<{
    id: string;
    name: string;
    displayName: string;
    description: string;
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
    
    // 1. 类别匹配得分（已移除，使用漏洞类型替代）
    // const keywords = categoryKeywords[skill.category] || [];

    // 2. 名称/描述相似度
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
    relevance: Math.min(1, s.score),
    reason: `关键词匹配得分: ${(s.score * 100).toFixed(0)}%`,
  }));
}
