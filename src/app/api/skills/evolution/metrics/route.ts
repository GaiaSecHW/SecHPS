// src/app/api/skills/evolution/metrics/route.ts
// GET - 获取全局进化指标概览

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { getAllSkillMetrics } from '@/services/skill-evolution/metrics-calculator';
import { getEvolutionTaskStats, getEvolutionConfig } from '@/services/skill-evolution/evolution-scheduler';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    // Get pagination params
    const { searchParams } = new URL(request.url);
    const skillsPage = parseInt(searchParams.get('skillsPage') || '1');
    const skillsLimit = parseInt(searchParams.get('skillsLimit') || '20');
    
    // Get all skill metrics
    const skillMetrics = await getAllSkillMetrics();
    
    // Get evolution task stats
    const taskStats = await getEvolutionTaskStats();
    
    // Get evolution config
    const config = await getEvolutionConfig();
    
    // Get total skills count
    const totalSkills = await prisma.skill.count({
      where: { isActive: true },
    });
    
    // Calculate global metrics
    const skillsWithData = skillMetrics.filter(m => m.totalExecutions > 0);
    const averagePrecision = skillsWithData.length > 0
      ? skillsWithData.reduce((sum, m) => sum + m.precision, 0) / skillsWithData.length
      : 0;
    
    const totalFindings = skillsWithData.reduce((sum, m) => sum + m.totalFindings, 0);
    const totalConfirmed = skillsWithData.reduce((sum, m) => sum + m.confirmedCount, 0);
    const totalFalsePositives = skillsWithData.reduce((sum, m) => sum + m.falsePositiveCount, 0);
    
    // Find skills needing evolution (below threshold AND has false positives)
    const skillsNeedingEvolution = skillMetrics.filter(
      m => m.totalExecutions > 0 && m.falsePositiveCount > 0 && m.precision < config.precisionThreshold
    );
    
    // Apply pagination to skills needing evolution
    const skillsTotal = skillsNeedingEvolution.length;
    const skillsOffset = (skillsPage - 1) * skillsLimit;
    const paginatedSkills = skillsNeedingEvolution.slice(skillsOffset, skillsOffset + skillsLimit);
    
    // Get evolution history count
    const evolutionHistoryCount = await prisma.skillEvolution.count();

    return NextResponse.json({
      overview: {
        totalSkills,
        skillsWithData: skillsWithData.length,
        averagePrecision,
        totalFindings,
        totalConfirmed,
        totalFalsePositives,
        skillsNeedingEvolution: skillsTotal,
        evolutionHistoryCount,
      },
      taskStats,
      config: {
        precisionThreshold: config.precisionThreshold,
        minFalsePositives: config.minFalsePositives,
        minConfirmed: config.minConfirmed,
        maxDailyTasks: config.maxDailyTasks,
        isActive: config.isActive,
      },
      skillsNeedingEvolution: paginatedSkills.map(m => ({
        skillId: m.skillId,
        skillName: m.skillName,
        displayName: m.displayName,
        totalExecutions: m.totalExecutions,
        successExecCount: m.successExecCount,
        successRate: m.successRate,
        totalFindings: m.totalFindings,
        confirmedCount: m.confirmedCount,
        falsePositiveCount: m.falsePositiveCount,
        precision: m.precision,
      })),
      skillsPagination: {
        total: skillsTotal,
        page: skillsPage,
        limit: skillsLimit,
        totalPages: Math.ceil(skillsTotal / skillsLimit),
      },
    });
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, 'Error fetching metrics', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: 'Failed to fetch evolution metrics' },
      { status: 500 }
    );
  }
}