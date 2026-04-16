/**
 * Agent Team Execution API - Start execution
 * 
 * POST /api/agent-teams/[id]/execute
 * Creates an AgentTeamExecution record, starts SDK execution, and returns executionId + streamUrl
 * 
 * Events are broadcast via SSE to connected clients at /api/agent-teams/[id]/stream
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { createAgentTeamExecutionService, ExecutionCallbacks } from '@/services/agent-team/execution-service';
import {
  emitExecutionStarted,
  emitAgentInvoked,
  emitMessageDelta,
  emitAgentCompleted,
  emitExecutionCompleted,
} from '@/lib/agent-team-events';

interface ExecuteRequestBody {
  projectId?: string;
  task: string; // Task is now required
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

    const { id: teamId } = await params;

    // Parse request body
    const body: ExecuteRequestBody = await request.json();
    const { projectId, task, modelConfigId } = body;

    // Validate task is provided
    if (!task || !task.trim()) {
      return NextResponse.json({ error: 'Task is required' }, { status: 400 });
    }

    // Verify team exists and belongs to user
    const team = await prisma.agentTeam.findUnique({
      where: { id: teamId },
      include: {
        User: { select: { id: true } },
        AgentDefinition: { select: { id: true, name: true, displayName: true } },
        AgentTeamMember: {
          select: { id: true, agentId: true, role: true },
          include: {
            AgentDefinition: { select: { id: true, name: true, displayName: true } },
          },
        },
      },
    });

    if (!team) {
      return NextResponse.json({ error: 'Agent team not found' }, { status: 404 });
    }

    // Ownership check
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');
    if (!isAdmin && team.userId !== payload.userId) {
      return NextResponse.json({ error: 'Forbidden: You do not own this team' }, { status: 403 });
    }

    // Create event-emitting callbacks
    const callbacks: ExecutionCallbacks = {
      onChunk: (text, memberId) => {
        emitMessageDelta(teamId, teamId, {
          agentId: team.leadAgentId,
          content: text,
          memberId,
        });
      },
      onToolUse: (name, input, memberId) => {
        // Emit agent invoked when a tool is used (could be subagent invocation)
        if (name === 'Task' || name === 'task') {
          emitAgentInvoked(teamId, teamId, {
            agentId: (input as any).subagent_type || 'unknown',
            agentName: (input as any).description || name,
            agentRole: 'member',
            parentToolUseId: null, // Would need to track tool_use ID
            memberId,
          });
        }
      },
      onToolResult: (name, result, memberId) => {
        // Could emit agent completed for subagent results
        if (name === 'Task' || name === 'task') {
          emitAgentCompleted(teamId, teamId, {
            agentId: (result as any)?.agentId || 'unknown',
            agentName: name,
            result: typeof result === 'string' ? result : JSON.stringify(result),
            tokens: { input: 0, output: 0 }, // Would need actual token tracking
            memberId,
          });
        }
      },
      onUsage: (usage) => {
        // Usage events are tracked in database, not emitted as separate events
        logger.debug(LOG_MODULES.WORKFLOW, `Token usage: ${usage.inputTokens} in, ${usage.outputTokens} out`, {
          userId: payload.userId,
          details: { executionId: teamId, usage },
        });
      },
      onComplete: (result, executionId) => {
        emitExecutionCompleted(executionId, teamId, {
          result,
          totalTokens: { input: 0, output: 0 }, // Would need actual totals
          status: 'completed',
        });
      },
      onError: (error, executionId) => {
        emitExecutionCompleted(executionId, teamId, {
          result: error.message,
          totalTokens: { input: 0, output: 0 },
          status: 'failed',
        });
      },
      onStatusChange: (status, executionId) => {
        logger.info(LOG_MODULES.WORKFLOW, `Execution status changed: ${status}`, {
          userId: payload.userId,
          details: { executionId, status },
        });
      },
    };

    // Create execution service and start execution
    const executionService = createAgentTeamExecutionService();

    const { executionId, status } = await executionService.execute({
      teamId,
      projectId,
      task: task.trim(),
      modelConfigId,
      callbacks,
    });

    // Emit execution started event
    emitExecutionStarted(executionId, teamId, {
      teamName: team.name,
      leadAgentId: team.leadAgentId,
      leadAgentName: team.AgentDefinition.displayName || team.AgentDefinition.name,
      memberCount: team.AgentTeamMember.length,
    });

    // Generate SSE URL for streaming events
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const host = request.headers.get('host') || 'localhost:3000';
    const streamUrl = `${protocol}://${host}/api/agent-teams/${teamId}/stream?executionId=${executionId}`;

    logger.info(LOG_MODULES.WORKFLOW, `Agent team execution started: ${executionId}`, {
      userId: payload.userId,
      details: { teamId, executionId },
    });

    return NextResponse.json({
      executionId,
      status: status.status,
      streamUrl,
      team: {
        id: team.id,
        name: team.name,
        leadAgent: team.AgentDefinition,
        memberCount: team.AgentTeamMember.length,
      },
    }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `Start agent team execution error: ${error}`);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}