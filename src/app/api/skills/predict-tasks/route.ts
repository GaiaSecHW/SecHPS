import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { routeRequestWithDefaultModel, getDefaultModelInfo } from '@/lib/model-client';
import { analyzeSkillOverlap, getHighRiskGroups } from '@/services/skill-overlap-analysis';
import type { SimilarSkill, OverlapType } from '@/services/skill-similarity';

/**
 * POST /api/skills/predict-tasks
 * 创建异步预测任务
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

    const body = await request.json();
    const { taskName, taskDescription, nodeId, topK = 5 } = body;

    // 验证必填字段
    if (!taskName || !taskDescription) {
      return NextResponse.json(
        { error: '缺少必填字段：taskName, taskDescription' },
        { status: 400 }
      );
    }

    // 创建任务
    const task = await prisma.skillPredictionTask.create({
      data: {
        id: `predtask-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: payload.userId,
        nodeId,
        taskName,
        taskDescription,
        topK,
        status: 'pending',
        updatedAt: new Date(),
      },
    });

    // 触发后台执行（不等待）
    executePredictionTask(task.id).catch(err => {
      logger.errorNoUser(LOG_MODULES.SKILL, '执行预测任务失败', { details: { taskId: task.id, error: err instanceof Error ? err.message : String(err) } });
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '创建预测任务失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/skills/predict-tasks
 * 查询预测任务列表
 */
