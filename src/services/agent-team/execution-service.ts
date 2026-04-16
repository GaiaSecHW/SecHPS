// src/services/agent-team/execution-service.ts

import { query, Options, SDKMessage, SDKResultSuccess, SDKResultError, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition as SdkAgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { prisma } from '@/lib/prisma';
import type { AgentTeamExecution, AgentMemberExecution, AgentTeam, AgentTeamMember, AgentDefinition } from '@prisma/client';

/**
 * Safety limits for agent team execution
 */
export const SAFETY_LIMITS = {
  maxBudgetUsd: 5.00,
  maxTurns: 20,
};

/**
 * Execution callbacks for streaming events
 */
export interface ExecutionCallbacks {
  onChunk?: (text: string, memberId?: string) => void;
  onToolUse?: (name: string, input: Record<string, unknown>, memberId?: string) => void;
  onToolResult?: (name: string, result: unknown, memberId?: string) => void;
  onUsage?: (usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    totalCostUsd?: number;
    memberId?: string;
  }) => void;
  onComplete?: (result: string, executionId: string) => void;
  onError?: (error: Error, executionId: string) => void;
  onStatusChange?: (status: string, executionId: string) => void;
  /** Called when a subagent is invoked via Agent tool */
  onSubagentStart?: (agentName: string, memberExecutionId: string) => void;
  /** Called when a subagent completes */
  onSubagentComplete?: (agentName: string, memberExecutionId: string, result: unknown) => void;
}

/**
 * Execution request parameters
 */
export interface ExecuteParams {
  teamId: string;
  projectId?: string;
  task: string;
  modelConfigId?: string;
  callbacks?: ExecutionCallbacks;
}

/**
 * Execution status response
 */
export interface ExecutionStatus {
  id: string;
  teamId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  memberExecutions: Array<{
    id: string;
    memberId: string;
    status: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}

/**
 * Active execution tracking
 */
interface ActiveExecution {
  executionId: string;
  abortController: AbortController;
  teamId: string;
}

/**
 * AgentTeamExecutionService - SDK wrapper for multi-agent team execution
 * 
 * Wraps Claude Agent SDK query() function with:
 * - Database execution tracking
 * - Token usage per agent (cost attribution)
 * - Safety limits (maxBudgetUsd, maxTurns)
 * - Execution cancellation support
 */
export class AgentTeamExecutionService {
  private activeExecutions: Map<string, ActiveExecution> = new Map();

