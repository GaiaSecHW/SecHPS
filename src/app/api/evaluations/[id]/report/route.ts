// src/app/api/evaluations/[id]/report/route.ts
/**
 * 评估报告 API
 * 
 * GET: 获取评估报告数据
 * - 项目概况
 * - 项目架构分析
 * - 入口点分析
 * - 认证鉴权分析
 * - Skills 执行记录
 * - 漏洞分类关联链
 * - 漏洞发现汇总
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnalysisReport } from '@/services/analysis-report';
import { getSkillExecutionsByEvaluation } from '@/services/skill-execution-tracker';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    console.log(`[EvaluationReport] 开始获取报告: ${id}`);
    
    // 获取评估会话基本信息
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        Project: {
          select: {
            id: true,
            name: true,
            displayName: true,
            projectPath: true,
            techStack: true,
          },
        },
        AgentTeam: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    
    if (!evaluation) {
      console.log(`[EvaluationReport] 评估会话不存在: ${id}`);
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }
    
    console.log(`[EvaluationReport] 找到评估会话: ${id}, projectId=${evaluation.projectId}`);
    
    // 1. 获取分析报告
    let analysisReport = null;
    try {
      analysisReport = await getAnalysisReport(id);
      console.log(`[EvaluationReport] 分析报告: ${analysisReport ? '已获取' : '不存在'}`);
    } catch (err) {
      console.error('[EvaluationReport] 获取分析报告失败:', err);
    }
    
    // 2. 获取 Skills 执行记录
    let skillExecutions: any[] = [];
    try {
      skillExecutions = await getSkillExecutionsByEvaluation(id);
      console.log(`[EvaluationReport] Skills 执行记录: ${skillExecutions.length} 条`);
    } catch (err) {
      console.error('[EvaluationReport] 获取 Skills 执行记录失败:', err);
    }
    
    // 3. 获取漏洞分类关联链
    let vulnerabilityChain: any[] = [];
    try {
      vulnerabilityChain = await getVulnerabilityChain(evaluation.projectId, id);
      console.log(`[EvaluationReport] 漏洞分类关联链: ${vulnerabilityChain.length} 条`);
    } catch (err) {
      console.error('[EvaluationReport] 获取漏洞分类关联链失败:', err);
    }
    
    // 4. 获取漏洞发现汇总
    let vulnerabilitySummary = {
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      open: 0,
      confirmed: 0,
      fixed: 0,
      falsePositive: 0,
    };
    try {
      vulnerabilitySummary = await getVulnerabilitySummary(id);
      console.log(`[EvaluationReport] 漏洞发现汇总: ${vulnerabilitySummary.total} 个`);
    } catch (err) {
      console.error('[EvaluationReport] 获取漏洞发现汇总失败:', err);
    }
    
    // 5. 构建 Skills 统计
    const skillsStats = {
      total: skillExecutions.length,
      completed: skillExecutions.filter(e => e.status === 'completed').length,
      failed: skillExecutions.filter(e => e.status === 'failed').length,
      running: skillExecutions.filter(e => e.status === 'running').length,
      totalFindings: skillExecutions.reduce((sum, e) => sum + e.findingsCount, 0),
    };
    
    // 6. 构建评估概况
    const evaluationOverview = {
      id: evaluation.id,
      projectId: evaluation.projectId,
      projectName: evaluation.Project?.displayName || evaluation.Project?.name || '未知项目',
      workflowName: evaluation.AgentTeam?.name || '未指定',
      status: evaluation.status,
      startedAt: evaluation.startedAt,
      completedAt: evaluation.completedAt,
      endReason: evaluation.endReason,
      endMessage: evaluation.endMessage,
      totalInputTokens: evaluation.totalInputTokens,
      totalOutputTokens: evaluation.totalOutputTokens,
      duration: evaluation.completedAt && evaluation.startedAt
        ? Math.round((evaluation.completedAt.getTime() - evaluation.startedAt.getTime()) / 1000 / 60)
        : null,
    };
    
    return NextResponse.json({
      evaluation: evaluationOverview,
      analysisReport,
      skillExecutions: skillExecutions.map(e => ({
        id: e.id,
        skillId: e.skillId,
        skillName: e.Skill?.name,
        skillDisplayName: e.Skill?.displayName,
        skillSeverity: e.Skill?.severity,
        status: e.status,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        duration: e.duration,
        findingsCount: e.findingsCount,
        error: e.error,
      })),
      skillsStats,
      vulnerabilityChain,
      vulnerabilitySummary,
    });
    
  } catch (error) {
    console.error('[EvaluationReport] 获取报告失败:', error);
    return NextResponse.json(
      { error: `获取报告失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

/**
 * 获取漏洞分类关联链
 * VulnerabilityCategory → VulnerabilityPattern → Skills
 */
