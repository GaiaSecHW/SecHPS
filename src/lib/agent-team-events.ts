/**
 * Agent Team Event Broadcaster - SSE-based real-time event streaming
 *
 * Manages SSE connections for agent team execution events.
 * Uses a pub/sub pattern where execution services emit events
 * and connected SSE clients receive them.
 */

import type { AgentTeamEvent } from '@/types/agent-team-events';
import { formatEventForSSE, createExecutionStartedEvent, createAgentInvokedEvent, createMessageDeltaEvent, createAgentCompletedEvent, createExecutionCompletedEvent, createIterationStartedEvent, createIterationCompletedEvent, createExperienceQueriedEvent } from '@/types/agent-team-events';
import { logger, LOG_MODULES } from '@/lib/logger';

// ============ Client Connection Types ============

/**
 * SSE Client connection
 */
export interface SSEClient {
  id: string;
  teamId: string;
  executionId: string | null;
  controller: ReadableStreamDefaultController;
  connectedAt: Date;
  lastEventAt: Date;
}

/**
 * Options for registering a client
 */
export interface RegisterClientOptions {
  teamId: string;
  executionId?: string;
}

// ============ Event Broadcaster Class ============

/**
 * AgentTeamEventBroadcaster - singleton service for SSE event streaming
 * 
 * Features:
 * - Register/unregister SSE clients per team
 * - Broadcast events to all clients subscribed to a team
 * - Filter events by executionId if specified
 * - Auto-cleanup on execution completion
 */
class AgentTeamEventBroadcaster {
  private clients: Map<string, SSEClient> = new Map();
  private teamClients: Map<string, Set<string>> = new Map();
  private executionClients: Map<string, Set<string>> = new Map();

  /**
   * Register a new SSE client
   * 
   * @param controller ReadableStream controller for SSE
   * @param options Team and optional execution filter
   * @returns Client ID for later unregistration
   */
  registerClient(
    controller: ReadableStreamDefaultController,
    options: RegisterClientOptions
  ): string {
    const clientId = crypto.randomUUID();
    const { teamId, executionId } = options;

    const client: SSEClient = {
      id: clientId,
      teamId,
      executionId: executionId || null,
      controller,
      connectedAt: new Date(),
      lastEventAt: new Date(),
    };

    // Store client
    this.clients.set(clientId, client);

    // Add to team subscription
    if (!this.teamClients.has(teamId)) {
      this.teamClients.set(teamId, new Set());
    }
    this.teamClients.get(teamId)!.add(clientId);

    // Add to execution subscription if specified
    if (executionId) {
      if (!this.executionClients.has(executionId)) {
        this.executionClients.set(executionId, new Set());
      }
      this.executionClients.get(executionId)!.add(clientId);
    }

    // Send connected event
    this.sendToClient(client, {
      type: 'connected',
      clientId,
      teamId,
      executionId,
      timestamp: new Date(),
    });

    logger.info(LOG_MODULES.AGENT, `Client ${clientId} connected for team ${teamId}`);

    return clientId;
  }

  /**
   * Unregister an SSE client
   * 
   * @param clientId Client ID to unregister
   */
  unregisterClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from team subscription
    const teamSet = this.teamClients.get(client.teamId);
    if (teamSet) {
      teamSet.delete(clientId);
      if (teamSet.size === 0) {
        this.teamClients.delete(client.teamId);
      }
    }

    // Remove from execution subscription
    if (client.executionId) {
      const execSet = this.executionClients.get(client.executionId);
      if (execSet) {
        execSet.delete(clientId);
        if (execSet.size === 0) {
          this.executionClients.delete(client.executionId);
        }
      }
    }

    // Remove client
    this.clients.delete(clientId);

