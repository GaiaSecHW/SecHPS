/**
 * experience-query-service.ts
 * 知识库查询服务 - 根据错误上下文动态查询相关经验
 */

import { prisma } from '@/lib/prisma';
import type { AutonomousEvolutionExperience } from '@prisma/client';

// 常量：最大动态查询经验数
export const MAX_DYNAMIC_EXPERIENCES = 5;

// 错误上下文接口
export interface ErrorContext {
  errorMessage: string;
  errorCategory?: string;
  toolName?: string;
}

// 经验匹配结果接口
export interface ExperienceMatch {
  experience: AutonomousEvolutionExperience;
  relevanceScore: number;
  matchedPatterns: string[];
}

// 错误分类关键词映射（与 experience-generator.ts 保持一致）
const ERROR_CATEGORY_KEYWORDS: Record<string, string[]> = {
  tool_failure: [
    'exit code 254',
    'fork',
    'resource temporarily unavailable',
    'file has not been read',
    'command not found',
    'executable not found',
    'spawn',
    'child process',
  ],
  path_error: [
    'file does not exist',
    'no files found',
    'enoent',
    'cannot find',
    'not found',
    'path not found',
    'directory not found',
  ],
  permission: [
    'permission denied',
    'eacces',
    'access denied',
    'unauthorized',
    'forbidden',
    'not allowed',
  ],
  mcp_timeout: [
    'timed out',
    'timeout',
    'stream closed',
    'connection timeout',
    'request timeout',
    'mcp timeout',
  ],
};

/**
 * 根据错误消息判断错误类型
 * @param message 错误消息
 * @returns 错误分类：tool_failure / path_error / permission / mcp_timeout / other
 */
export function classifyError(message: string): string {
  const lowerMessage = message.toLowerCase();

  for (const [category, keywords] of Object.entries(ERROR_CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerMessage.includes(keyword)) {
        return category;
      }
    }
  }

  return 'other';
}

/**
 * 计算相关性评分
 * 评分规则：
 * - pattern overlap: 匹配的 errorPatterns 数量 * 10
 * - hitCount bonus: hitCount * 0.5（命中次数越多越可信）
 * - category match: 如果 errorCategory 匹配，额外 +20
 * 
 * @param experience 经验记录
 * @param context 错误上下文
 * @returns 相关性评分和匹配的模式列表
 */
export function calculateRelevanceScore(
  experience: AutonomousEvolutionExperience,
  context: ErrorContext
): { score: number; matchedPatterns: string[] } {
  let score = 0;
  const matchedPatterns: string[] = [];

  // 解析经验的 errorPatterns
  let patterns: string[] = [];
  try {
    patterns = JSON.parse(experience.errorPatterns) as string[];
  } catch {
    // ignore parse error
  }

  // Pattern overlap: 检查错误消息是否包含经验的触发特征
  const lowerMessage = context.errorMessage.toLowerCase();
  for (const pattern of patterns) {
    const lowerPattern = pattern.toLowerCase();
    if (lowerMessage.includes(lowerPattern)) {
      score += 10;
      matchedPatterns.push(pattern);
    }
  }

  // Category match bonus
  if (context.errorCategory && experience.errorCategory === context.errorCategory) {
    score += 20;
  }

  // HitCount bonus（命中次数越多越可信）
  score += experience.hitCount * 0.5;

  return { score, matchedPatterns };
}

/**
 * 查询相关经验
 * @param context 错误上下文
 * @returns Top 5 相关经验列表
 */
export async function queryRelevantExperiences(
  context: ErrorContext
): Promise<ExperienceMatch[]> {
  // 确定错误分类
  const errorCategory = context.errorCategory || classifyError(context.errorMessage);

  // 查询数据库：优先查询同类型错误
  const experiences = await prisma.autonomousEvolutionExperience.findMany({
    where: {
      OR: [
        { errorCategory },
        { isInjected: true }, // 也包含已注入的经验（可能跨类别但通用）
      ],
    },
    orderBy: { hitCount: 'desc' },
    take: 20, // 先取 20 条，再计算相关性筛选
  });

  // 计算每条经验的相关性评分
  const matches: ExperienceMatch[] = experiences.map((exp) => {
    const { score, matchedPatterns } = calculateRelevanceScore(exp, {
      ...context,
      errorCategory,
    });
    return {
      experience: exp,
      relevanceScore: score,
      matchedPatterns,
    };
  });

  // 按相关性评分排序，取 Top 5
  const topMatches = matches
    .filter((m) => m.relevanceScore > 0) // 只保留有匹配的
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, MAX_DYNAMIC_EXPERIENCES);

  return topMatches;
}

/**
 * 构建动态经验提示词
 * @param context 错误上下文
 * @returns 提示词字符串和匹配的经验列表
 */
export async function buildDynamicExperiencePrompt(
  context: ErrorContext
): Promise<{ prompt: string; matches: ExperienceMatch[] }> {
  const matches = await queryRelevantExperiences(context);

  if (matches.length === 0) {
    return { prompt: '', matches: [] };
  }

  const lines: string[] = [
    '## ⚠️ 相关执行经验（遇到类似错误时的解决方案）',
    '',
  ];

  for (const match of matches) {
    const exp = match.experience;
    lines.push(`### ${exp.title}`);
    if (match.matchedPatterns.length > 0) {
      lines.push(`匹配特征: ${match.matchedPatterns.join(' / ')}`);
    }
    lines.push(`直达方案: ${exp.directSolution}`);
    lines.push(`教训: ${exp.lesson}`);
    lines.push('');
  }

  const prompt = lines.join('\n');
  console.log(
    `[动态经验查询] 查询到 ${matches.length} 条相关经验，` +
    `最高评分: ${matches[0]?.relevanceScore.toFixed(1)}`
  );

  return { prompt, matches };
}