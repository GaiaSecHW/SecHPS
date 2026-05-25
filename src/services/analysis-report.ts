// src/services/analysis-report.ts
/**
 * 分析报告存储服务
 *
 * 功能：
 * 1. 存储大模型分析的项目架构、入口点、认证鉴权等内容
 * 2. 存储到数据库 AnalysisReport 模型
 * 3. 供前端评估报告 Tab 展示
 */

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 项目概况
 */
export interface ProjectOverview {
  projectName: string;
  description: string;
  techStack: string[];
}

/**
 * 项目架构分析
 */
export interface ArchitectureAnalysis {
  projectType: string;
  frontend?: string;
  backend?: string;
  database?: string;
  directoryStructure?: Record<string, string>;
  summary: string;
}

/**
 * API 端点
 */
export interface ApiEndpoint {
  method: string;
  path: string;
  auth: 'public' | 'authenticated' | 'admin';
  description?: string;
}

/**
 * 页面入口
 */
export interface PageEntry {
  path: string;
  description: string;
  authRequired?: boolean;
}

/**
 * 用户输入点
 */
export interface UserInputPoint {
  location: string;
  fields: string[];
  type?: string;
}

/**
 * 入口点分析
 */
export interface EntryPointsAnalysis {
  apiEndpoints: ApiEndpoint[];
  pageEntries: PageEntry[];
  userInputPoints: UserInputPoint[];
  summary?: string;
}

/**
 * 安全配置
 */
export interface SecurityConfig {
  https?: boolean;
  cors?: string;
  csp?: boolean;
  csrf?: boolean;
  [key: string]: any;
}

/**
 * 认证鉴权分析
 */
export interface AuthenticationAnalysis {
  authType: string;
  tokenStorage?: string;
  tokenExpiry?: string;
  refreshMechanism?: string;
  authzModel?: string;
  roles?: string[];
  sessionManagement?: {
    login?: string;
    logout?: string;
    refresh?: string;
  };
  securityConfig?: SecurityConfig;
  summary: string;
}

/**
 * 完整分析报告（前端展示用）
 */
export interface AnalysisReportData {
  id: string;
  evaluationId: string;
  projectId: string;
  
  projectOverview: ProjectOverview;
  architecture: ArchitectureAnalysis;
  entryPoints: EntryPointsAnalysis;
  authentication: AuthenticationAnalysis;
  
  analyzedAt: Date | null;
  createdAt: Date;
}

/**
 * 创建空的分析报告（评估启动时调用）
 */
