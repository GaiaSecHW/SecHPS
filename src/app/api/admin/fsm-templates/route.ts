import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

const LOG_MODULE = LOG_MODULES.WORKFLOW || 'fsm-templates';

// 获取所有 FSM 模板
export async function GET(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const { searchParams } = new URL(request.url);
    const isActiveParam = searchParams.get('isActive');

    const where: any = {};
    if (isActiveParam !== null) {
      where.isActive = isActiveParam === 'true';
    }

    const templates = await prisma.fSMTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const formattedTemplates = templates.map(template => ({
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
    }));

    logger.access(LOG_MODULE, payload, 'fsm_templates', { isActive: isActiveParam });
    return NextResponse.json({ templates: formattedTemplates });
  } catch (error) {
    logger.errorNoUser(LOG_MODULE, '获取 FSM 模板失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 创建新的 FSM 模板
export async function POST(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_CREATE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const body = await request.json();
    const { name, displayName, description, nodeCount, nodes, agentZone, skillPath, version, isActive } = body;

    if (!name || !displayName || !nodeCount || !nodes) {
      return NextResponse.json({ error: '缺少必填字段：name, displayName, nodeCount, nodes' }, { status: 400 });
    }

    if (!/^[a-z0-9-]+$/.test(name)) {
      return NextResponse.json({ error: 'name 必须是小写字母、数字和连字符组成' }, { status: 400 });
    }

    const existingTemplate = await prisma.fSMTemplate.findUnique({ where: { name } });
    if (existingTemplate) {
      return NextResponse.json({ error: `模板名称 "${name}" 已存在` }, { status: 400 });
    }

    if (!Array.isArray(nodes)) {
      return NextResponse.json({ error: 'nodes 必须是数组' }, { status: 400 });
    }

    const template = await prisma.fSMTemplate.create({
      data: {
        id: generateId('fsm'),
        name,
        displayName,
        description,
        nodeCount: nodes.length,
        nodes: JSON.stringify(nodes),
        agentZone: agentZone ? JSON.stringify(agentZone) : null,
        skillPath,
        version: version || '1.0.0',
        isActive: isActive !== undefined ? isActive : true,
        isBuiltin: false,
      },
    });

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

    logger.create(LOG_MODULE, payload, template.id, { name, displayName, nodeCount: template.nodeCount });
    return NextResponse.json({ template: formattedTemplate }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULE, '创建 FSM 模板失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