    logger.info(LOG_MODULES.AGENT, `Client ${clientId} disconnected`);
  }

  /**
   * Broadcast an event to all clients subscribed to the team
   * 
   * @param event Agent team event to broadcast
   */
  broadcast(event: AgentTeamEvent): void {
    const teamClientIds = this.teamClients.get(event.teamId);
    if (!teamClientIds || teamClientIds.size === 0) {
      logger.info(LOG_MODULES.AGENT, `No clients for team ${event.teamId}`);
      return;
    }

    // Send to all team clients
    for (const clientId of teamClientIds) {
      const client = this.clients.get(clientId);
      if (!client) continue;

      // Filter by executionId if client is subscribed to specific execution
      if (client.executionId && client.executionId !== event.executionId) {
        continue;
      }

      this.sendEventToClient(client, event);
    }

    // Cleanup on execution completed
    if (event.type === 'execution_completed') {
      this.cleanupExecutionClients(event.executionId);
    }
  }

  /**
   * Broadcast event to clients subscribed to specific execution
   * 
   * @param executionId Execution ID
   * @param event Agent team event
   */
  broadcastToExecution(executionId: string, event: AgentTeamEvent): void {
    const execClientIds = this.executionClients.get(executionId);
    if (!execClientIds || execClientIds.size === 0) return;

    for (const clientId of execClientIds) {
      const client = this.clients.get(clientId);
      if (!client) continue;

      this.sendEventToClient(client, event);
    }
  }

  /**
   * Send an event to a specific client
   */
  private sendEventToClient(client: SSEClient, event: AgentTeamEvent): void {
    this.sendToClient(client, event);
    client.lastEventAt = new Date();
  }

  /**
   * Send data to client via SSE
   */
  private sendToClient(client: SSEClient, data: unknown): void {
    try {
      const message = formatEventForSSE(data as AgentTeamEvent);
      client.controller.enqueue(new TextEncoder().encode(message));
    } catch (error) {
      // Client might have disconnected
      logger.error(LOG_MODULES.AGENT, `Error sending to client ${client.id}`, { details: { error: error instanceof Error ? error.message : String(error) } });
      this.unregisterClient(client.id);
    }
  }

  /**
   * Cleanup clients subscribed to a completed execution
   */
  private cleanupExecutionClients(executionId: string): void {
    const execClientIds = this.executionClients.get(executionId);
    if (!execClientIds) return;

    // Send complete signal to execution clients
    for (const clientId of execClientIds) {
      const client = this.clients.get(clientId);
      if (client) {
        try {
          // Send complete event
          const completeMessage = `event: complete\ndata: ${JSON.stringify({ executionId })}\n\n`;
          client.controller.enqueue(new TextEncoder().encode(completeMessage));
          // Close the stream
          client.controller.close();
        } catch {
          // Ignore errors on close
        }
        this.unregisterClient(clientId);
      }
    }

    this.executionClients.delete(executionId);
    logger.info(LOG_MODULES.AGENT, `Cleaned up execution ${executionId} clients`);
  }

  /**
   * Get count of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get clients for a specific team
   */
  getTeamClientCount(teamId: string): number {
    return this.teamClients.get(teamId)?.size || 0;
  }

  /**
   * Get clients for a specific execution
   */
  getExecutionClientCount(executionId: string): number {
    return this.executionClients.get(executionId)?.size || 0;
  }

  /**
   * Get all active executions being streamed
   */
  getActiveExecutions(): string[] {
    return Array.from(this.executionClients.keys());
  }

  /**
   * Close all client connections
   */
  closeAll(): void {
    for (const client of this.clients.values()) {
      try {
        client.controller.close();
      } catch {
        // Ignore errors
      }
    }
    this.clients.clear();
    this.teamClients.clear();
    this.executionClients.clear();
    logger.info(LOG_MODULES.AGENT, 'All clients closed');
  }
}

// ============ Singleton Instance ============

/**
 * Global event broadcaster instance
 */
export const agentTeamEventBroadcaster = new AgentTeamEventBroadcaster();

// ============ Helper Functions ============

/**
 * Create SSE stream for agent team events
 * 
 * @param teamId Team ID to subscribe to
 * @param executionId Optional execution ID filter
 * @returns ReadableStream for SSE
 */
