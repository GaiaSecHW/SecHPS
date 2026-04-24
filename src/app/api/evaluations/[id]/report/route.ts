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
 * - 漏洞发现汇总（按漏洞类型分类，支持分页和筛选）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnalysisReport } from '@/services/analysis-report';
import { getSkillExecutionsByEvaluation } from '@/services/skill-execution-tracker';
import { logger, LOG_MODULES } from '@/lib/logger';

// 缓存漏洞模式映射表
let vulnerabilityPatternMap: Map<string, { categoryId: string; categoryName: string; patternName: string }> | null = null;

/**
 * 获取漏洞模式映射表（带缓存）
 */
async function getVulnerabilityPatternMap(): Promise<Map<string, { categoryId: string; categoryName: string; patternName: string }>> {
  if (vulnerabilityPatternMap) {
    return vulnerabilityPatternMap;
  }
  
  // 查询所有漏洞模式和分类
  const patterns = await prisma.vulnerabilityPattern.findMany({
    select: {
      id: true,
      name: true,
      displayName: true,
      categoryId: true,
    },
  });
  
  const categoryIds = [...new Set(patterns.filter(p => p.categoryId).map(p => p.categoryId))];
  
  const categories = await prisma.vulnerabilityCategory.findMany({
    where: { id: { in: categoryIds as string[] } },
    select: { id: true, value: true, label: true },
  });
  
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  
  // 构建映射表：name -> 分类信息
  vulnerabilityPatternMap = new Map();
  
  for (const pattern of patterns) {
    const category = pattern.categoryId ? categoryMap.get(pattern.categoryId) : null;
    const mapping = {
      categoryId: category?.id || 'other',
      categoryName: category?.label || '其他',
      patternName: pattern.displayName || pattern.name,
    };
    
    // 同时存储 name 和 displayName 作为 key
    vulnerabilityPatternMap.set(pattern.name.toLowerCase(), mapping);
    if (pattern.displayName) {
      vulnerabilityPatternMap.set(pattern.displayName.toLowerCase(), mapping);
    }
  }
  
  // 添加常见漏洞类型的别名映射
  const aliases: Record<string, string> = {
    'sql injection': 'sql-injection',
    'sql注入': 'sql-injection',
    'xss': 'xss',
    'cross-site scripting': 'xss',
    '跨站脚本': 'xss',
    'command injection': 'command-injection',
    '命令注入': 'command-injection',
    'path traversal': 'path-traversal',
    '路径遍历': 'path-traversal',
    'ssrf': 'ssrf',
    'server-side request forgery': 'ssrf',
    '服务端请求伪造': 'ssrf',
    'hardcoded credentials': 'hardcoded-credentials',
    'hardcoded password': 'hardcoded-credentials',
    '硬编码密码': 'hardcoded-credentials',
    '硬编码凭证': 'hardcoded-credentials',
    'sensitive data exposure': 'sensitive-data',
    '敏感信息泄露': 'sensitive-data',
    'broken authentication': 'broken-authentication',
    '认证绕过': 'broken-authentication',
    'csrf': 'csrf',
    'cross-site request forgery': 'csrf',
    '跨站请求伪造': 'csrf',
    'insecure deserialization': 'insecure-deserialization',
    '不安全的反序列化': 'insecure-deserialization',
    'xxe': 'xxe',
    'xml external entity': 'xxe',
    'xml外部实体': 'xxe',
    'ldap injection': 'ldap-injection',
    'ldap注入': 'ldap-injection',
    'open redirect': 'open-redirect',
    '开放重定向': 'open-redirect',
    'information disclosure': 'information-disclosure',
    '信息泄露': 'information-disclosure',
    'security misconfiguration': 'security-misconfiguration',
    '安全配置错误': 'security-misconfiguration',
    'broken access control': 'broken-access-control',
    '访问控制失效': 'broken-access-control',
    'using components with known vulnerabilities': 'vulnerable-components',
    '使用含有已知漏洞的组件': 'vulnerable-components',
    'insufficient logging': 'insufficient-logging',
    '日志不足': 'insufficient-logging',
  };
  
  for (const [alias, patternName] of Object.entries(aliases)) {
    const mapping = vulnerabilityPatternMap.get(patternName);
    if (mapping) {
      vulnerabilityPatternMap.set(alias.toLowerCase(), mapping);
    }
  }
  
  return vulnerabilityPatternMap;
}

