/**
 * Agent Team Execution API - Start execution
 * 
 * POST /api/agent-teams/[id]/execute
 * Creates an AgentTeamExecution record and returns executionId + websocketUrl
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

interface ExecuteRequestBody {
  projectId?: string;
  task?: string;
  modelConfigId?: string;
}

// POST /api/agent-teams/[id]/execute - Start execution
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Authenticate and check permission
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_TEAM_EXECUTE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // Parse request body
    const body: ExecuteRequestBody = await request.json();
    const { projectId, task, modelConfigId } = body;

    // Verify team exists and belongs to user
    const team = await prisma.agentTeam.findUnique({
      where: { id },
      include: {
        user: { select: { id: true } },
        leadAgent: { select: { id: true, name: true } },
        members: { select: { id: true, agentId: true, role: true } },
      },
    });

    if (!team) {
      return NextResponse.json({ error: 'Agent team not found' }, { status: 404 });
    }

    // Ownership check
    if (team.userId !== payload.userId) {
      return NextResponse.json({ error: 'Forbidden: You do not own this team' }, { status: 403 });
    }

    // Create execution record
    const execution = await prisma.agentTeamExecution.create({
      data: {
        teamId: id,
        evaluationId: null, // Will be linked later if needed
        status: 'running',
        startedAt: new Date(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
    });

    // Create member execution records for each team member
    if (team.members.length > 0) {
      await prisma.agentMemberExecution.createMany({
        data: team.members.map(member => ({
          teamExecutionId: execution.id,
          memberId: member.id,
          status: 'pending',
          inputTokens: 0,
          outputTokens: 0,
        })),
      });
    }

    // Update team status to running
    await prisma.agentTeam.update({
      where: { id },
      data: { status: 'running' },
    });

    // Generate WebSocket URL for streaming events
    const protocol = request.headers.get('x-forwarded-proto') || 'ws';
    const host = request.headers.get('host') || 'localhost:3000';
    const websocketUrl = `${protocol}://${host}/api/agent-teams/${id}/stream`;

    logger.info(LOG_MODULES.WORKFLOW, `Agent team execution started: ${execution.id}`, {
      userId: payload.userId,
      details: { teamId: id, executionId: execution.id },
    });

    return NextResponse.json({
      executionId: execution.id,
      status: execution.status,
      websocketUrl,
      team: {
        id: team.id,
        name: team.name,
        leadAgent: team.leadAgent,
        memberCount: team.members.length,
      },
    }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `Start agent team execution error: ${error}`);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}