export async function GET(request: Request) {
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

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const nodeId = searchParams.get('nodeId');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // 构建查询条件
    const where: any = { userId: payload.userId };
    if (nodeId) {
      where.nodeId = nodeId;
    }
    if (status) {
      where.status = status;
    }

    // 查询任务
    const tasks = await prisma.skillPredictionTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    // 解析 matches 字段（存储为 JSON 字符串）
    const parsedTasks = tasks.map(task => ({
      ...task,
      matches: task.matches ? JSON.parse(task.matches) : null,
      // 解析 governanceWarning 字段
      governanceWarning: task.governanceWarning ? JSON.parse(task.governanceWarning) : null,
    }));

    return NextResponse.json({ tasks: parsedTasks });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '查询预测任务失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

/**
 * 后台执行预测任务
 */
async function executePredictionTask(taskId: string) {
  try {
    logger.debug(LOG_MODULES.SKILL, '开始执行预测任务', { details: { taskId } });

    // 更新任务状态为运行中
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: {
        status: 'running',
        startedAt: new Date(),
        progress: 10,
      },
    });

    // 获取任务详情
    const task = await prisma.skillPredictionTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new Error('任务不存在');
    }

    // 更新进度
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: { progress: 30 },
    });

    // 获取所有可用的 Skills
    const skills = await prisma.skill.findMany({
      where: {
        isActive: true,
        isLatest: true,
        OR: [
          { userId: null },
          { userId: task.userId },
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
      await prisma.skillPredictionTask.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          progress: 100,
          matches: '[]',
          matchCount: 0,
        },
      });
      return;
    }

    // 更新进度
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: { progress: 50 },
    });

    // 获取模型配置
    const modelInfo = await getDefaultModelInfo();

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
      task.taskName,
      task.taskDescription,
      skillSummaries,
      task.topK
    );

    // 更新进度
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: { progress: 70 },
    });

    // 执行匹配
    let matches: any[];
    let method: string;

    if (!modelInfo) {
      // 使用关键词匹配
      matches = simpleKeywordMatch(task.taskName, task.taskDescription, skillSummaries, task.topK);
      method = 'keyword';
    } else {
      // 调用 LLM 匹配（使用统一的 model-client，自动统计 Token）
      try {
        matches = await callLLMForMatchWithDefaultModel(
          modelInfo,
          prompt,
          skillSummaries,
          task.topK,
          task.userId,
          task.taskName
        );
        method = 'llm';
      } catch (error) {
        logger.errorNoUser(LOG_MODULES.SKILL, 'LLM 匹配失败，降级到关键词匹配', { details: { taskId, error: error instanceof Error ? error.message : String(error) } });
        matches = simpleKeywordMatch(task.taskName, task.taskDescription, skillSummaries, task.topK);
        method = 'keyword';
      }
    }

    // 更新进度
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: { progress: 90 },
    });

    // ============================================
    // Skills Governance: 生成 governanceWarning
    // ============================================
    
    // 将 matches 转换为 SimilarSkill 格式
    const similarSkills: SimilarSkill[] = matches.map(match => ({
      skillId: match.skillId,
      skillName: match.skillName,
      displayName: match.displayName,
      cwe: match.cwe || null,
      similarity: match.relevance || 0.5,
      overlapType: determineOverlapType(match),
      overlapScore: match.relevance || 0.5,
      keywordScore: match.relevance || 0.5,
      reason: match.reason || '匹配成功',
    }));

    // 执行重叠分析
    const overlapAnalysis = analyzeSkillOverlap(similarSkills);
    
    // 获取高风险组
    const highRiskGroups = getHighRiskGroups(overlapAnalysis);
    
    // 生成 governanceWarning
    const governanceWarning = generateGovernanceWarning(overlapAnalysis, highRiskGroups);

    // ============================================
    // Skills Governance: 触发观测日志记录
    // ============================================
    
    // 如果存在重叠问题且 governanceWarning 存在，记录观测日志
    if (overlapAnalysis.totalGroups > 0 && governanceWarning) {
      await triggerObservationLog({
        taskId,
        userId: task.userId,
        matches: similarSkills,
        overlapAnalysis,
        governanceWarning,
      });
    }

    // 保存结果
    const completedAt = new Date();
    const duration = task.startedAt ? completedAt.getTime() - task.startedAt.getTime() : null;

    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        completedAt,
        duration,
        progress: 100,
        matches: JSON.stringify(matches),
        method,
        matchCount: matches.length,
        // 存储 governanceWarning（扩展字段）
        governanceWarning: governanceWarning ? JSON.stringify(governanceWarning) : null,
      },
    });

    // 同时保存到 SkillPrediction 表
    await prisma.skillPrediction.create({
      data: {
        id: `pred-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: task.userId,
        taskName: task.taskName,
        taskDescription: task.taskDescription,
        matches: JSON.stringify(matches),
        method,
        matchCount: matches.length,
      },
    });

    logger.debug(LOG_MODULES.SKILL, '预测任务完成', { details: { taskId } });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '预测任务失败', { details: { taskId, error: error instanceof Error ? error.message : String(error) } });

    // 更新任务状态为失败
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : '未知错误',
      },
    });
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
  skills: Array<{ id: string; name: string; displayName: string; description: string; cwe?: string | null }>,
  topK: number,
  userId: string,
  taskName: string
): Promise<any[]> {
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
          scene: 'skill-predict',
          description: `任务预测: ${taskName}`,
        },
      }
    );
    
    logger.debug(LOG_MODULES.SKILL, 'LLM 响应接收', { details: { responsePreview: JSON.stringify(response).substring(0, 200) } });
    
    // 解析响应
    let content = '';
    if (modelInfo.providerType === 'claude') {
      // Claude 响应格式
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

    // 解析 LLM 返回的 JSON
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // 构建 SkillMatch 结果
    const matches: any[] = [];
    for (const item of parsed) {
      const skill = skills.find(s => s.id === item.skillId);
      if (skill) {
        matches.push({
          skillId: skill.id,
          skillName: skill.name,
          displayName: skill.displayName,
          category: null,
          techStack: [],
          relevance: Math.min(1, Math.max(0, item.relevance || 0.5)),
          reason: item.reason || '匹配成功',
        });
      }
    }

    return matches.slice(0, topK);
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, 'LLM 匹配错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    throw error; // 让调用者处理降级
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
): any[] {
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
    category: null,
    techStack: [],
    relevance: Math.min(1, s.score),
    reason: `关键词匹配得分: ${(s.score * 100).toFixed(0)}%`,
  }));
}

// ============================================================================
// Skills Governance Helper Functions
// ============================================================================

/**
 * 根据匹配结果确定重叠类型
 */
function determineOverlapType(
  match: { relevance: number }
): OverlapType {
  // 高相关性视为语义重叠
  if (match.relevance >= 0.85) {
    return 'semantic-overlap';
  }
  
  // 中等相关性视为触发词重叠
  if (match.relevance >= 0.75) {
    return 'trigger-overlap';
  }
  
  // 默认为语义重叠
  return 'semantic-overlap';
}

/**
 * 生成治理预警信息
 */
function generateGovernanceWarning(
  overlapAnalysis: ReturnType<typeof analyzeSkillOverlap>,
  highRiskGroups: ReturnType<typeof getHighRiskGroups>
): {
  hasWarning: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details: {
    totalGroups: number;
    highRiskCount: number;
    summary: typeof overlapAnalysis.summary;
    recommendations: string[];
  };
} | null {
  // 无重叠则无预警
  if (overlapAnalysis.totalGroups === 0) {
    return null;
  }
  
  // 确定严重程度
  let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
  
  if (highRiskGroups.length >= 3) {
    severity = 'critical';
  } else if (highRiskGroups.length >= 1) {
    severity = 'high';
  } else if (overlapAnalysis.summary.semanticOverlaps >= 2) {
    severity = 'medium';
  }
  
  // 生成预警消息
  const message = generateWarningMessage(severity, overlapAnalysis, highRiskGroups);
  
  // 生成建议
  const recommendations = generateRecommendations(overlapAnalysis, highRiskGroups);
  
  return {
    hasWarning: true,
    severity,
    message,
    details: {
      totalGroups: overlapAnalysis.totalGroups,
      highRiskCount: highRiskGroups.length,
      summary: overlapAnalysis.summary,
      recommendations,
    },
  };
}

/**
 * 生成预警消息
 */
function generateWarningMessage(
  severity: string,
  overlapAnalysis: ReturnType<typeof analyzeSkillOverlap>,
  highRiskGroups: ReturnType<typeof getHighRiskGroups>
): string {
  const parts: string[] = [];
  
  if (severity === 'critical') {
    parts.push('⚠️ 发现多个高风险技能重叠组，可能导致严重的重复检测和资源浪费。');
  } else if (severity === 'high') {
    parts.push('⚠️ 发现高风险技能重叠组，建议审核并优化技能配置。');
  } else if (severity === 'medium') {
    parts.push('⚡ 发现技能重叠情况，可能产生冗余检测。');
  } else {
    parts.push('ℹ️ 检测到轻微技能重叠，影响可控。');
  }
  
  parts.push(`共发现 ${overlapAnalysis.totalGroups} 个重叠组，其中 ${highRiskGroups.length} 个为高风险组。`);
  
  if (overlapAnalysis.summary.exactMatches > 0) {
    parts.push(`包含 ${overlapAnalysis.summary.exactMatches} 个完全匹配。`);
  }
  
  if (overlapAnalysis.summary.semanticOverlaps > 0) {
    parts.push(`包含 ${overlapAnalysis.summary.semanticOverlaps} 个语义重叠。`);
  }
  
  return parts.join(' ');
}

/**
 * 生成处理建议
 */
function generateRecommendations(
  overlapAnalysis: ReturnType<typeof analyzeSkillOverlap>,
  highRiskGroups: ReturnType<typeof getHighRiskGroups>
): string[] {
  const recommendations: string[] = [];
  
  // 高风险组建议
  if (highRiskGroups.length > 0) {
    recommendations.push('建议优先处理高风险重叠组，考虑合并或拆分技能。');
    
    for (const group of highRiskGroups.slice(0, 3)) {
      const skillNames = group.skills.map(s => s.displayName).join(', ');
      recommendations.push(`高风险组 "${group.groupName}" 包含: ${skillNames}`);
    }
  }
  
  // 完全匹配建议
  if (overlapAnalysis.summary.exactMatches > 0) {
    recommendations.push('发现完全匹配的技能，建议合并以避免重复检测。');
  }
  
  // 语义重叠建议
  if (overlapAnalysis.summary.semanticOverlaps > 0) {
    recommendations.push('语义重叠可能导致触发冲突，建议优化技能描述或触发词。');
  }
  
  // 技术栈重叠建议
  if (overlapAnalysis.summary.techStackOverlaps > 0) {
    recommendations.push('技术栈重叠可通过明确技术栈范围来区分触发场景。');
  }
  
  // 默认建议
  if (recommendations.length === 0) {
    recommendations.push('当前重叠情况可控，无需特别处理。');
  }
  
  return recommendations;
}

/**
 * 触发观测日志记录
 * 
 * 为 T9 观测日志系统提供触发点
 */
async function triggerObservationLog(params: {
  taskId: string;
  userId: string;
  matches: SimilarSkill[];
  overlapAnalysis: ReturnType<typeof analyzeSkillOverlap>;
  governanceWarning: NonNullable<ReturnType<typeof generateGovernanceWarning>>;
}): Promise<void> {
  try {
    // 为每个高风险组创建观测日志
    const highRiskGroups = getHighRiskGroups(params.overlapAnalysis);
    
    for (const group of highRiskGroups) {
      // 为组内每个技能创建观测日志
      for (const skill of group.skills) {
        await prisma.skillObservationLog.create({
          data: {
            id: `obslog-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            skillId: skill.skillId,
            triggerType: 'overlap_detected',
            triggerContext: JSON.stringify({
              taskId: params.taskId,
              groupName: group.groupName,
              overlapType: group.overlapType,
              overlapScore: group.overlapScore,
            }),
            matches: JSON.stringify(group.skills.map(s => ({
              skillId: s.skillId,
              skillName: s.skillName,
              displayName: s.displayName,
              similarity: s.similarity,
            }))),
            issues: JSON.stringify({
              overlapGroup: group.groupName,
              sharedKeywords: group.sharedKeywords,
              severity: params.governanceWarning.severity,
            }),
            severity: mapSeverityToLogLevel(params.governanceWarning.severity),
            status: 'pending',
            updatedAt: new Date(),
          },
        });
      }
    }
    
    // 如果存在完全匹配，创建额外预警日志
    if (params.overlapAnalysis.summary.exactMatches > 0) {
      const exactGroups = params.overlapAnalysis.groups.filter(g => g.overlapType === 'exact');
      
      for (const group of exactGroups) {
        for (const skill of group.skills) {
          await prisma.skillObservationLog.create({
            data: {
              id: `obslog-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              skillId: skill.skillId,
              triggerType: 'similarity_warning',
              triggerContext: JSON.stringify({
                taskId: params.taskId,
                groupName: group.groupName,
                overlapType: 'exact',
              }),
              matches: JSON.stringify(group.skills.map(s => ({
                skillId: s.skillId,
                skillName: s.skillName,
                displayName: s.displayName,
              }))),
              issues: JSON.stringify({
                type: 'exact_match',
                message: '发现完全匹配的技能，建议合并',
              }),
              severity: 'high',
              status: 'pending',
              updatedAt: new Date(),
            },
          });
        }
      }
    }
    
    logger.debug(LOG_MODULES.SKILL, '观测日志记录完成', {
      details: {
        taskId: params.taskId,
        logCount: highRiskGroups.length * (highRiskGroups[0]?.skills.length || 0),
      },
    });
  } catch (error) {
    // 观测日志记录失败不影响主流程
    logger.errorNoUser(LOG_MODULES.SKILL, '观测日志记录失败', {
      details: {
        taskId: params.taskId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/**
 * 将治理严重程度映射到日志级别
 */
function mapSeverityToLogLevel(severity: 'low' | 'medium' | 'high' | 'critical'): string {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'info';
  }
}
