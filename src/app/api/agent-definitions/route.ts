// src/app/api/agent-definitions/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/agent-definitions - 获取 Agent 定义列表
// 返回用户可用的所有 Agent 定义（内置 + 用户自定义）
export async function GET(request: Request) {
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

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const isActive = searchParams.get('isActive');
    const scope = searchParams.get('scope') || 'all'; // public | mine | all

    // 构建查询条件
    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (isActive !== null) where.isActive = isActive === 'true';

    // 作用域过滤
    if (scope === 'public') {
      where.isBuiltin = true; // 只返回内置 Agent
    } else if (scope === 'mine') {
      where.userId = payload.userId; // 用户自定义 Agent
      where.isBuiltin = false;
    } else {
      // scope === 'all: 用户可用的 Agent 定义：内置 + 用户自定义
      where.OR = [
        { isBuiltin: true }, // 内置 Agent
        { userId: payload.userId }, // 用户自定义 Agent
      ];
    }

    const agentDefinitions = await prisma.agentDefinition.findMany({
      where,
      orderBy: [{ isBuiltin: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    });

    // 转换数据格式，解析 JSON 字段
    const formattedAgents = agentDefinitions.map(agent => ({
      ...agent,
      allowedTools: agent.allowedTools ? JSON.parse(agent.allowedTools) : [],
      skills: agent.skills ? JSON.parse(agent.skills) : [],
      mcpServers: agent.mcpServers ? JSON.parse(agent.mcpServers) : [],
    }));

    logger.list(LOG_MODULES.AGENT, payload, 'agent-definitions', { category, isActive, scope }, formattedAgents.length);

    return NextResponse.json({ agentDefinitions: formattedAgents });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '获取 Agent 定义列表错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/agent-definitions - 创建自定义 Agent 定义
export async function POST(request: Request) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.AGENT_DEFINITION_CREATE)) {
      return NextResponse.json({ error: '禁止访问 - 需要 agent-definition:create 权限' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      displayName,
      description,
      category,
      model,
      modelConfigId,
      systemPrompt,
      allowedTools,
      skills,
      mcpServers,
      isActive,
    } = body;

    // 验证必填字段
    if (!name || !displayName || !description || !category || !model) {
      return NextResponse.json(
        { error: '缺少必填字段：name, displayName, description, category, model' },
        { status: 400 }
      );
    }

    // 检查名称是否已存在（同一用户范围内）
    const existing = await prisma.agentDefinition.findUnique({
      where: { name },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'Agent 名称已存在' },
        { status: 400 }
      );
    }

    // 创建 Agent 定义
    const agentDefinition = await prisma.agentDefinition.create({
      data: {
        id: `agent-def-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        displayName,
        description,
        category,
        model,
        modelConfigId: modelConfigId || null,
        systemPrompt: systemPrompt || null,
        allowedTools: allowedTools ? JSON.stringify(allowedTools) : null,
        skills: skills ? JSON.stringify(skills) : null,
        mcpServers: mcpServers ? JSON.stringify(mcpServers) : null,
        userId: payload.userId,
        isBuiltin: false,
        isActive: isActive !== undefined ? isActive : true,
        updatedAt: new Date(),
      },
    });

    logger.create(LOG_MODULES.AGENT, payload, agentDefinition.id, {
      name,
      displayName,
      category,
      model,
    });

    return NextResponse.json(
      {
        agentDefinition: {
          ...agentDefinition,
          allowedTools: agentDefinition.allowedTools ? JSON.parse(agentDefinition.allowedTools) : [],
          skills: agentDefinition.skills ? JSON.parse(agentDefinition.skills) : [],
          mcpServers: agentDefinition.mcpServers ? JSON.parse(agentDefinition.mcpServers) : [],
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '创建 Agent 定义错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}