/**
 * 映射漏洞类型到标准分类
 */
function mapVulnerabilityType(
  type: string,
  patternMap: Map<string, { categoryId: string; categoryName: string; patternName: string }>
): { categoryId: string; categoryName: string; patternName: string } {
  const normalizedType = type.toLowerCase().trim();
  
  // 直接匹配
  const directMatch = patternMap.get(normalizedType);
  if (directMatch) {
    return directMatch;
  }
  
  // 模糊匹配：检查是否包含关键词
  for (const [key, value] of patternMap.entries()) {
    if (normalizedType.includes(key) || key.includes(normalizedType)) {
      return value;
    }
  }
  
  // 未匹配，返回"其他"
  return {
    categoryId: 'other',
    categoryName: '其他',
    patternName: type || '未知类型',
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    
    // 分页参数
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    
    // 筛选参数
    const filterType = searchParams.get('type') || '';
    const filterStatus = searchParams.get('status') || '';
    
    logger.debug(LOG_MODULES.EVALUATION, '开始获取报告:', { details: { id, page, pageSize } });
    
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
      logger.debug(LOG_MODULES.EVALUATION, '评估会话不存在:', { details: { id } });
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }
    
    logger.debug(LOG_MODULES.EVALUATION, '找到评估会话:', { details: { id, projectId: evaluation.projectId } });
    
    // 1. 获取分析报告
    let analysisReport = null;
    try {
      analysisReport = await getAnalysisReport(id);
      logger.debug(LOG_MODULES.EVALUATION, '分析报告:', { details: { status: analysisReport ? '已获取' : '不存在' } });
    } catch (err) {
      logger.errorNoUser(LOG_MODULES.EVALUATION, '获取分析报告失败:', { details: { error: String(err) } });
    }
    
    // 2. 获取 Skills 执行记录
    let skillExecutions: any[] = [];
    try {
      skillExecutions = await getSkillExecutionsByEvaluation(id);
      logger.debug(LOG_MODULES.EVALUATION, 'Skills 执行记录:', { details: { count: skillExecutions.length } });
    } catch (err) {
      logger.errorNoUser(LOG_MODULES.EVALUATION, '获取 Skills 执行记录失败:', { details: { error: String(err) } });
    }
    
    // 3. 获取漏洞分类关联链
    let vulnerabilityChain: any[] = [];
    try {
      vulnerabilityChain = await getVulnerabilityChain(evaluation.projectId, id);
      logger.debug(LOG_MODULES.EVALUATION, '漏洞分类关联链:', { details: { count: vulnerabilityChain.length } });
    } catch (err) {
      logger.errorNoUser(LOG_MODULES.EVALUATION, '获取漏洞分类关联链失败:', { details: { error: String(err) } });
    }
    
    // 4. 获取漏洞发现汇总（带分页和筛选）
    let vulnerabilitySummary: any = {
      total: 0,
      byType: [],
      byStatus: { open: 0, confirmed: 0, fixed: 0, falsePositive: 0 },
      details: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    };
    try {
      vulnerabilitySummary = await getVulnerabilitySummary(id, { page, pageSize, filterType, filterStatus });
      logger.debug(LOG_MODULES.EVALUATION, '漏洞发现汇总:', { details: { total: vulnerabilitySummary.total } });
    } catch (err) {
      logger.errorNoUser(LOG_MODULES.EVALUATION, '获取漏洞发现汇总失败:', { details: { error: String(err) } });
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
      workflowType: evaluation.workflowType || 'dag',  // FSM 报告类型标识
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
    logger.errorNoUser(LOG_MODULES.EVALUATION, '获取报告失败:', { details: { error: error instanceof Error ? error.message : String(error) } });
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
 * 获取漏洞发现汇总（按漏洞类型分类，支持分页和筛选）
 */
async function getVulnerabilitySummary(
  evaluationId: string,
  options: { page: number; pageSize: number; filterType: string; filterStatus: string }
) {
  const { page, pageSize, filterType, filterStatus } = options;
  
  // 获取漏洞模式映射表
  const patternMap = await getVulnerabilityPatternMap();
  
  // 构建查询条件
  const where: any = { evaluationId };
  if (filterStatus) {
    where.status = filterStatus;
  }
  
  // 获取总数
  const total = await prisma.vulnerability.count({ where });
  
  // 获取所有漏洞（用于统计）
  const allVulnerabilities = await prisma.vulnerability.findMany({
    where,
    select: {
      id: true,
      title: true,
      type: true,
      severity: true,
      status: true,
      cwe: true,
      filePath: true,
      lineStart: true,
      lineEnd: true,
      description: true,
      createdAt: true,
      skill: true,
      skillExecutionId: true,
      SkillExecution: {
        select: {
          skillId: true,
          Skill: {
            select: {
              name: true,
              displayName: true,
            },
          },
        },
      },
    },
  });
  
  // 按标准分类统计
  const byCategory: Record<string, { categoryName: string; count: number; vulnerabilities: any[] }> = {};
  
  for (const vuln of allVulnerabilities) {
    const mapping = mapVulnerabilityType(vuln.type || '', patternMap);
    const categoryId = mapping.categoryId;
    
    if (!byCategory[categoryId]) {
      byCategory[categoryId] = {
        categoryName: mapping.categoryName,
        count: 0,
        vulnerabilities: [],
      };
    }
    
    byCategory[categoryId].count++;
    byCategory[categoryId].vulnerabilities.push({
      ...vuln,
      mappedCategory: mapping.categoryName,
      mappedPattern: mapping.patternName,
    });
  }
  
  // 转换为数组并排序（只保留有漏洞的分类）
  const typeStats = Object.entries(byCategory)
    .filter(([, data]) => data.count > 0)
    .map(([categoryId, data]) => ({
      categoryId,
      categoryName: data.categoryName,
      count: data.count,
    }))
    .sort((a, b) => b.count - a.count);
  
  // 按状态统计
  const statusStats = {
    open: 0,
    confirmed: 0,
    fixed: 0,
    falsePositive: 0,
  };
  
  for (const vuln of allVulnerabilities) {
    switch (vuln.status?.toLowerCase()) {
      case 'new':
      case 'open':
        statusStats.open++;
        break;
      case 'confirmed':
        statusStats.confirmed++;
        break;
      case 'fixed':
      case 'verified':
        statusStats.fixed++;
        break;
      case 'false-positive':
        statusStats.falsePositive++;
        break;
    }
  }
  
  // 筛选和分页漏洞明细
  let filteredVulnerabilities = allVulnerabilities;
  
  // 按类型筛选
  if (filterType) {
    filteredVulnerabilities = filteredVulnerabilities.filter(v => {
      const mapping = mapVulnerabilityType(v.type || '', patternMap);
      return mapping.categoryId === filterType || mapping.categoryName === filterType;
    });
  }
  
  // 分页
  const totalFiltered = filteredVulnerabilities.length;
  const totalPages = Math.ceil(totalFiltered / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedVulnerabilities = filteredVulnerabilities.slice(startIndex, startIndex + pageSize);
  
  // 构建明细列表（不含严重程度）
  const details = paginatedVulnerabilities.map(v => {
    const mapping = mapVulnerabilityType(v.type || '', patternMap);
    // 获取 skill 名称：优先从 SkillExecution 关联，其次从 vulnerability.skill 字段
    const skillName = v.SkillExecution?.Skill?.displayName || 
                      v.SkillExecution?.Skill?.name || 
                      v.skill || 
                      '未知';
    return {
      id: v.id,
      type: mapping.categoryName,  // 使用映射后的标准分类名称
      patternName: mapping.patternName,  // 具体的漏洞模式名称
      originalType: v.type,  // 原始类型（AI 生成的）
      title: v.title,
      severity: v.severity,  // 严重程度
      status: v.status || 'new',
      cwe: v.cwe,
      filePath: v.filePath,
      lineStart: v.lineStart,
      lineEnd: v.lineEnd,
      description: v.description,
      createdAt: v.createdAt,  // 创建时间
      skillName,  // 发现该漏洞的 Skill 名称
    };
  });
  
  return {
    total,
    byType: typeStats,
    byStatus: statusStats,
    details,
    pagination: {
      page,
      pageSize,
      total: totalFiltered,
      totalPages,
    },
  };
}
