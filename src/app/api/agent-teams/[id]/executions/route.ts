/**
 * Agent Team Executions API - List executions for team
 * 
 * GET /api/agent-teams/[id]/executions
 * Returns list of executions for a specific agent team
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/agent-teams/[id]/executions - List executions for team
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Authenticate and check permission
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_TEAM_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // Verify team exists and belongs to user
    const team = await prisma.agentTeam.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!team) {
      return NextResponse.json({ error: 'Agent team not found' }, { status: 404 });
    }

    // Ownership check
    if (team.userId !== payload.userId) {
      return NextResponse.json({ error: 'Forbidden: You do not own this team' }, { status: 403 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');
    const status = searchParams.get('status') || undefined;

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // Build where clause
    const where: any = { teamId: id };
    if (status) {
      where.status = status;
    }

    // Get executions with pagination
    const [total, executions] = await Promise.all([
      prisma.agentTeamExecution.count({ where }),
      prisma.agentTeamExecution.findMany({
        where,
        select: {
          id: true,
          teamId: true,
          evaluationId: true,
          status: true,
          startedAt: true,
          completedAt: true,
          totalInputTokens: true,
          totalOutputTokens: true,
          createdAt: true,
          EvaluationSession: {
            select: {
              id: true,
              title: true,
              Project: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          AgentMemberExecution: {
            select: {
              id: true,
              memberId: true,
              status: true,
              startedAt: true,
              completedAt: true,
              inputTokens: true,
              outputTokens: true,
              AgentTeamMember: {
                select: {
                  id: true,
                  role: true,
                  AgentDefinition: {
                    select: {
                      id: true,
                      name: true,
                      displayName: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    // Format response
    const formattedExecutions = executions.map(execution => ({
      id: execution.id,
      teamId: execution.teamId,
      evaluationId: execution.evaluationId,
      evaluationTitle: execution.EvaluationSession?.title || null,
      projectId: execution.EvaluationSession?.Project?.id || null,
      projectName: execution.EvaluationSession?.Project?.name || null,
      status: execution.status,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      totalInputTokens: execution.totalInputTokens,
      totalOutputTokens: execution.totalOutputTokens,
      createdAt: execution.createdAt,
      memberCount: execution.AgentMemberExecution.length,
      completedMembers: execution.AgentMemberExecution.filter(m => m.status === 'completed').length,
      runningMembers: execution.AgentMemberExecution.filter(m => m.status === 'running').length,
      pendingMembers: execution.AgentMemberExecution.filter(m => m.status === 'pending').length,
      memberExecutions: execution.AgentMemberExecution.map(me => ({
        id: me.id,
        memberId: me.memberId,
        role: me.AgentTeamMember.role,
        agentId: me.AgentTeamMember.AgentDefinition.id,
        agentName: me.AgentTeamMember.AgentDefinition.name,
        agentDisplayName: me.AgentTeamMember.AgentDefinition.displayName,
        status: me.status,
        startedAt: me.startedAt,
        completedAt: me.completedAt,
        inputTokens: me.inputTokens,
        outputTokens: me.outputTokens,
      })),
    }));

    logger.list(LOG_MODULES.WORKFLOW, payload, 'agent-team-executions', { teamId: id, status }, formattedExecutions.length);

    return NextResponse.json(createPaginatedResponse(formattedExecutions, total, pageNum, pageLimit));
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `List agent team executions error: ${error}`);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}