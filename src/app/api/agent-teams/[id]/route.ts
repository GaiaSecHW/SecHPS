import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { AuditLogger } from '@/lib/audit/logger';

// Circular dependency detection using DFS
function hasCircularDependency(dependencies: { from: string; to: string }[]): boolean {
  const graph = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!graph.has(dep.from)) graph.set(dep.from, []);
    graph.get(dep.from)!.push(dep.to);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);
    for (const neighbor of graph.get(node) || []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }
    recursionStack.delete(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (!visited.has(node) && dfs(node)) return true;
  }
  return false;
}

// Format agent team data
function formatAgentTeam(team: any) {
  return {
    id: team.id,
    userId: team.userId,
    userName: team.user?.name || team.user?.username || null,
    userUsername: team.user?.username || null,
    name: team.name,
    description: team.description,
    leadAgentId: team.leadAgentId,
    leadAgentName: team.leadAgent?.displayName || team.leadAgent?.name || null,
    leadAgent: team.leadAgent ? {
      id: team.leadAgent.id,
      name: team.leadAgent.name,
      displayName: team.leadAgent.displayName,
      category: team.leadAgent.category,
      model: team.leadAgent.model,
    } : null,
    taskStrategy: team.taskStrategy,
    maxTeammates: team.maxTeammates,
    status: team.status,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    members: team.members?.map((m: any) => ({
      id: m.id,
      agentId: m.agentId,
      agentName: m.agent?.displayName || m.agent?.name || null,
      agent: m.agent ? {
        id: m.agent.id,
        name: m.agent.name,
        displayName: m.agent.displayName,
        category: m.agent.category,
        model: m.agent.model,
      } : null,
      role: m.role,
      overrideModel: m.overrideModel,
      overrideTools: m.overrideTools ? JSON.parse(m.overrideTools) : null,
    })) || [],
    _count: team._count,
  };
}

// GET /api/agent-teams/[id] - Get team with members
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_TEAM_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    const team = await prisma.agentTeam.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        leadAgentId: true,
        taskStrategy: true,
        maxTeammates: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        leadAgent: {
          select: {
            id: true,
            name: true,
            displayName: true,
            category: true,
            model: true,
          },
        },
        members: {
          select: {
            id: true,
            agentId: true,
            role: true,
            overrideModel: true,
            overrideTools: true,
            agent: {
              select: {
                id: true,
                name: true,
                displayName: true,
                category: true,
                model: true,
              },
            },
          },
        },
        _count: {
          select: {
            AgentTeamMember: true,
            AgentTeamExecution: true,
          },
        },
      },
    });

    if (!team) {
      return NextResponse.json({ error: '团队不存在' }, { status: 404 });
    }

    // Check ownership (admin can access any team)
    if (!isAdmin && team.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    logger.read(LOG_MODULES.WORKFLOW, payload, 'agent-team', team.id, { name: team.name });

    return NextResponse.json({ team: formatAgentTeam(team) });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `获取 Agent 团队详情错误: ${error}`);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PATCH /api/agent-teams/[id] - Update team
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_TEAM_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // Check team exists and ownership
    const existingTeam = await prisma.agentTeam.findUnique({
      where: { id },
      select: { userId: true, name: true, maxTeammates: true },
    });

    if (!existingTeam) {
      return NextResponse.json({ error: '团队不存在' }, { status: 404 });
    }

    if (!isAdmin && existingTeam.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, leadAgentId, taskStrategy, maxTeammates, dependencies } = body;

    // Validate name if provided
    if (name !== undefined) {
      if (!name || !name.trim()) {
        return NextResponse.json({ error: '团队名称不能为空' }, { status: 400 });
      }

      const trimmedName = name.trim();
      if (trimmedName.length < 2) {
        return NextResponse.json({ error: '团队名称至少需要2个字符' }, { status: 400 });
      }

      if (trimmedName.length > 100) {
        return NextResponse.json({ error: '团队名称不能超过100个字符' }, { status: 400 });
      }
    }

    // Validate lead agent if provided
    if (leadAgentId !== undefined) {
      const leadAgent = await prisma.agentDefinition.findUnique({
        where: { id: leadAgentId },
      });

      if (!leadAgent) {
        return NextResponse.json({ error: 'Lead Agent 不存在' }, { status: 400 });
      }
    }

    // Validate maxTeammates if provided
    if (maxTeammates !== undefined) {
      if (maxTeammates < 1 || maxTeammates > 10) {
        return NextResponse.json({ error: 'maxTeammates 必须在 1-10 之间' }, { status: 400 });
      }

      // Check current members count
      const currentMembersCount = await prisma.agentTeamMember.count({
        where: { teamId: id },
      });

      if (currentMembersCount > maxTeammates) {
        return NextResponse.json({ error: `当前已有 ${currentMembersCount} 个成员，不能设置 maxTeammates 为 ${maxTeammates}` }, { status: 400 });
      }
    }

    // Check circular dependency if dependencies provided
    if (dependencies && Array.isArray(dependencies) && dependencies.length > 0) {
      if (hasCircularDependency(dependencies)) {
        return NextResponse.json({ error: '检测到循环依赖，请检查依赖配置' }, { status: 400 });
      }
    }

    // Build update data
    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (leadAgentId !== undefined) updateData.leadAgentId = leadAgentId;
    if (taskStrategy !== undefined) updateData.taskStrategy = taskStrategy;
    if (maxTeammates !== undefined) updateData.maxTeammates = maxTeammates;

    const team = await prisma.agentTeam.update({
      where: { id },
      data: updateData,
      include: {
        AgentDefinition: {
          select: {
            id: true,
            name: true,
            displayName: true,
            category: true,
            model: true,
          },
        },
        AgentTeamMember: {
          include: {
            AgentDefinition: {
              select: {
                id: true,
                name: true,
                displayName: true,
                category: true,
                model: true,
              },
            },
          },
        },
      },
    });

    await AuditLogger.log({
      userId: payload.userId,
      action: 'workflow_update',
      resource: team.id,
      details: {
        operation: 'agent_team_update',
        before: { name: existingTeam.name },
        after: updateData,
      },
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    logger.update(LOG_MODULES.WORKFLOW, payload, team.id, updateData);

    return NextResponse.json({
      message: '团队更新成功',
      team: formatAgentTeam(team),
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `更新 Agent 团队错误: ${error}`);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/agent-teams/[id] - Delete team (cascade members)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_TEAM_DELETE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // Check team exists and ownership
    const existingTeam = await prisma.agentTeam.findUnique({
      where: { id },
      select: { userId: true, name: true },
    });

    if (!existingTeam) {
      return NextResponse.json({ error: '团队不存在' }, { status: 404 });
    }

    if (!isAdmin && existingTeam.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // Delete team (cascade will delete members automatically)
    await prisma.agentTeam.delete({
      where: { id },
    });

    await AuditLogger.log({
      userId: payload.userId,
      action: 'workflow_delete',
      resource: id,
      details: {
        operation: 'agent_team_delete',
        before: { name: existingTeam.name },
      },
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    logger.delete(LOG_MODULES.WORKFLOW, payload, id, { name: existingTeam.name });

    return NextResponse.json({ message: '团队删除成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `删除 Agent 团队错误: ${error}`);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}