// src/app/api/agent-definitions/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/agent-definitions/:id - 获取 Agent 定义详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.AGENT_DEFINITION_READ)) {
      return NextResponse.json({ error: '禁止访问 - 需要 agent-definition:read 权限' }, { status: 403 });
    }

    const { id } = await params;

    const agentDefinition = await prisma.agentDefinition.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        modelConfig: true,
      },
    });

    if (!agentDefinition) {
      return NextResponse.json({ error: 'Agent 定义不存在' }, { status: 404 });
    }

    // 检查访问权限：私有 Agent 只有创建者可以访问
    if (!agentDefinition.isBuiltin && agentDefinition.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问 - 您只能查看内置 Agent 或您自己的 Agent' }, { status: 403 });
    }

    logger.read(LOG_MODULES.AGENT, payload, 'agent-definition', id, { name: agentDefinition.name });

    return NextResponse.json({
      agentDefinition: {
        ...agentDefinition,
        allowedTools: agentDefinition.allowedTools ? JSON.parse(agentDefinition.allowedTools) : [],
        skills: agentDefinition.skills ? JSON.parse(agentDefinition.skills) : [],
        mcpServers: agentDefinition.mcpServers ? JSON.parse(agentDefinition.mcpServers) : [],
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '获取 Agent 定义详情错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PATCH /api/agent-definitions/:id - 更新 Agent 定义
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.AGENT_DEFINITION_UPDATE)) {
      return NextResponse.json({ error: '禁止访问 - 需要 agent-definition:update 权限' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const agentDefinition = await prisma.agentDefinition.findUnique({ where: { id } });
    if (!agentDefinition) {
      return NextResponse.json({ error: 'Agent 定义不存在' }, { status: 404 });
    }

    // 检查是否为内置 Agent
    if (agentDefinition.isBuiltin) {
      return NextResponse.json({ error: '禁止访问 - 内置 Agent 不可修改' }, { status: 403 });
    }

    // 检查权限：只有创建者可以修改自己的 Agent
    if (agentDefinition.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问 - 只能修改自己的 Agent' }, { status: 403 });
    }

    // 构建更新数据
    const updateData: Record<string, unknown> = {};
    if (body.displayName !== undefined) updateData.displayName = body.displayName;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.model !== undefined) updateData.model = body.model;
    if (body.modelConfigId !== undefined) updateData.modelConfigId = body.modelConfigId || null;
    if (body.systemPrompt !== undefined) updateData.systemPrompt = body.systemPrompt || null;
    if (body.allowedTools !== undefined) updateData.allowedTools = body.allowedTools ? JSON.stringify(body.allowedTools) : null;
    if (body.skills !== undefined) updateData.skills = body.skills ? JSON.stringify(body.skills) : null;
    if (body.mcpServers !== undefined) updateData.mcpServers = body.mcpServers ? JSON.stringify(body.mcpServers) : null;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const updatedAgent = await prisma.agentDefinition.update({
      where: { id },
      data: updateData,
    });

    logger.update(LOG_MODULES.AGENT, payload, id, { name: agentDefinition.name, updates: Object.keys(updateData) });

    return NextResponse.json({
      agentDefinition: {
        ...updatedAgent,
        allowedTools: updatedAgent.allowedTools ? JSON.parse(updatedAgent.allowedTools) : [],
        skills: updatedAgent.skills ? JSON.parse(updatedAgent.skills) : [],
        mcpServers: updatedAgent.mcpServers ? JSON.parse(updatedAgent.mcpServers) : [],
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '更新 Agent 定义错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/agent-definitions/:id - 删除 Agent 定义
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.AGENT_DEFINITION_DELETE)) {
      return NextResponse.json({ error: '禁止访问 - 需要 agent-definition:delete 权限' }, { status: 403 });
    }

    const { id } = await params;

    const agentDefinition = await prisma.agentDefinition.findUnique({ where: { id } });
    if (!agentDefinition) {
      return NextResponse.json({ error: 'Agent 定义不存在' }, { status: 404 });
    }

    // 检查权限：内置 Agent 不可删除
    if (agentDefinition.isBuiltin) {
      return NextResponse.json({ error: '禁止访问 - 内置 Agent 不可删除' }, { status: 403 });
    }

    // 检查权限：只有创建者可以删除自己的 Agent
    if (agentDefinition.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问 - 只能删除自己的 Agent' }, { status: 403 });
    }

    await prisma.agentDefinition.delete({ where: { id } });

    logger.delete(LOG_MODULES.AGENT, payload, id, { name: agentDefinition.name });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '删除 Agent 定义错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}