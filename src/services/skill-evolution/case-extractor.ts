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
  location?: string;
  status: 'false-positive' | 'confirmed';
  falsePositiveReason?: string;
  markedAt: Date;
}

export interface GetCompactCasesOptions {
  falsePositiveLimit?: number;
  confirmedLimit?: number;
  maxDescriptionLength?: number;
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

export async function getCompactCases(
  skillId: string,
  options?: GetCompactCasesOptions
): Promise<GetCompactCasesResult> {
  const {
    falsePositiveLimit = DEFAULT_EVOLUTION_CONFIG.FALSE_POSITIVE_LIMIT,
    confirmedLimit = DEFAULT_EVOLUTION_CONFIG.CONFIRMED_LIMIT,
    maxDescriptionLength = 200,
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
          status: 'false-positive',
        },
        take: falsePositiveLimit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          location: true,
          status: true,
          falsePositiveReason: true,
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
          location: true,
          status: true,
          updatedAt: true,
        },
      }),
      // 误报总数
      prisma.vulnerability.count({
        where: {
          skillExecutionId: { in: skillExecutionIds },
          status: 'false-positive',
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

  const toCompactCase = (
    v: {
      id: string;
      title: string;
      description: string;
      location: string | null;
      status: string;
      falsePositiveReason?: string | null;
      updatedAt: Date;
    },
    maxLength: number
  ): CompactCase => ({
    vulnerabilityId: v.id,
    title: v.title,
    description:
      v.description.length > maxLength
        ? v.description.slice(0, maxLength)
        : v.description,
    location: v.location ?? undefined,
    status: v.status as 'false-positive' | 'confirmed',
    falsePositiveReason: v.falsePositiveReason ?? undefined,
    markedAt: v.updatedAt,
  });

  return {
    falsePositives: falsePositives.map((v) =>
      toCompactCase({ ...v, falsePositiveReason: v.falsePositiveReason }, maxDescriptionLength)
    ),
    confirmedCases: confirmedCases.map((v) =>
      toCompactCase(v, maxDescriptionLength)
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