import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { AuditLogger } from '@/lib/audit/logger';

// POST /api/agent-teams/[id]/members - Add member
export async function POST(
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
    const { agentId, role, overrideModel, overrideTools } = body;

    // Validate required fields
    if (!agentId) {
      return NextResponse.json({ error: '必须指定 Agent ID' }, { status: 400 });
    }

    // Verify agent exists
    const agent = await prisma.agentDefinition.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, displayName: true },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent 不存在' }, { status: 400 });
    }

    // Check if agent is already a member
    const existingMember = await prisma.agentTeamMember.findFirst({
      where: { teamId: id, agentId },
    });

    if (existingMember) {
      return NextResponse.json({ error: '该 Agent 已经是团队成员' }, { status: 400 });
    }

    // Check maxTeammates limit
    const currentMembersCount = await prisma.agentTeamMember.count({
      where: { teamId: id },
    });

    if (currentMembersCount >= existingTeam.maxTeammates) {
      return NextResponse.json({ error: `团队成员数量已达上限 (${existingTeam.maxTeammates})` }, { status: 400 });
    }

    // Create member
    const member = await prisma.agentTeamMember.create({
      data: {
        id: `member-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        teamId: id,
        agentId,
        role: role || 'teammate',
        overrideModel: overrideModel || undefined,
        overrideTools: overrideTools ? JSON.stringify(overrideTools) : undefined,
      },
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
    });

    await AuditLogger.log({
      userId: payload.userId,
      action: 'workflow_update',
      resource: id,
      details: {
        operation: 'agent_team_member_add',
        after: { agentId, role, agentName: agent.displayName || agent.name },
      },
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    logger.update(LOG_MODULES.WORKFLOW, payload, id, { action: 'add_member', agentId });

    return NextResponse.json(
      {
        message: '成员添加成功',
        member: {
          id: member.id,
          agentId: member.agentId,
          agentName: member.AgentDefinition?.displayName || member.AgentDefinition?.name || null,
          role: member.role,
          overrideModel: member.overrideModel,
          overrideTools: member.overrideTools ? JSON.parse(member.overrideTools) : null,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `添加团队成员错误: ${error}`);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/agent-teams/[id]/members - Remove member
export async function DELETE(
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
      select: { userId: true, name: true },
    });

    if (!existingTeam) {
      return NextResponse.json({ error: '团队不存在' }, { status: 404 });
    }

    if (!isAdmin && existingTeam.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // Get memberId from query params
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');

    if (!memberId) {
      return NextResponse.json({ error: '必须指定 memberId' }, { status: 400 });
    }

    // Check member exists and belongs to this team
    const existingMember = await prisma.agentTeamMember.findUnique({
      where: { id: memberId },
      select: { teamId: true, agentId: true, AgentDefinition: { select: { displayName: true, name: true } } },
    });

    if (!existingMember) {
      return NextResponse.json({ error: '成员不存在' }, { status: 404 });
    }

    if (existingMember.teamId !== id) {
      return NextResponse.json({ error: '该成员不属于此团队' }, { status: 400 });
    }

    // Delete member
    await prisma.agentTeamMember.delete({
      where: { id: memberId },
    });

    await AuditLogger.log({
      userId: payload.userId,
      action: 'workflow_update',
      resource: id,
      details: {
        operation: 'agent_team_member_remove',
        before: { memberId, agentId: existingMember.agentId, agentName: existingMember.AgentDefinition?.displayName || existingMember.AgentDefinition?.name },
      },
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    logger.delete(LOG_MODULES.WORKFLOW, payload, memberId, { teamId: id });

    return NextResponse.json({ message: '成员移除成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `移除团队成员错误: ${error}`);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}