  /**
   * Start a new agent team execution
   * 
   * @param params Execution parameters
   * @returns Execution ID and initial status
   */
  async execute(params: ExecuteParams): Promise<{ executionId: string; status: ExecutionStatus }> {
    const { teamId, projectId, task, modelConfigId, callbacks } = params;

    // Fetch team with members and lead agent
    const team = await prisma.agentTeam.findUnique({
      where: { id: teamId },
      include: {
        leadAgent: true,
        members: {
          include: {
            agent: true,
          },
        },
      },
    });

    if (!team) {
      throw new Error(`Agent team not found: ${teamId}`);
    }

    // Create execution record in database
    const execution = await prisma.agentTeamExecution.create({
      data: {
        teamId,
        evaluationId: projectId,
        status: 'running',
        startedAt: new Date(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
    });

    // Create member execution records
    const memberExecutions: AgentMemberExecution[] = [];
    if (team.members.length > 0) {
      const createdMembers = await prisma.agentMemberExecution.createMany({
        data: team.members.map(member => ({
          teamExecutionId: execution.id,
          memberId: member.id,
          status: 'pending',
          inputTokens: 0,
          outputTokens: 0,
        })),
      });

      // Fetch created member executions
      memberExecutions.push(
        ...await prisma.agentMemberExecution.findMany({
          where: { teamExecutionId: execution.id },
        })
      );
    }

    // Update team status to running
    await prisma.agentTeam.update({
      where: { id: teamId },
      data: { status: 'running' },
    });

    callbacks?.onStatusChange?.('running', execution.id);

    // Create abort controller for this execution
    const abortController = new AbortController();
    this.activeExecutions.set(execution.id, {
      executionId: execution.id,
      abortController,
      teamId,
    });

    // Start async execution (non-blocking)
    this.runExecution(execution.id, team, task, modelConfigId, callbacks, abortController)
      .catch(error => {
        console.error(`[AgentTeamExecutionService] Execution ${execution.id} failed:`, error);
        this.handleExecutionError(execution.id, error, callbacks);
      });

    // Return execution ID and status immediately (async execution)
    return {
      executionId: execution.id,
      status: await this.getStatus(execution.id),
    };
  }

  /**
   * Internal method to run the actual SDK execution
   */
  private async runExecution(
    executionId: string,
    team: AgentTeam & { leadAgent: AgentDefinition; members: (AgentTeamMember & { agent: AgentDefinition })[] },
    task: string,
    modelConfigId?: string,
    callbacks?: ExecutionCallbacks,
    abortController: AbortController
  ): Promise<void> {
    try {
      // Build environment variables
      const env: Record<string, string | undefined> = {
        ...process.env,
        CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: '600000',
      };

      // Build Lead Agent's allowedTools - MUST include "Agent" for subagent invocation
      const leadAgentTools = this.parseAllowedTools(team.leadAgent.allowedTools);
      if (!leadAgentTools.includes('Agent')) {
        leadAgentTools.push('Agent');
      }

      // Build subagent definitions from team members
      // IMPORTANT: Subagent tools MUST NOT include "Agent" (SDK limitation - no nesting)
      const agents: Record<string, SdkAgentDefinition> = {};
      for (const member of team.members) {
        const memberTools = this.parseMemberTools(member);
        // Ensure "Agent" is NOT in subagent tools (no nesting allowed)
        const filteredTools = memberTools.filter(t => t !== 'Agent');
        
        agents[member.agent.name] = {
          description: member.agent.description || `Use for ${member.role} tasks`,
          prompt: member.agent.systemPrompt || `You are a ${member.role} agent.`,
          tools: filteredTools,
          model: member.overrideModel || member.agent.model || undefined,
        };
      }

      // Build SDK options with safety limits
      const options: Options = {
        cwd: process.cwd(),
        model: team.leadAgent.model || 'claude-sonnet-4-20250514',
        allowedTools: leadAgentTools,
        agents: Object.keys(agents).length > 0 ? agents : undefined,
        abortController,
        env,
        // Safety limits
        maxBudgetUsd: SAFETY_LIMITS.maxBudgetUsd,
        maxTurns: SAFETY_LIMITS.maxTurns,
        // Permission mode for autonomous execution
        permissionMode: 'auto',
        allowDangerouslySkipPermissions: true,
      } as any;

      // Configure MCP servers if defined
      if (team.leadAgent.mcpServers) {
        const mcpServers = this.parseMcpServers(team.leadAgent.mcpServers);
        if (mcpServers && Object.keys(mcpServers).length > 0) {
          options.mcpServers = mcpServers;
        }
      }

      // Configure system prompt
      if (team.leadAgent.systemPrompt) {
        options.systemPrompt = team.leadAgent.systemPrompt;
      }

      // Build prompt with team context
      const fullPrompt = this.buildTeamPrompt(team, task);

      // Track token usage per member
      const tokenUsageByMember: Map<string, { input: number; output: number }> = new Map();

      // Track active subagent invocations (agent_name -> member_execution_id)
      const activeSubagents: Map<string, string> = new Map();

      // Build member lookup map (agent_name -> member)
      const memberByAgentName: Map<string, typeof team.members[0]> = new Map();
      for (const member of team.members) {
        memberByAgentName.set(member.agent.name, member);
      }

      // Run SDK query
      const q = query({ prompt: fullPrompt, options });

      let fullResponse = '';
      let currentMemberId: string | undefined;

      for await (const message of q) {
        const msg = message as any;

        // Handle different message types
        if (this.isResultSuccess(message)) {
          fullResponse = message.result || '';
          callbacks?.onChunk?.(message.result);

          // Final usage callback
          const totalCostUsd = msg.total_cost_usd || 0;
          callbacks?.onUsage?.({
            inputTokens: await this.getTotalInputTokens(executionId),
            outputTokens: await this.getTotalOutputTokens(executionId),
            totalCostUsd,
          });

          // Mark all active subagents as completed
          for (const [agentName, memberExecId] of activeSubagents) {
            await this.updateMemberExecutionStatus(memberExecId, 'completed');
          }

          // Mark execution as completed
          await this.markExecutionCompleted(executionId, fullResponse, totalCostUsd);
          callbacks?.onComplete?.(fullResponse, executionId);
          callbacks?.onStatusChange?.('completed', executionId);

        } else if (this.isResultError(message)) {
          const errorMsg = message.errors?.join('\n') || 'Unknown error';
          
          // Mark all active subagents as failed
          for (const [agentName, memberExecId] of activeSubagents) {
            await this.updateMemberExecutionStatus(memberExecId, 'failed');
          }
          
          throw new Error(errorMsg);

        } else if (this.isToolUseMessage(message)) {
          const toolName = msg.tool_name;
          const toolInput = msg.tool_input || {};
          
          callbacks?.onToolUse?.(toolName, toolInput, currentMemberId);

          // Track Agent tool invocations (subagent starts)
          if (toolName === 'Agent') {
            const agentName = toolInput.agent_name || toolInput.agent_type;
            if (agentName) {
              const member = memberByAgentName.get(agentName);
              if (member) {
                // Find the member execution record
                const memberExec = await this.findMemberExecution(executionId, member.id);
                if (memberExec) {
                  // Update status to running
                  await this.updateMemberExecutionStatus(memberExec.id, 'running');
                  activeSubagents.set(agentName, memberExec.id);
                  currentMemberId = member.id;
                  
                  // Callback for subagent start
                  callbacks?.onSubagentStart?.(agentName, memberExec.id);
                }
              }
            }
          }

        } else if (this.isToolResultMessage(message)) {
          const toolName = msg.tool_name;
          const toolResult = msg.tool_result;
          
          callbacks?.onToolResult?.(toolName, toolResult, currentMemberId);

          // Track Agent tool results (subagent completes)
          if (toolName === 'Agent') {
            // Find the agent name from the tool_use context
            // The result indicates subagent completion
            for (const [agentName, memberExecId] of activeSubagents) {
              if (currentMemberId === memberByAgentName.get(agentName)?.id) {
                await this.updateMemberExecutionStatus(memberExecId, 'completed');
                activeSubagents.delete(agentName);
                currentMemberId = undefined;
                
                // Callback for subagent complete
                callbacks?.onSubagentComplete?.(agentName, memberExecId, toolResult);
              }
            }
          }

        } else if (this.isAssistantMessage(message)) {
          // Extract usage data
          const usageData = msg.message?.usage || msg.usage;
          if (usageData) {
            const inputTokens = usageData.input_tokens || 0;
            const outputTokens = usageData.output_tokens || 0;

            // Update database token counts
            await this.updateTokenCounts(executionId, inputTokens, outputTokens);

            // Update member token counts if in subagent context
            if (currentMemberId) {
              await this.updateMemberTokenCounts(executionId, currentMemberId, inputTokens, outputTokens);
            }

            callbacks?.onUsage?.({
              inputTokens,
              outputTokens,
              cacheReadInputTokens: usageData.cache_read_input_tokens || 0,
              cacheCreationInputTokens: usageData.cache_creation_input_tokens || 0,
              memberId: currentMemberId,
            });
          }

          // Extract text content
          if (msg.content) {
            for (const block of msg.content) {
              if (block.type === 'text' && block.text) {
                fullResponse += block.text;
                callbacks?.onChunk?.(block.text, currentMemberId);
              }
            }
          }
        }
      }

    } finally {
      // Clean up active execution tracking
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Cancel an active execution
   * 
   * @param executionId Execution ID to cancel
   * @returns Updated execution status
   */
  async cancel(executionId: string): Promise<ExecutionStatus> {
    const activeExecution = this.activeExecutions.get(executionId);

    if (activeExecution) {
      // Abort the SDK query
      activeExecution.abortController.abort();
      this.activeExecutions.delete(executionId);
    }

    // Update execution status in database
    await prisma.agentTeamExecution.update({
      where: { id: executionId },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    // Update member executions
    await prisma.agentMemberExecution.updateMany({
      where: { teamExecutionId: executionId },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    // Get team ID and update team status
    const execution = await prisma.agentTeamExecution.findUnique({
      where: { id: executionId },
    });
    if (execution) {
      await prisma.agentTeam.update({
        where: { id: execution.teamId },
        data: { status: 'idle' },
      });
    }

    return this.getStatus(executionId);
  }

  /**
   * Get execution status
   * 
   * @param executionId Execution ID
   * @returns Execution status with member executions
   */
  async getStatus(executionId: string): Promise<ExecutionStatus> {
    const execution = await prisma.agentTeamExecution.findUnique({
      where: { id: executionId },
      include: {
        memberExecutions: {
          select: {
            id: true,
            memberId: true,
            status: true,
            inputTokens: true,
            outputTokens: true,
          },
        },
      },
    });

    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    return {
      id: execution.id,
      teamId: execution.teamId,
      status: execution.status,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      totalInputTokens: execution.totalInputTokens,
      totalOutputTokens: execution.totalOutputTokens,
      memberExecutions: execution.memberExecutions.map(me => ({
        id: me.id,
        memberId: me.memberId,
        status: me.status,
        inputTokens: me.inputTokens,
        outputTokens: me.outputTokens,
      })),
    };
  }

  /**
   * Handle execution error
   */
  private async handleExecutionError(
    executionId: string,
    error: Error,
    callbacks?: ExecutionCallbacks
  ): Promise<void> {
    // Update execution status to failed
    await prisma.agentTeamExecution.update({
      where: { id: executionId },
      data: {
        status: 'failed',
        completedAt: new Date(),
      },
    });

    // Update member executions
    await prisma.agentMemberExecution.updateMany({
      where: { teamExecutionId: executionId },
      data: {
        status: 'failed',
        completedAt: new Date(),
      },
    });

    // Get team ID and update team status
    const execution = await prisma.agentTeamExecution.findUnique({
      where: { id: executionId },
    });
    if (execution) {
      await prisma.agentTeam.update({
        where: { id: execution.teamId },
        data: { status: 'idle' },
      });
    }

    callbacks?.onError?.(error, executionId);
    callbacks?.onStatusChange?.('failed', executionId);

    // Clean up active execution tracking
    this.activeExecutions.delete(executionId);
  }

  /**
   * Mark execution as completed
   */
  private async markExecutionCompleted(
    executionId: string,
    result: string,
    totalCostUsd: number
  ): Promise<void> {
    await prisma.agentTeamExecution.update({
      where: { id: executionId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    // Update member executions
    await prisma.agentMemberExecution.updateMany({
      where: { teamExecutionId: executionId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    // Get team ID and update team status
    const execution = await prisma.agentTeamExecution.findUnique({
      where: { id: executionId },
    });
    if (execution) {
      await prisma.agentTeam.update({
        where: { id: execution.teamId },
        data: { status: 'idle' },
      });
    }
  }

  /**
   * Update token counts in database
   */
  private async updateTokenCounts(
    executionId: string,
    inputTokens: number,
    outputTokens: number
  ): Promise<void> {
    await prisma.agentTeamExecution.update({
      where: { id: executionId },
      data: {
        totalInputTokens: { increment: inputTokens },
        totalOutputTokens: { increment: outputTokens },
      },
    });
  }

  /**
   * Get total input tokens for execution
   */
  private async getTotalInputTokens(executionId: string): Promise<number> {
    const execution = await prisma.agentTeamExecution.findUnique({
      where: { id: executionId },
      select: { totalInputTokens: true },
    });
    return execution?.totalInputTokens || 0;
  }

  /**
   * Get total output tokens for execution
   */
  private async getTotalOutputTokens(executionId: string): Promise<number> {
    const execution = await prisma.agentTeamExecution.findUnique({
      where: { id: executionId },
      select: { totalOutputTokens: true },
    });
    return execution?.totalOutputTokens || 0;
  }

  /**
   * Build team prompt with context
   */
  private buildTeamPrompt(
    team: AgentTeam & { leadAgent: AgentDefinition; members: (AgentTeamMember & { agent: AgentDefinition })[] },
    task: string
  ): string {
    const leadAgentInfo = `Lead Agent: ${team.leadAgent.displayName} (${team.leadAgent.category})`;
    
    const memberInfo = team.members.length > 0
      ? `\nTeam Members:\n${team.members.map(m => 
          `- ${m.agent.displayName} (${m.agent.category}) - Role: ${m.role}`
        ).join('\n')}`
      : '';

    const strategyInfo = `Task Strategy: ${team.taskStrategy || 'parallel'}`;

    return `${leadAgentInfo}${memberInfo}\n${strategyInfo}\n\nTask: ${task}`;
  }

  /**
   * Parse allowed tools from string
   */
  private parseAllowedTools(allowedTools?: string | null): string[] {
    if (!allowedTools) {
      return ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash'];
    }
    try {
      return JSON.parse(allowedTools);
    } catch {
      return allowedTools.split(',').map(t => t.trim());
    }
  }

  /**
   * Parse member tools from override or agent definition
   * IMPORTANT: Subagent tools MUST NOT include "Agent" (SDK limitation)
   */
  private parseMemberTools(member: AgentTeamMember & { agent: AgentDefinition }): string[] {
    // Use override tools if defined, otherwise use agent's allowed tools
    if (member.overrideTools) {
      try {
        return JSON.parse(member.overrideTools);
      } catch {
        return member.overrideTools.split(',').map(t => t.trim());
      }
    }
    
    if (member.agent.allowedTools) {
      try {
        return JSON.parse(member.agent.allowedTools);
      } catch {
        return member.agent.allowedTools.split(',').map(t => t.trim());
      }
    }
    
    // Default tools for subagents (no "Agent" tool)
    return ['Read', 'Grep', 'Glob', 'LS'];
  }

  /**
   * Find member execution record by execution ID and member ID
   */
  private async findMemberExecution(executionId: string, memberId: string): Promise<AgentMemberExecution | null> {
    return prisma.agentMemberExecution.findFirst({
      where: {
        teamExecutionId: executionId,
        memberId: memberId,
      },
    });
  }

  /**
   * Update member execution status
   */
  private async updateMemberExecutionStatus(memberExecutionId: string, status: string): Promise<void> {
    const updateData: { status: string; startedAt?: Date; completedAt?: Date } = { status };
    
    if (status === 'running') {
      updateData.startedAt = new Date();
    } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updateData.completedAt = new Date();
    }
    
    await prisma.agentMemberExecution.update({
      where: { id: memberExecutionId },
      data: updateData,
    });
  }

  /**
   * Update member token counts
   */
  private async updateMemberTokenCounts(
    executionId: string,
    memberId: string,
    inputTokens: number,
    outputTokens: number
  ): Promise<void> {
    const memberExec = await this.findMemberExecution(executionId, memberId);
    if (memberExec) {
      await prisma.agentMemberExecution.update({
        where: { id: memberExec.id },
        data: {
          inputTokens: { increment: inputTokens },
          outputTokens: { increment: outputTokens },
        },
      });
    }
  }

  /**
   * Parse MCP servers from string
   */
  private parseMcpServers(mcpServers?: string | null): Record<string, McpServerConfig> | null {
    if (!mcpServers) return null;
    try {
      return JSON.parse(mcpServers);
    } catch {
      return null;
    }
  }

  /**
   * Type guard: Check if message is result success
   */
  private isResultSuccess(message: SDKMessage): message is SDKResultSuccess {
    return (message as any).type === 'result' && (message as any).subtype === 'success';
  }

  /**
   * Type guard: Check if message is result error
   */
  private isResultError(message: SDKMessage): message is SDKResultError {
    return (message as any).type === 'result' && (message as any).subtype?.startsWith('error');
  }

  /**
   * Type guard: Check if message is tool use
   */
  private isToolUseMessage(message: SDKMessage): boolean {
    return (message as any).type === 'tool_use';
  }

  /**
   * Type guard: Check if message is tool result
   */
  private isToolResultMessage(message: SDKMessage): boolean {
    return (message as any).type === 'tool_result';
  }

  /**
   * Type guard: Check if message is assistant
   */
  private isAssistantMessage(message: SDKMessage): boolean {
    return (
      (message as any).type === 'assistant' ||
      (message as any).role === 'assistant' ||
      (message as any).subtype === 'assistant'
    );
  }
}

/**
 * Create AgentTeamExecutionService instance
 */
export function createAgentTeamExecutionService(): AgentTeamExecutionService {
  return new AgentTeamExecutionService();
}