import { prisma } from '@/lib/prisma';
import type { Vulnerability } from '@prisma/client';
import { DEFAULT_EVOLUTION_CONFIG } from './evolution-scheduler';

/**
 * 精简案例接口 - 用于技能进化学习
 */
export interface CompactCase {
  vulnerabilityId: string;
  title: string;
  description: string;
  filePath?: string;
  codeSnippetPreview?: string;
  status: 'false_positive' | 'confirmed';
  markedAt: Date;
}

/**
 * 获取精简案例选项
 */
export interface GetCompactCasesOptions {
  falsePositiveLimit?: number;
  confirmedLimit?: number;
  maxDescriptionLength?: number;
  codeSnippetLines?: number;
}

/**
 * 获取精简案例结果
 */
export interface GetCompactCasesResult {
  falsePositives: CompactCase[];
  confirmedCases: CompactCase[];
  totalFalsePositives: number;
  totalConfirmed: number;
}

/**
 * 提取代码片段的关键行（前后各 N 行）
 * @param codeSnippet 完整代码片段
 * @param lines 前后各保留的行数
 * @returns 精简后的代码片段
 */
function extractKeyLines(codeSnippet: string | null, lines: number): string | undefined {
  if (!codeSnippet) return undefined;

  const allLines = codeSnippet.split('\n');
  if (allLines.length <= lines * 2) {
    return codeSnippet;
  }

  // 取前 N 行和后 N 行
  const firstLines = allLines.slice(0, lines);
  const lastLines = allLines.slice(-lines);

  return [...firstLines, '...', ...lastLines].join('\n');
}

/**
 * 获取精简案例（误报 + 正确发现）
 * 通过 SkillExecution 关联找到 skillId 对应的漏洞
 *
 * @param skillId 技能 ID
 * @param options 选项参数
 * @returns 误报和正确发现的精简案例
 */
export async function getCompactCases(
  skillId: string,
  options?: GetCompactCasesOptions
): Promise<GetCompactCasesResult> {
  const {
    falsePositiveLimit = DEFAULT_EVOLUTION_CONFIG.FALSE_POSITIVE_LIMIT,
    confirmedLimit = DEFAULT_EVOLUTION_CONFIG.CONFIRMED_LIMIT,
    maxDescriptionLength = 200,
    codeSnippetLines = 3,
  } = options ?? {};

  // 查询该技能相关的所有 SkillExecution ID
  const skillExecutions = await prisma.skillExecution.findMany({
    where: { skillId },
    select: { id: true },
  });

  const skillExecutionIds = skillExecutions.map((se) => se.id);

  if (skillExecutionIds.length === 0) {
    return {
      falsePositives: [],
      confirmedCases: [],
      totalFalsePositives: 0,
      totalConfirmed: 0,
    };
  }

  // 并行查询误报和正确发现
  const [falsePositives, confirmedCases, totalFalsePositives, totalConfirmed] =
    await Promise.all([
      // 误报案例
      prisma.vulnerability.findMany({
        where: {
          skillExecutionId: { in: skillExecutionIds },
          status: 'false_positive',
        },
        take: falsePositiveLimit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          filePath: true,
          codeSnippet: true,
          status: true,
          updatedAt: true,
        },
      }),
      // 正确发现案例
      prisma.vulnerability.findMany({
        where: {
          skillExecutionId: { in: skillExecutionIds },
          status: 'confirmed',
        },
        take: confirmedLimit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          filePath: true,
          codeSnippet: true,
          status: true,
          updatedAt: true,
        },
      }),
      // 误报总数
      prisma.vulnerability.count({
        where: {
          skillExecutionId: { in: skillExecutionIds },
          status: 'false_positive',
        },
      }),
      // 正确发现总数
      prisma.vulnerability.count({
        where: {
          skillExecutionId: { in: skillExecutionIds },
          status: 'confirmed',
        },
      }),
    ]);

  // 转换为 CompactCase 格式
  const toCompactCase = (
    v: {
      id: string;
      title: string;
      description: string;
      filePath: string | null;
      codeSnippet: string | null;
      status: string;
      updatedAt: Date;
    },
    maxLength: number,
    snippetLines: number
  ): CompactCase => ({
    vulnerabilityId: v.id,
    title: v.title,
    description:
      v.description.length > maxLength
        ? v.description.slice(0, maxLength)
        : v.description,
    filePath: v.filePath ?? undefined,
    codeSnippetPreview: extractKeyLines(v.codeSnippet, snippetLines),
    status: v.status as 'false_positive' | 'confirmed',
    markedAt: v.updatedAt,
  });

  return {
    falsePositives: falsePositives.map((v) =>
      toCompactCase(v, maxDescriptionLength, codeSnippetLines)
    ),
    confirmedCases: confirmedCases.map((v) =>
      toCompactCase(v, maxDescriptionLength, codeSnippetLines)
    ),
    totalFalsePositives,
    totalConfirmed,
  };
}

/**
 * 获取完整案例详情
 *
 * @param vulnerabilityId 漏洞 ID
 * @returns 完整的漏洞信息
 */
export async function getFullCase(vulnerabilityId: string): Promise<Vulnerability | null> {
  return prisma.vulnerability.findUnique({
    where: { id: vulnerabilityId },
  });
}