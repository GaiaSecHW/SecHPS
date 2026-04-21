import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

const LOG_MODULE = LOG_MODULES.WORKFLOW || 'fsm-templates';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 获取单个 FSM 模板
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const template = await prisma.fSMTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    const formattedTemplate = {
      id: template.id,
      name: template.name,
      displayName: template.displayName,
      description: template.description,
      nodeCount: template.nodeCount,
      nodes: JSON.parse(template.nodes),
      agentZone: template.agentZone ? JSON.parse(template.agentZone) : null,
      skillPath: template.skillPath,
      version: template.version,
      isActive: template.isActive,
      isBuiltin: template.isBuiltin,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };

    logger.access(LOG_MODULE, payload, 'fsm_template_detail', { templateId: id });
    return NextResponse.json({ template: formattedTemplate });
  } catch (error) {
    logger.errorNoUser(LOG_MODULE, '获取 FSM 模板详情失败', { details: { error: String(error), templateId: id } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新 FSM 模板
export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_UPDATE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const template = await prisma.fSMTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    // 内置模板不允许修改
    if (template.isBuiltin) {
      return NextResponse.json({ error: '内置模板不允许修改' }, { status: 403 });
    }

    const body = await request.json();
    const { displayName, description, nodes, agentZone, skillPath, version, isActive } = body;

    const updateData: any = {};
    
    if (displayName !== undefined) updateData.displayName = displayName;
    if (description !== undefined) updateData.description = description;
    if (nodes !== undefined) {
      if (!Array.isArray(nodes)) {
        return NextResponse.json({ error: 'nodes 必须是数组' }, { status: 400 });
      }
      updateData.nodes = JSON.stringify(nodes);
      updateData.nodeCount = nodes.length;
    }
    if (agentZone !== undefined) updateData.agentZone = agentZone ? JSON.stringify(agentZone) : null;
    if (skillPath !== undefined) updateData.skillPath = skillPath;
    if (version !== undefined) updateData.version = version;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedTemplate = await prisma.fSMTemplate.update({
      where: { id },
      data: updateData,
    });

    const formattedTemplate = {
      id: updatedTemplate.id,
      name: updatedTemplate.name,
      displayName: updatedTemplate.displayName,
      description: updatedTemplate.description,
      nodeCount: updatedTemplate.nodeCount,
      nodes: JSON.parse(updatedTemplate.nodes),
      agentZone: updatedTemplate.agentZone ? JSON.parse(updatedTemplate.agentZone) : null,
      skillPath: updatedTemplate.skillPath,
      version: updatedTemplate.version,
      isActive: updatedTemplate.isActive,
      isBuiltin: updatedTemplate.isBuiltin,
      createdAt: updatedTemplate.createdAt,
      updatedAt: updatedTemplate.updatedAt,
    };

    logger.update(LOG_MODULE, payload, id, { displayName, nodeCount: template.nodeCount });
    return NextResponse.json({ template: formattedTemplate });
  } catch (error) {
    logger.errorNoUser(LOG_MODULE, '更新 FSM 模板失败', { details: { error: error instanceof Error ? error.message : String(error), templateId: id } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除 FSM 模板
export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_DELETE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const template = await prisma.fSMTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    if (template.isBuiltin) {
      return NextResponse.json({ error: '内置模板不允许删除' }, { status: 403 });
    }

    const workflowsCount = await prisma.workflow.count({
      where: { fsmTemplateId: id },
    });
    if (workflowsCount > 0) {
      return NextResponse.json(
        { error: `有 ${workflowsCount} 个工作流正在使用此模板，无法删除` },
        { status: 400 }
      );
    }

    await prisma.fSMTemplate.delete({
      where: { id },
    });

    logger.delete(LOG_MODULE, payload, id, { name: template.name, displayName: template.displayName });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.errorNoUser(LOG_MODULE, '删除 FSM 模板失败', { details: { error: error instanceof Error ? error.message : String(error), templateId: id } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
