// src/app/api/admin/fsm-templates/[id]/phases/[phase]/route.ts
/**
 * FSM 模板阶段内容 API
 * 
 * 读取和编辑 Skill 阶段文件 (P1-P8.md)
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import * as fs from 'fs';
import * as path from 'path';

interface RouteContext {
  params: Promise<{ id: string; phase: string }>;
}

const VALID_PHASES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

const PHASE_FILE_MAP: Record<string, string> = {
  'P1': 'P1-PROJECT-UNDERSTANDING.md',
  'P2': 'P2-DFD-ANALYSIS.md',
  'P3': 'P3-TRUST-BOUNDARY.md',
  'P4': 'P4-SECURITY-DESIGN-REVIEW.md',
  'P5': 'P5-STRIDE-ANALYSIS.md',
  'P6': 'P6-REPORT-GENERATION.md',
};

/**
 * GET - 获取阶段文件内容
 */
export async function GET(request: Request, context: RouteContext) {
  const { id, phase } = await context.params;
  
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    // 验证阶段编号
    if (!VALID_PHASES.includes(phase.toUpperCase())) {
      return NextResponse.json({ error: `无效阶段: ${phase}` }, { status: 400 });
    }

    // 获取 FSM 模板
    const template = await prisma.fSMTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json({ error: 'FSM 模板不存在' }, { status: 404 });
    }

    // 获取 Skill 路径
    const skillPath = template.skillPath;
    if (!skillPath) {
      return NextResponse.json({ error: '模板未配置 Skill 路径' }, { status: 400 });
    }

    // 读取阶段文件
    const phaseFile = PHASE_FILE_MAP[phase.toUpperCase()];
    const filePath = path.join(process.cwd(), skillPath, 'phases', phaseFile);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ 
        error: `阶段文件不存在: ${phaseFile}`,
        phase,
        file: phaseFile,
        path: filePath,
      }, { status: 404 });
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    logger.access(LOG_MODULES.FSM, payload, 'phase_content_read', { 
      templateId: id, 
      phase,
    });

    return NextResponse.json({
      phase,
      file: phaseFile,
      content,
      path: filePath,
      templateId: id,
      templateName: template.name,
    });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.FSM, '获取阶段内容失败', { 
      details: { error: String(error), templateId: id, phase } 
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * PUT - 更新阶段文件内容
 */
export async function PUT(request: Request, context: RouteContext) {
  const { id, phase } = await context.params;
  
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_UPDATE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  // 只有管理员可以编辑内置模板的阶段内容
  const userIsAdmin = isAdmin(payload);

  try {
    // 验证阶段编号
    if (!VALID_PHASES.includes(phase.toUpperCase())) {
      return NextResponse.json({ error: `无效阶段: ${phase}` }, { status: 400 });
    }

    // 获取 FSM 模板
    const template = await prisma.fSMTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json({ error: 'FSM 模板不存在' }, { status: 404 });
    }

    // 内置模板只有管理员可编辑
    if (template.isBuiltin && !userIsAdmin) {
      return NextResponse.json({ error: '内置模板只有管理员可编辑' }, { status: 403 });
    }

    // 解析请求体
    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: '内容不能为空' }, { status: 400 });
    }

    // 获取 Skill 路径
    const skillPath = template.skillPath;
    if (!skillPath) {
      return NextResponse.json({ error: '模板未配置 Skill 路径' }, { status: 400 });
    }

    // 写入阶段文件
    const phaseFile = PHASE_FILE_MAP[phase.toUpperCase()];
    const filePath = path.join(process.cwd(), skillPath, 'phases', phaseFile);

    // 确保目录存在
    const phasesDir = path.dirname(filePath);
    if (!fs.existsSync(phasesDir)) {
      fs.mkdirSync(phasesDir, { recursive: true });
    }

    // 保存旧版本（备份）
    if (fs.existsSync(filePath)) {
      const backupDir = path.join(process.cwd(), skillPath, 'phases', '.backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const backupFile = `${phaseFile}.${Date.now()}.bak`;
      const oldContent = fs.readFileSync(filePath, 'utf-8');
      fs.writeFileSync(path.join(backupDir, backupFile), oldContent, 'utf-8');
    }

    // 写入新内容
    fs.writeFileSync(filePath, content, 'utf-8');

    logger.update(LOG_MODULES.FSM, payload, 'phase_content_update', { 
      templateId: id, 
      phase,
      file: phaseFile,
    });

    return NextResponse.json({
      success: true,
      message: '阶段内容已更新',
      phase,
      file: phaseFile,
      path: filePath,
    });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.FSM, '更新阶段内容失败', { 
      details: { error: String(error), templateId: id, phase } 
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}