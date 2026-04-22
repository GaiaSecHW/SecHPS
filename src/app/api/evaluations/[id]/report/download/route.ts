// src/app/api/evaluations/[id]/report/download/route.ts
/**
 * FSM 报告下载 API
 * 
 * 支持下载完整报告（Markdown 或打包）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import * as fs from 'fs';
import * as path from 'path';

const LOG_MODULE = LOG_MODULES.EVALUATION || 'report';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.EVALUATION_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'markdown'; // 'markdown' | 'json'

    // 获取评估会话
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        Project: { select: { name: true, displayName: true, projectPath: true } },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 检查是否是 FSM 类型 (通过 EvaluationSession.workflowId 关联)
    let workflow = null;
    if (evaluation.workflowId) {
      workflow = await prisma.workflow.findUnique({
        where: { id: evaluation.workflowId },
        include: { FSMTemplate: true },
      });
    }

    // 获取报告记录
    const report = await prisma.report.findUnique({
      where: { sessionId: id },
    });

    if (!report) {
      return NextResponse.json({ error: '报告尚未生成' }, { status: 404 });
    }

    const projectName = evaluation.Project?.displayName || evaluation.Project?.name || 'project';
    const timestamp = new Date().toISOString().split('T')[0];

    if (format === 'json') {
      // JSON 格式：返回结构化数据
      logger.access(LOG_MODULE, payload, 'report_download', { sessionId: id, format: 'json' });
      
      return NextResponse.json({
        report: {
          id: report.id,
          sessionId: report.sessionId,
          projectId: report.projectId,
          reportType: report.reportType,
          workflowType: report.workflowType,
          fsmTemplate: report.fsmTemplate,
          title: report.title,
          description: report.description,
          totalFindings: report.totalFindings,
          criticalCount: report.criticalCount,
          highCount: report.highCount,
          mediumCount: report.mediumCount,
          lowCount: report.lowCount,
          status: report.status,
          generatedAt: report.generatedAt,
          mainReportContent: report.mainReportContent,
          integratedReports: JSON.parse(report.integratedReports || '{}'),
          dataSources: JSON.parse(report.dataSources || '{}'),
        },
      });
    }

    // Markdown 格式 - 使用 outputs/skills 替代 .claude/skills
    const workspacePath = evaluation.Project?.projectPath || '';
    const templateName = workflow?.FSMTemplate?.name || 'threat-modeling';
    const reportsPath = path.join(workspacePath, 'outputs', 'skills', templateName, 'reports');

    // 读取所有报告文件并合并
    const reportFiles = [
      'RISK-ASSESSMENT-REPORT.md',
      'RISK-INVENTORY.md',
      'MITIGATION-MEASURES.md',
      'PENETRATION-TEST-PLAN.md',
      'ARCHITECTURE-ANALYSIS.md',
      'DFD-DIAGRAM.md',
      'COMPLIANCE-REPORT.md',
      'ATTACK-PATH-VALIDATION.md',
    ];

    let fullContent = `# Threat Modeling Report - ${projectName}

**Generated**: ${timestamp}
**Session ID**: ${id}
**Template**: ${templateName}

---

`;

    for (const file of reportFiles) {
      const filePath = path.join(reportsPath, file);
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        fullContent += content + '\n\n---\n\n';
      } else {
        fullContent += `## ${file.replace('.md', '')}\n\n*Section not available*\n\n---\n\n`;
      }
    }

    // 返回 Markdown 文件
    logger.access(LOG_MODULE, payload, 'report_download', { sessionId: id, format: 'markdown' });
    
    return new NextResponse(fullContent, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="threat-modeling-report-${projectName}-${timestamp}.md"`,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULE, '下载报告失败', { details: { error: String(error), sessionId: id } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}