export async function createEmptyAnalysisReport(params: {
  evaluationId: string;
  projectId: string;
}): Promise<string> {
  const id = `analysis-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
  await prisma.analysisReport.create({
    data: {
      id,
      evaluationId: params.evaluationId,
      projectId: params.projectId,
      projectName: '',
      description: '',
      updatedAt: new Date(),
    },
  });

  logger.info(LOG_MODULES.REPORT, '创建分析报告', { details: { id } });
  return id;
}

/**
 * 更新分析报告（大模型输出后调用）
 */
export async function updateAnalysisReport(params: {
  evaluationId: string;
  data: {
    projectName?: string;
    description?: string;
    techStack?: string[];
    projectType?: string;
    frontend?: string;
    backend?: string;
    database?: string;
    directoryStructure?: Record<string, string>;
    architectureSummary?: string;
    apiEndpoints?: ApiEndpoint[];
    pageEntries?: PageEntry[];
    userInputPoints?: UserInputPoint[];
    entryPointsSummary?: string;
    authType?: string;
    tokenStorage?: string;
    tokenExpiry?: string;
    refreshMechanism?: string;
    authzModel?: string;
    roles?: string[];
    sessionManagement?: Record<string, string>;
    securityConfig?: SecurityConfig;
    authSummary?: string;
    rawContent?: string;
  };
}): Promise<boolean> {
  try {
    await prisma.analysisReport.update({
      where: { evaluationId: params.evaluationId },
      data: {
        ...params.data,
        techStack: params.data.techStack ? JSON.stringify(params.data.techStack) : undefined,
        directoryStructure: params.data.directoryStructure ? JSON.stringify(params.data.directoryStructure) : undefined,
        apiEndpoints: params.data.apiEndpoints ? JSON.stringify(params.data.apiEndpoints) : undefined,
        pageEntries: params.data.pageEntries ? JSON.stringify(params.data.pageEntries) : undefined,
        userInputPoints: params.data.userInputPoints ? JSON.stringify(params.data.userInputPoints) : undefined,
        roles: params.data.roles ? JSON.stringify(params.data.roles) : undefined,
        sessionManagement: params.data.sessionManagement ? JSON.stringify(params.data.sessionManagement) : undefined,
        securityConfig: params.data.securityConfig ? JSON.stringify(params.data.securityConfig) : undefined,
        analyzedAt: new Date(),
      },
    });

    logger.info(LOG_MODULES.REPORT, '更新分析报告', { details: { evaluationId: params.evaluationId } });
    return true;
  } catch (error) {
    logger.error(LOG_MODULES.REPORT, '更新失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return false;
  }
}

/**
 * 获取分析报告
 */
export async function getAnalysisReport(evaluationId: string): Promise<AnalysisReportData | null> {
  try {
    const report = await prisma.analysisReport.findUnique({
      where: { evaluationId },
    });
    
    if (!report) return null;
    
    // 安全解析 JSON 字段
    const safeParseJson = (str: string | null, defaultValue: any = []) => {
      if (!str) return defaultValue;
      try {
        return JSON.parse(str);
      } catch {
        return defaultValue;
      }
    };
    
    return {
      id: report.id,
      evaluationId: report.evaluationId,
      projectId: report.projectId,
      
      projectOverview: {
        projectName: report.projectName || '',
        description: report.description || '',
        techStack: safeParseJson(report.techStack, []),
      },
      
      architecture: {
        projectType: report.projectType || '',
        frontend: report.frontend || undefined,
        backend: report.backend || undefined,
        database: report.database || undefined,
        directoryStructure: safeParseJson(report.directoryStructure, undefined),
        summary: report.architectureSummary || '',
      },
      
      entryPoints: {
        apiEndpoints: safeParseJson(report.apiEndpoints, []),
        pageEntries: safeParseJson(report.pageEntries, []),
        userInputPoints: safeParseJson(report.userInputPoints, []),
        summary: report.entryPointsSummary || undefined,
      },
      
      authentication: {
        authType: report.authType || '',
        tokenStorage: report.tokenStorage || undefined,
        tokenExpiry: report.tokenExpiry || undefined,
        refreshMechanism: report.refreshMechanism || undefined,
        authzModel: report.authzModel || undefined,
        roles: safeParseJson(report.roles, undefined),
        sessionManagement: safeParseJson(report.sessionManagement, undefined),
        securityConfig: safeParseJson(report.securityConfig, undefined),
        summary: report.authSummary || '',
      },
      
      analyzedAt: report.analyzedAt,
      createdAt: report.createdAt,
    };
  } catch (error) {
    logger.error(LOG_MODULES.REPORT, '获取失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return null;
  }
}

/**
 * 获取项目的所有分析报告
 */
export async function listAnalysisReports(projectId: string): Promise<Array<{
  id: string;
  evaluationId: string;
  projectName: string;
  analyzedAt: Date | null;
  createdAt: Date;
}>> {
  const reports = await prisma.analysisReport.findMany({
    where: { projectId },
    select: {
      id: true,
      evaluationId: true,
      projectName: true,
      analyzedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  
  return reports;
}

/**
 * 从大模型输出中解析分析报告
 */
export function parseAnalysisFromOutput(output: string): Partial<AnalysisReportData> | null {
  try {
    const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      
      if (parsed.projectOverview || parsed.architecture || parsed.entryPoints || parsed.authentication) {
        logger.info(LOG_MODULES.REPORT, '从输出中解析到分析报告');
        return parsed;
      }
    }
    
    try {
      const parsed = JSON.parse(output);
      if (parsed.projectOverview || parsed.architecture || parsed.entryPoints || parsed.authentication) {
        return parsed;
      }
    } catch {
      // 不是 JSON 格式
    }
    
    return null;
  } catch (error) {
    logger.error(LOG_MODULES.REPORT, '解析失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return null;
  }
}