export function createAgentTeamEventStream(
  teamId: string,
  executionId?: string
): ReadableStream<Uint8Array> {
  let clientId: string;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      clientId = agentTeamEventBroadcaster.registerClient(controller, {
        teamId,
        executionId,
      });
    },
    cancel() {
      agentTeamEventBroadcaster.unregisterClient(clientId);
    },
  });
}

/**
 * Emit execution started event
 */
export function emitExecutionStarted(
  executionId: string,
  teamId: string,
  data: {
    teamName?: string;
    leadAgentId?: string;
    leadAgentName?: string;
    memberCount?: number;
  }
): void {
  const event = createExecutionStartedEvent(executionId, teamId, {
    executionId,
    teamId,
    ...data,
  } as any);
  agentTeamEventBroadcaster.broadcast(event);
}

/**
 * Emit agent invoked event
 */
export function emitAgentInvoked(
  executionId: string,
  teamId: string,
  data: {
    agentId: string;
    agentName: string;
    agentRole: 'lead' | 'member';
    parentToolUseId: string | null;
    memberId?: string;
  }
): void {
  const event = createAgentInvokedEvent(executionId, teamId, data as any);
  agentTeamEventBroadcaster.broadcast(event);
}

/**
 * Emit message delta event
 */
export function emitMessageDelta(
  executionId: string,
  teamId: string,
  data: {
    agentId: string;
    content: string;
    memberId?: string;
  }
): void {
  const event = createMessageDeltaEvent(executionId, teamId, data as any);
  agentTeamEventBroadcaster.broadcast(event);
}

/**
 * Emit agent completed event
 */
export function emitAgentCompleted(
  executionId: string,
  teamId: string,
  data: {
    agentId: string;
    agentName: string;
    result: string;
    tokens: { input: number; output: number };
    memberId?: string;
  }
): void {
  const event = createAgentCompletedEvent(executionId, teamId, data as any);
  agentTeamEventBroadcaster.broadcast(event);
}

/**
 * Emit execution completed event
 */
export function emitExecutionCompleted(
  executionId: string,
  teamId: string,
  data: {
    result: string;
    totalTokens: { input: number; output: number };
    totalCostUsd?: number;
    status: 'completed' | 'failed' | 'cancelled';
  }
): void {
  const event = createExecutionCompletedEvent(executionId, teamId, {
    executionId,
    ...data,
  } as any);
  agentTeamEventBroadcaster.broadcast(event);
}

/**
 * Emit iteration started event (Ralph Loop)
 */
export function emitIterationStarted(
  executionId: string,
  teamId: string,
  data: {
    iteration: number;
    maxIterations: number;
    previousFeedback?: string;
    totalCostUsdSoFar?: number;
  }
): void {
  const event = createIterationStartedEvent(executionId, teamId, {
    executionId,
    ...data,
  } as any);
  agentTeamEventBroadcaster.broadcast(event);
}

/**
 * Emit iteration completed event (Ralph Loop)
 */
export function emitIterationCompleted(
  executionId: string,
  teamId: string,
  data: {
    iteration: number;
    result: string;
    verified: boolean;
    feedback?: string;
    tokensUsed: { input: number; output: number };
    costUsd: number;
    totalCostUsdSoFar: number;
  }
): void {
  const event = createIterationCompletedEvent(executionId, teamId, {
    executionId,
    ...data,
  } as any);
  agentTeamEventBroadcaster.broadcast(event);
}

/**
 * Emit experience queried event (Ralph Loop)
 */
export function emitExperienceQueried(
  executionId: string,
  teamId: string,
  data: {
    iteration: number;
    experiencesFound: number;
    experienceTitles?: string[];
    guidanceInjected: string;
  }
): void {
  const event = createExperienceQueriedEvent(executionId, teamId, {
    executionId,
    ...data,
  } as any);
  agentTeamEventBroadcaster.broadcast(event);
}