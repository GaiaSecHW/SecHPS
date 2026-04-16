/**
 * Agent Team SSE Stream Route - Real-time event streaming
 * 
 * GET /api/agent-teams/[id]/stream
 * Returns SSE stream for agent team execution events
 * 
 * Query params:
 * - executionId: Optional - filter events to specific execution
 * 
 * Headers:
 * - Authorization: Bearer <token> (required)
 */

import { NextRequest } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { createAgentTeamEventStream } from '@/lib/agent-team-events';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/agent-teams/[id]/stream - SSE stream for events
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Authenticate - support both Authorization header and query param token
    // EventSource doesn't support custom headers, so we need query param support
    const { searchParams } = new URL(request.url);
    const authHeader = request.headers.get('authorization');
    const queryToken = searchParams.get('token');
    
    const token = authHeader?.replace('Bearer ', '') || queryToken;
    
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const payload = verifyToken(token);
    if (!payload) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Check permission
    if (!hasPermission(payload.permissions, PERMISSIONS.AGENT_TEAM_READ)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { id: teamId } = await params;

    // Verify team exists
    const team = await prisma.agentTeam.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        userId: true,
        name: true,
        status: true,
      },
    });

    if (!team) {
      return new Response(JSON.stringify({ error: 'Agent team not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Ownership check - admin can access all, others only their own
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');
    if (!isAdmin && team.userId !== payload.userId) {
      return new Response(JSON.stringify({ error: 'Forbidden: You do not own this team' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get optional executionId filter from query params (searchParams already defined above)
    const executionId = searchParams.get('executionId') || undefined;

    // If executionId provided, verify it belongs to this team
    if (executionId) {
      const execution = await prisma.agentTeamExecution.findUnique({
        where: { id: executionId },
        select: { teamId: true, status: true },
      });

      if (!execution || execution.teamId !== teamId) {
        return new Response(JSON.stringify({ error: 'Execution not found for this team' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // If execution already completed, return error
      if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
        return new Response(JSON.stringify({ 
          error: 'Execution already completed',
          status: execution.status,
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    logger.info(LOG_MODULES.WORKFLOW, `SSE stream connected for team ${teamId}`, {
      userId: payload.userId,
      details: { teamId, executionId },
    });

    // Create SSE stream
    const stream = createAgentTeamEventStream(teamId, executionId);

    // Return SSE response
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `SSE stream error: ${error}`);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}