async function getVulnerabilityChain(projectId: string, evaluationId: string) {
  // 获取本次评估执行的 Skills
  const executedSkills = await prisma.skillExecution.findMany({
    where: { evaluationId },
    select: { skillId: true },
  });
  const skillIds = [...new Set(executedSkills.map(e => e.skillId))];
  
  if (skillIds.length === 0) {
    return [];
  }
  
  // 获取 Skills 关联的漏洞模式
  const skills = await prisma.skill.findMany({
    where: { id: { in: skillIds } },
    select: {
      id: true,
      name: true,
      displayName: true,
      severity: true,
      vulnerabilityPatternId: true,
    },
  });
  
  const patternIds = [...new Set(skills.filter(s => s.vulnerabilityPatternId).map(s => s.vulnerabilityPatternId))];
  
  if (patternIds.length === 0) {
    return skills.map(s => ({
      skillId: s.id,
      skillName: s.name,
      skillDisplayName: s.displayName,
      skillSeverity: s.severity,
      executed: true,
    }));
  }
  
  // 获取漏洞模式关联的分类
  const patterns = await prisma.vulnerabilityPattern.findMany({
    where: { id: { in: patternIds as string[] } },
    select: {
      id: true,
      name: true,
      displayName: true,
      categoryId: true,
    },
  });
  
  const categoryIds = [...new Set(patterns.filter(p => p.categoryId).map(p => p.categoryId))];
  
  let categories: any[] = [];
  if (categoryIds.length > 0) {
    categories = await prisma.vulnerabilityCategory.findMany({
      where: { id: { in: categoryIds as string[] } },
      select: {
        id: true,
        name: true,
        label: true,
      },
    });
  }
  
  // 构建关联链
  const chain: Array<{
    categoryId: string | null;
    categoryName: string;
    patternId: string | null;
    patternName: string;
    skills: Array<{
      skillId: string;
      skillName: string;
      skillDisplayName: string;
      skillSeverity: string | null;
      executed: boolean;
    }>;
  }> = [];
  
  // 按 Category → Pattern 分组
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  const patternMap = new Map(patterns.map(p => [p.id, p]));
  
  const groupedByPattern = new Map<string, any[]>();
  
  for (const skill of skills) {
    const patternId = skill.vulnerabilityPatternId;
    if (!patternId) {
      // 无关联模式的 Skill
      groupedByPattern.set('__no_pattern__', [
        ...(groupedByPattern.get('__no_pattern__') || []),
        {
          skillId: skill.id,
          skillName: skill.name,
          skillDisplayName: skill.displayName,
          skillSeverity: skill.severity,
          executed: true,
        },
      ]);
    } else {
      groupedByPattern.set(patternId, [
        ...(groupedByPattern.get(patternId) || []),
        {
          skillId: skill.id,
          skillName: skill.name,
          skillDisplayName: skill.displayName,
          skillSeverity: skill.severity,
          executed: true,
        },
      ]);
    }
  }
  
  // 构建链
  for (const [patternId, patternSkills] of groupedByPattern) {
    if (patternId === '__no_pattern__') {
      chain.push({
        categoryId: null,
        categoryName: '其他',
        patternId: null,
        patternName: '未分类',
        skills: patternSkills,
      });
    } else {
      const pattern = patternMap.get(patternId);
      const category = pattern?.categoryId ? categoryMap.get(pattern.categoryId) : null;
      
      chain.push({
        categoryId: category?.id || null,
        categoryName: category?.label || category?.name || '未知分类',
        patternId,
        patternName: pattern?.displayName || pattern?.name || '未知模式',
        skills: patternSkills,
      });
    }
  }
  
  return chain;
}

/**
 * 获取漏洞发现汇总
 */
async function getVulnerabilitySummary(evaluationId: string) {
  const vulnerabilities = await prisma.vulnerability.findMany({
    where: { evaluationId },
    select: {
      severity: true,
      status: true,
    },
  });
  
  const summary = {
    total: vulnerabilities.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    open: 0,
    confirmed: 0,
    fixed: 0,
    falsePositive: 0,
  };
  
  for (const vuln of vulnerabilities) {
    // 按严重程度统计
    switch (vuln.severity?.toLowerCase()) {
      case 'critical':
        summary.critical++;
        break;
      case 'high':
        summary.high++;
        break;
      case 'medium':
        summary.medium++;
        break;
      case 'low':
        summary.low++;
        break;
      case 'info':
        summary.info++;
        break;
    }
    
    // 按状态统计
    switch (vuln.status?.toLowerCase()) {
      case 'open':
        summary.open++;
        break;
      case 'confirmed':
        summary.confirmed++;
        break;
      case 'fixed':
        summary.fixed++;
        break;
      case 'false_positive':
        summary.falsePositive++;
        break;
    }
  }
  
  return summary;
}
