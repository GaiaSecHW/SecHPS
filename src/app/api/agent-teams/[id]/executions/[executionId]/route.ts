/**
 * Agent Team Execution API - Get/Update single execution
 * 
 * GET /api/agent-teams/[id]/executions/[executionId] - Get execution status
 * PATCH /api/agent-teams/[id]/executions/[executionId] - Cancel execution
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { AuditLogger } from '@/lib/audit/logger';

interface PatchRequestBody {
  status: 'cancelled';
}

// GET /api/agent-teams/[id]/executions/[executionId] - Get execution status
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  try {
    // Authenticate and check permission
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_TEAM_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id, executionId } = await params;

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

    // Get execution with details
    const execution = await prisma.agentTeamExecution.findUnique({
      where: { id: executionId },
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
            status: true,
            Project: {
              select: {
                id: true,
                name: true,
                description: true,
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
                overrideModel: true,
                overrideTools: true,
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
        },
      },
    });

    if (!execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    // Verify execution belongs to the team
    if (execution.teamId !== id) {
      return NextResponse.json({ error: 'Execution does not belong to this team' }, { status: 400 });
    }

    // Format response
    const response = {
      id: execution.id,
      teamId: execution.teamId,
      evaluationId: execution.evaluationId,
      evaluation: execution.EvaluationSession ? {
        id: execution.EvaluationSession.id,
        title: execution.EvaluationSession.title,
        status: execution.EvaluationSession.status,
        project: execution.EvaluationSession.Project,
      } : null,
      status: execution.status,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      totalInputTokens: execution.totalInputTokens,
      totalOutputTokens: execution.totalOutputTokens,
      createdAt: execution.createdAt,
      memberExecutions: execution.AgentMemberExecution.map(me => ({
        id: me.id,
        memberId: me.memberId,
        role: me.AgentTeamMember.role,
        overrideModel: me.AgentTeamMember.overrideModel,
        overrideTools: me.AgentTeamMember.overrideTools,
        agent: {
          id: me.AgentTeamMember.AgentDefinition.id,
          name: me.AgentTeamMember.AgentDefinition.name,
          displayName: me.AgentTeamMember.AgentDefinition.displayName,
          category: me.AgentTeamMember.AgentDefinition.category,
          model: me.AgentTeamMember.AgentDefinition.model,
        },
        status: me.status,
        startedAt: me.startedAt,
        completedAt: me.completedAt,
        inputTokens: me.inputTokens,
        outputTokens: me.outputTokens,
      })),
      summary: {
        totalMembers: execution.AgentMemberExecution.length,
        completed: execution.AgentMemberExecution.filter(m => m.status === 'completed').length,
        running: execution.AgentMemberExecution.filter(m => m.status === 'running').length,
        pending: execution.AgentMemberExecution.filter(m => m.status === 'pending').length,
        failed: execution.AgentMemberExecution.filter(m => m.status === 'failed').length,
      },
    };

    return NextResponse.json({ execution: response });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `Get agent team execution error: ${error}`);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/agent-teams/[id]/executions/[executionId] - Cancel execution
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  try {
    // Authenticate and check permission
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_TEAM_EXECUTE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id, executionId } = await params;

    // Parse request body
    const body: PatchRequestBody = await request.json();
    const { status } = body;

    // Only allow cancellation
    if (status !== 'cancelled') {
      return NextResponse.json({ error: 'Only cancellation is supported' }, { status: 400 });
    }

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

    // Get execution
    const execution = await prisma.agentTeamExecution.findUnique({
      where: { id: executionId },
      select: { id: true, teamId: true, status: true },
    });

    if (!execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    // Verify execution belongs to the team
    if (execution.teamId !== id) {
      return NextResponse.json({ error: 'Execution does not belong to this team' }, { status: 400 });
    }

    // Check if execution can be cancelled
    if (execution.status !== 'running' && execution.status !== 'pending') {
      return NextResponse.json({ 
        error: 'Cannot cancel execution that is not running or pending',
        currentStatus: execution.status 
      }, { status: 400 });
    }

    // Update execution and all member executions
    await prisma.$transaction([
      // Update main execution
      prisma.agentTeamExecution.update({
        where: { id: executionId },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
        },
      }),
      // Update all pending/running member executions
      prisma.agentMemberExecution.updateMany({
        where: {
          teamExecutionId: executionId,
          status: { in: ['pending', 'running'] },
        },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
        },
      }),
      // Update team status back to idle if no other running executions
      prisma.agentTeam.update({
        where: { id },
        data: { status: 'idle' },
      }),
    ]);

    // Audit log
    await AuditLogger.log({
      userId: payload.userId,
      action: 'workflow_execute',
      resource: executionId,
      details: {
        teamId: id,
        previousStatus: execution.status,
        newStatus: 'cancelled',
        operation: 'agent_team_execution_cancel',
      },
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    logger.info(LOG_MODULES.WORKFLOW, `Agent team execution cancelled: ${executionId}`, {
      userId: payload.userId,
      details: { teamId: id, executionId },
    });

    return NextResponse.json({
      message: 'Execution cancelled successfully',
      executionId,
      status: 'cancelled',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `Cancel agent team execution error: ${error}`);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}