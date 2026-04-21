// src/app/api/evaluations/[id]/report/sections/[section]/route.ts
/**
 * FSM 报告章节 API
 * 
 * 获取单个报告章节内容
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
  params: Promise<{ id: string; section: string }>;
}

const SECTION_FILE_MAP: Record<string, string> = {
  'risk-assessment': 'RISK-ASSESSMENT-REPORT.md',
  'risk-inventory': 'RISK-INVENTORY.md',
  'mitigation': 'MITIGATION-MEASURES.md',
  'pen-test': 'PENETRATION-TEST-PLAN.md',
  'architecture': 'ARCHITECTURE-ANALYSIS.md',
  'dfd': 'DFD-DIAGRAM.md',
  'compliance': 'COMPLIANCE-REPORT.md',
  'attack-path': 'ATTACK-PATH-VALIDATION.md',
};

export async function GET(request: Request, context: RouteContext) {
  const { id, section } = await context.params;
  
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.EVALUATION_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    // 获取评估会话
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        Project: { select: { projectPath: true } },
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

    if (!workflow || workflow.workflowType !== 'fsm') {
      return NextResponse.json({ error: '非 FSM 工作流，不支持章节查看' }, { status: 400 });
    }

    // 获取报告记录
    const report = await prisma.report.findUnique({
      where: { sessionId: id },
    });

    if (!report) {
      return NextResponse.json({ error: '报告尚未生成' }, { status: 404 });
    }

    // 获取章节文件名
    const sectionFile = SECTION_FILE_MAP[section.toLowerCase()];
    if (!sectionFile) {
      return NextResponse.json({ error: `未知章节: ${section}` }, { status: 400 });
    }

    // 读取章节内容
    const workspacePath = evaluation.Project?.projectPath || '';
    const reportsPath = path.join(workspacePath, '.claude', 'skills', workflow.FSMTemplate?.name || 'threat-modeling', 'reports');
    const filePath = path.join(reportsPath, sectionFile);

    if (!fs.existsSync(filePath)) {
      // 尝试从 integratedReports JSON 获取路径
      try {
        const integratedReports = JSON.parse(report.integratedReports || '{}');
        const alternatePath = integratedReports[section.toLowerCase().replace('-', '')];
        if (alternatePath && fs.existsSync(alternatePath)) {
          const content = fs.readFileSync(alternatePath, 'utf-8');
          logger.access(LOG_MODULE, payload, 'report_section', { sessionId: id, section });
          return NextResponse.json({
            section,
            title: sectionFile.replace('.md', '').replace('-', ' '),
            content,
            path: alternatePath,
          });
        }
      } catch {
        // JSON 解析失败
      }

      return NextResponse.json({ error: `章节文件不存在: ${sectionFile}` }, { status: 404 });
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    logger.access(LOG_MODULE, payload, 'report_section', { sessionId: id, section });

    return NextResponse.json({
      section,
      title: sectionFile.replace('.md', '').replace('-', ' '),
      content,
      path: filePath,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULE, '获取报告章节失败', { details: { error: String(error), sessionId: id, section } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}