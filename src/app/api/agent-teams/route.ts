import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { buildSearchFilter, combineWhereClauses } from '@/lib/query-optimizer';
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
    taskStrategy: team.taskStrategy,
    maxTeammates: team.maxTeammates,
    status: team.status,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    members: team.members?.map((m: any) => ({
      id: m.id,
      agentId: m.agentId,
      agentName: m.agent?.displayName || m.agent?.name || null,
      role: m.role,
      overrideModel: m.overrideModel,
      overrideTools: m.overrideTools ? JSON.parse(m.overrideTools) : null,
    })) || [],
    _count: team._count,
  };
}

// GET /api/agent-teams - List user's teams
export async function GET(request: Request) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_TEAM_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') || undefined;

    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // Build query conditions
    let baseWhere: any = {};

    if (isAdmin) {
      // Admin can see all teams
    } else {
      // Regular users can only see their own teams
      baseWhere.userId = payload.userId;
    }

    const where = combineWhereClauses(
      baseWhere,
      status ? { status } : undefined,
      buildSearchFilter(['name', 'description'], search)
    );

    const [total, teams] = await Promise.all([
      prisma.agentTeam.count({ where }),
      prisma.agentTeam.findMany({
        where,
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
                },
              },
            },
          },
          _count: {
            select: {
              members: true,
              teamExecutions: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
        skip,
        take,
      }),
    ]);

    const formattedTeams = teams.map(formatAgentTeam);

    logger.list(LOG_MODULES.WORKFLOW, payload, 'agent-teams', { search, status, isAdmin }, formattedTeams.length);

    return NextResponse.json(createPaginatedResponse(formattedTeams, total, pageNum, pageLimit));
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `获取 Agent 团队列表错误: ${error}`);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/agent-teams - Create team with leadAgentId and members
export async function POST(request: Request) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_TEAM_CREATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const body = await request.json();
    const { name, description, leadAgentId, taskStrategy, maxTeammates, members, dependencies } = body;

    // Validate required fields
    if (!name || !name.trim()) {
      return NextResponse.json({ error: '团队名称不能为空' }, { status: 400 });
    }

    if (!leadAgentId) {
      return NextResponse.json({ error: '必须指定 Lead Agent' }, { status: 400 });
    }

    const trimmedName = name.trim();

    if (trimmedName.length < 2) {
      return NextResponse.json({ error: '团队名称至少需要2个字符' }, { status: 400 });
    }

    if (trimmedName.length > 100) {
      return NextResponse.json({ error: '团队名称不能超过100个字符' }, { status: 400 });
    }

    // Verify lead agent exists
    const leadAgent = await prisma.agentDefinition.findUnique({
      where: { id: leadAgentId },
    });

    if (!leadAgent) {
      return NextResponse.json({ error: 'Lead Agent 不存在' }, { status: 400 });
    }

    // Validate maxTeammates
    const maxTeamSize = maxTeammates || 5;
    if (maxTeamSize < 1 || maxTeamSize > 10) {
      return NextResponse.json({ error: 'maxTeammates 必须在 1-10 之间' }, { status: 400 });
    }

    // Validate members count
    if (members && Array.isArray(members) && members.length > maxTeamSize) {
      return NextResponse.json({ error: `团队成员数量不能超过 ${maxTeamSize}` }, { status: 400 });
    }

    // Check circular dependency if dependencies provided
    if (dependencies && Array.isArray(dependencies) && dependencies.length > 0) {
      if (hasCircularDependency(dependencies)) {
        return NextResponse.json({ error: '检测到循环依赖，请检查依赖配置' }, { status: 400 });
      }
    }

    // Validate member agents exist
    if (members && Array.isArray(members) && members.length > 0) {
      const agentIds = members.map((m: any) => m.agentId);
      const existingAgents = await prisma.agentDefinition.findMany({
        where: { id: { in: agentIds } },
        select: { id: true },
      });

      const missingIds = agentIds.filter((id: string) => !existingAgents.some((a) => a.id === id));
      if (missingIds.length > 0) {
        return NextResponse.json({ error: `以下 Agent 不存在: ${missingIds.join(', ')}` }, { status: 400 });
      }
    }

    // Create team with members
    const team = await prisma.agentTeam.create({
      data: {
        userId: payload.userId,
        name: trimmedName,
        description: description?.trim() || undefined,
        leadAgentId,
        taskStrategy: taskStrategy || 'parallel',
        maxTeammates: maxTeamSize,
        status: 'idle',
        members: members && Array.isArray(members) && members.length > 0
          ? {
              create: members.map((m: any) => ({
                agentId: m.agentId,
                role: m.role || 'teammate',
                overrideModel: m.overrideModel || undefined,
                overrideTools: m.overrideTools ? JSON.stringify(m.overrideTools) : undefined,
              })),
            }
          : undefined,
      },
      include: {
        leadAgent: {
          select: {
            id: true,
            name: true,
            displayName: true,
          },
        },
        members: {
          include: {
            agent: {
              select: {
                id: true,
                name: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    await AuditLogger.log({
      userId: payload.userId,
      action: 'workflow_create',
      resource: team.id,
      details: {
        operation: 'agent_team_create',
        after: { name, leadAgentId, taskStrategy, maxTeammates },
      },
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    logger.create(LOG_MODULES.WORKFLOW, payload, team.id, { name, leadAgentId });

    return NextResponse.json(
      {
        message: 'Agent 团队创建成功',
        team: formatAgentTeam(team),
      },
      { status: 201 }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `创建 Agent 团队错误: ${error}`);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}