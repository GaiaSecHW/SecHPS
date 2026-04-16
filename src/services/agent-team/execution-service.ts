// src/services/agent-team/execution-service.ts

import { query, Options, SDKMessage, SDKResultSuccess, SDKResultError, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition as SdkAgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { prisma } from '@/lib/prisma';
import type { AgentTeamExecution, AgentMemberExecution, AgentTeam, AgentTeamMember, AgentDefinition } from '@prisma/client';
import { parseRalphConfig } from '@/types/ralph-loop-config';
import type {
  AgentTeamVerificationContext,
  AgentTeamVerificationResult,
  SubagentCallRecord,
  IterationRecord,
} from '@/types/ralph-loop-config';
import { emitIterationStarted, emitIterationCompleted, emitExperienceQueried } from '@/lib/agent-team-events';
import { buildDynamicExperiencePrompt } from '@/services/autonomous-evolution/experience-query-service';

/**
 * Safety limits for agent team execution
 */
export const SAFETY_LIMITS = {
  maxBudgetUsd: 5.00,
  maxTurns: 20,
};

/**
 * Model pricing (USD per million tokens)
 * Reference: https://www.anthropic.com/pricing
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic Claude models
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-haiku-3-5-20241022': { input: 0.8, output: 4 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-haiku-4-20250514': { input: 0.8, output: 4 },
  'claude-haiku-4': { input: 0.8, output: 4 },
  // OpenAI models (approximate pricing)
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  // GLM models (RMB pricing, converted to USD at ~7:1 ratio)
  'glm-5': { input: 0.86, output: 3.14 },
  'glm-4': { input: 0.86, output: 3.14 },
};

/**
 * Get model pricing with fallback to default
 */
export function getModelPricing(model: string): { input: number; output: number } {
  const pricing = MODEL_PRICING[model];
  if (pricing) {
    return pricing;
  }
  // Default pricing for unknown models (use sonnet-like pricing)
  console.warn(`[CostAttribution] Unknown model "${model}", using default pricing`);
  return { input: 3, output: 15 };
}

/**
 * Calculate cost from token usage
 * Formula: (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  const pricing = getModelPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

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
    model?: string;
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
  estimatedCostUsd: number;
  memberExecutions: Array<{
    id: string;
    memberId: string;
    status: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
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
        AgentDefinition: true,
        AgentTeamMember: {
          include: {
            AgentDefinition: true,
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
        id: `team-exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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
    if (team.AgentTeamMember.length > 0) {
      const createdMembers = await prisma.agentMemberExecution.createMany({
        data: team.AgentTeamMember.map((member, index) => ({
          id: `memberexec-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 9)}`,
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
    this.runExecution(execution.id, team, task, abortController, modelConfigId, callbacks)
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
   * Start a new agent team execution with Ralph Loop iteration
   *
   * @param params Execution parameters
   * @returns Execution result with iteration count and completion reason
   */
  async executeWithRalphLoop(params: ExecuteParams): Promise<{
    executionId: string;
    iterations: number;
    completionReason: 'verified' | 'max_iterations' | 'max_cost' | 'aborted';
    totalCostUsd: number;
  }> {
    const { teamId, projectId, task, modelConfigId, callbacks } = params;

    // Fetch team with members and lead agent
    const team = await prisma.agentTeam.findUnique({
      where: { id: teamId },
      include: {
        AgentDefinition: true,
        AgentTeamMember: {
          include: {
            AgentDefinition: true,
          },
        },
      },
    });

    if (!team) {
      throw new Error(`Agent team not found: ${teamId}`);
    }

    // Parse Ralph Loop config
    const ralphConfig = parseRalphConfig(team.ralphConfig);

    // If Ralph Loop is not enabled, fall back to regular execute()
    if (!ralphConfig.enabled) {
      const result = await this.execute(params);
      return {
        executionId: result.executionId,
        iterations: 1,
        completionReason: 'verified',
        totalCostUsd: 0,
      };
    }

    // Create execution record in database
    const execution = await prisma.agentTeamExecution.create({
      data: {
        id: `team-exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        teamId,
        evaluationId: projectId,
        status: 'running',
        startedAt: new Date(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
    });

    // Create member execution records
    if (team.AgentTeamMember.length > 0) {
      await prisma.agentMemberExecution.createMany({
        data: team.AgentTeamMember.map((member, index) => ({
          id: `member-exec-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 9)}`,
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

    // Iteration loop
    let iteration = 0;
    let totalCostUsd = 0;
    let completionReason: 'verified' | 'max_iterations' | 'max_cost' | 'aborted' = 'max_iterations';
    let lastFeedback: string | undefined;
    let currentTask = task;
    const iterationRecords: IterationRecord[] = [];
    let usedExperienceLearning = false;

    try {
      while (iteration < ralphConfig.maxIterations && totalCostUsd < ralphConfig.maxCostUsd) {
        iteration++;

        // Check abort signal
        if (abortController.signal.aborted) {
          completionReason = 'aborted';
          console.log(`[RalphLoop] Execution ${execution.id} aborted at iteration ${iteration}`);
          break;
        }

        const iterationStartedAt = new Date();

        // Broadcast iteration_started event
        emitIterationStarted(execution.id, teamId, {
          iteration,
          maxIterations: ralphConfig.maxIterations,
          previousFeedback: lastFeedback,
          totalCostUsdSoFar: totalCostUsd,
        });

        console.log(`[RalphLoop] Starting iteration ${iteration}/${ralphConfig.maxIterations} for execution ${execution.id}`);

        // Execute single iteration (Lead Agent)
        const iterationResult = await this.runSingleIteration(
          execution.id,
          team,
          currentTask,
          abortController,
          modelConfigId,
          callbacks
        );

        // Build VerificationContext
        const context: AgentTeamVerificationContext = {
          finalText: iterationResult.text,
          totalInputTokens: iterationResult.inputTokens,
          totalOutputTokens: iterationResult.outputTokens,
          estimatedCostUsd: iterationResult.costUsd,
          subagentCalls: iterationResult.subagentCalls,
          iteration,
          maxIterations: ralphConfig.maxIterations,
          originalTask: task,
          teamId,
          executionId: execution.id,
        };

        // Run verification if configured
        let verification: AgentTeamVerificationResult = { verified: false };
        if (ralphConfig.verifyCompletion) {
          verification = await this.runVerification(context, ralphConfig.verifyCompletion);
        } else {
          // Default verification: check for completion keywords
          const text = iterationResult.text.toLowerCase();
          const completionKeywords = [
            '任务完成', '评估完成', '扫描完成', '已完成', '完成了', '全部完成',
            'task complete', 'completed', 'done', 'finished', 'all tasks', 'successfully completed',
          ];
          if (completionKeywords.some(kw => text.includes(kw))) {
            verification = { verified: true, feedback: '检测到完成关键词' };
          }
        }

        // Record iteration
        const iterationRecord: IterationRecord = {
          iteration,
          startedAt: iterationStartedAt,
          completedAt: new Date(),
          result: iterationResult.text,
          verification,
          tokensUsed: {
            input: iterationResult.inputTokens,
            output: iterationResult.outputTokens,
          },
          costUsd: iterationResult.costUsd,
          experienceQueried: false,
        };
        iterationRecords.push(iterationRecord);

        // Broadcast iteration_completed event
        emitIterationCompleted(execution.id, teamId, {
          iteration,
          result: iterationResult.text,
          verified: verification.verified,
          feedback: verification.feedback,
          tokensUsed: {
            input: iterationResult.inputTokens,
            output: iterationResult.outputTokens,
          },
          costUsd: iterationResult.costUsd,
          totalCostUsdSoFar: totalCostUsd + iterationResult.costUsd,
        });

        totalCostUsd += iterationResult.costUsd;

        console.log(`[RalphLoop] Iteration ${iteration} completed: verified=${verification.verified}, cost=$${iterationResult.costUsd.toFixed(4)}, total=$${totalCostUsd.toFixed(4)}`);

        if (verification.verified) {
          completionReason = 'verified';
          console.log(`[RalphLoop] Task verified at iteration ${iteration}`);
          break;
        }

        // Query experiences on verification failure (if configured)
        if (ralphConfig.experienceTrigger === 'on_failure' && !verification.verified) {
          const errorContext = {
            errorMessage: verification.feedback || iterationResult.text,
          };

          try {
            const guidanceData = await buildDynamicExperiencePrompt(errorContext);

            if (guidanceData.prompt && guidanceData.matches.length > 0) {
              usedExperienceLearning = true;
              iterationRecord.experienceQueried = true;
              iterationRecord.experiencesFound = guidanceData.matches.length;

              // Broadcast experience_queried event
              emitExperienceQueried(execution.id, teamId, {
                iteration,
                experiencesFound: guidanceData.matches.length,
                experienceTitles: guidanceData.matches.map(m => m.experience.title),
                guidanceInjected: guidanceData.prompt.substring(0, 100),
              });

              console.log(`[RalphLoop] Queried ${guidanceData.matches.length} experiences for iteration ${iteration}`);

              // Inject experience guidance into next iteration's task
              currentTask = `${task}\n\n[经验指导]\n${guidanceData.prompt}`;
            }
          } catch (expError) {
            console.error(`[RalphLoop] Experience query failed:`, expError);
          }
        }

        // Update feedback for next iteration
        lastFeedback = verification.feedback;

        // Check cost limit
        if (totalCostUsd >= ralphConfig.maxCostUsd) {
          completionReason = 'max_cost';
          console.log(`[RalphLoop] Max cost limit reached: $${totalCostUsd.toFixed(4)} >= $${ralphConfig.maxCostUsd}`);
          break;
        }
      }

      // Mark execution as completed
      await this.markExecutionCompleted(execution.id, iterationRecords[iterationRecords.length - 1]?.result || '', totalCostUsd);
      callbacks?.onComplete?.(iterationRecords[iterationRecords.length - 1]?.result || '', execution.id);
      callbacks?.onStatusChange?.('completed', execution.id);

    } catch (error) {
      console.error(`[RalphLoop] Execution ${execution.id} failed:`, error);
      await this.handleExecutionError(execution.id, error as Error, callbacks);
      throw error;
    } finally {
      // Clean up active execution tracking
      this.activeExecutions.delete(execution.id);
    }

    return {
      executionId: execution.id,
      iterations: iteration,
      completionReason,
      totalCostUsd,
    };
  }

  /**
   * Run a single iteration of the Ralph Loop
   *
   * @returns Iteration result with text, tokens, cost, and subagent calls
   */
  private async runSingleIteration(
    executionId: string,
    team: AgentTeam & { AgentDefinition: AgentDefinition; AgentTeamMember: (AgentTeamMember & { AgentDefinition: AgentDefinition })[] },
    task: string,
    abortController: AbortController,
    modelConfigId?: string,
    callbacks?: ExecutionCallbacks
  ): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    subagentCalls: SubagentCallRecord[];
  }> {
    // Build environment variables
    const env: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: '600000',
    };

    // Build Lead Agent's allowedTools - MUST include "Agent" for subagent invocation
    const leadAgentTools = this.parseAllowedTools(team.AgentDefinition.allowedTools);
    if (!leadAgentTools.includes('Agent')) {
      leadAgentTools.push('Agent');
    }

    // Build subagent definitions from team members
    const agents: Record<string, SdkAgentDefinition> = {};
    for (const member of team.AgentTeamMember) {
      const memberTools = this.parseMemberTools(member);
      const filteredTools = memberTools.filter(t => t !== 'Agent');

      agents[member.AgentDefinition.name] = {
        description: member.AgentDefinition.description || `Use for ${member.role} tasks`,
        prompt: member.AgentDefinition.systemPrompt || `You are a ${member.role} agent.`,
        tools: filteredTools,
        model: member.overrideModel || member.AgentDefinition.model || undefined,
      };
    }

    // Build SDK options with safety limits
    const options: Options = {
      cwd: process.cwd(),
      model: team.AgentDefinition.model || 'claude-sonnet-4-20250514',
      allowedTools: leadAgentTools,
      agents: Object.keys(agents).length > 0 ? agents : undefined,
      abortController,
      env,
      maxBudgetUsd: SAFETY_LIMITS.maxBudgetUsd,
      maxTurns: SAFETY_LIMITS.maxTurns,
      permissionMode: 'auto',
      allowDangerouslySkipPermissions: true,
    } as any;

    // Configure MCP servers if defined
    if (team.AgentDefinition.mcpServers) {
      const mcpServers = this.parseMcpServers(team.AgentDefinition.mcpServers);
      if (mcpServers && Object.keys(mcpServers).length > 0) {
        options.mcpServers = mcpServers;
      }
    }

    // Configure system prompt
    if (team.AgentDefinition.systemPrompt) {
      options.systemPrompt = team.AgentDefinition.systemPrompt;
    }

    // Build prompt with team context
    const fullPrompt = this.buildTeamPrompt(team, task);

    // Track token usage
    let inputTokens = 0;
    let outputTokens = 0;
    let fullResponse = '';
    const subagentCalls: SubagentCallRecord[] = [];

    // Track model for cost attribution
    const leadAgentModel = team.AgentDefinition.model || 'claude-sonnet-4-20250514';
    let currentModel = leadAgentModel;

    // Run SDK query
    const q = query({ prompt: fullPrompt, options });

    for await (const message of q) {
      const msg = message as any;

      if (this.isResultSuccess(message)) {
        fullResponse = message.result || '';
        callbacks?.onChunk?.(message.result);

      } else if (this.isResultError(message)) {
        const errorMsg = message.errors?.join('\n') || 'Unknown error';
        throw new Error(errorMsg);

      } else if (this.isToolUseMessage(message)) {
        const toolName = msg.tool_name;
        const toolInput = msg.tool_input || {};

        callbacks?.onToolUse?.(toolName, toolInput);

        // Track Agent tool invocations (subagent calls)
        if (toolName === 'Agent') {
          const agentName = toolInput.agent_name || toolInput.agent_type;
          if (agentName) {
            subagentCalls.push({
              agentName,
              result: '',
              tokensUsed: 0,
              status: 'pending',
            });
          }
        }

      } else if (this.isToolResultMessage(message)) {
        const toolName = msg.tool_name;
        const toolResult = msg.tool_result;

        callbacks?.onToolResult?.(toolName, toolResult);

        // Update subagent call record on completion
        if (toolName === 'Agent') {
          const lastCall = subagentCalls[subagentCalls.length - 1];
          if (lastCall && lastCall.status === 'pending') {
            lastCall.result = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
            lastCall.status = 'completed';
          }
        }

      } else if (this.isAssistantMessage(message)) {
        // Extract usage data
        const usageData = msg.message?.usage || msg.usage;
        if (usageData) {
          const iterInputTokens = usageData.input_tokens || 0;
          const iterOutputTokens = usageData.output_tokens || 0;

          inputTokens += iterInputTokens;
          outputTokens += iterOutputTokens;

          // Update database token counts
          await this.updateTokenCounts(executionId, iterInputTokens, iterOutputTokens);

          callbacks?.onUsage?.({
            inputTokens: iterInputTokens,
            outputTokens: iterOutputTokens,
            cacheReadInputTokens: usageData.cache_read_input_tokens || 0,
            cacheCreationInputTokens: usageData.cache_creation_input_tokens || 0,
            model: currentModel,
            totalCostUsd: calculateCost(iterInputTokens, iterOutputTokens, currentModel),
          });
        }

        // Extract text content
        if (msg.content) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              fullResponse += block.text;
              callbacks?.onChunk?.(block.text);
            }
          }
        }
      }
    }

    // Calculate cost
    const costUsd = calculateCost(inputTokens, outputTokens, leadAgentModel);

    return {
      text: fullResponse,
      inputTokens,
      outputTokens,
      costUsd,
      subagentCalls,
    };
  }

  /**
   * Run verification function for Ralph Loop
   *
   * @param context Verification context
   * @param verifyCompletion Verification function code or path
   * @returns Verification result
   */
  private async runVerification(
    context: AgentTeamVerificationContext,
    verifyCompletion: string
  ): Promise<AgentTeamVerificationResult> {
    try {
      // If verifyCompletion is a path to a script, we would load and execute it
      // For now, we implement a simple keyword-based verification

      const text = context.finalText.toLowerCase();

      // Check for explicit completion signals
      const completionKeywords = [
        '任务完成', '评估完成', '扫描完成', '已完成', '完成了', '全部完成',
        'task complete', 'completed', 'done', 'finished', 'all tasks', 'successfully completed',
        'verification passed', '验证通过',
      ];

      const failureKeywords = [
        '任务失败', '评估失败', '扫描失败', '失败',
        'task failed', 'failed', 'error', '错误',
      ];

      // Check for completion
      if (completionKeywords.some(kw => text.includes(kw))) {
        return {
          verified: true,
          feedback: '检测到完成关键词',
          stopReason: 'verified',
        };
      }

      // Check for explicit failure
      if (failureKeywords.some(kw => text.includes(kw))) {
        return {
          verified: false,
          feedback: `检测到失败关键词，建议检查错误并重新尝试。输出内容: ${context.finalText.substring(0, 200)}...`,
          suggestedAction: '检查错误日志并修复问题',
        };
      }

      // Default: not verified, provide feedback for next iteration
      return {
        verified: false,
        feedback: `迭代 ${context.iteration} 未检测到明确的完成信号。请继续完成任务并明确声明完成状态。`,
        suggestedAction: '继续执行任务，完成后明确声明',
      };

    } catch (error) {
      console.error('[RalphLoop] Verification failed:', error);
      return {
        verified: false,
        feedback: `验证函数执行错误: ${(error as Error).message}`,
        stopReason: 'error',
      };
    }
  }

  /**
   * Internal method to run the actual SDK execution
   */
  private async runExecution(
    executionId: string,
    team: AgentTeam & { AgentDefinition: AgentDefinition; AgentTeamMember: (AgentTeamMember & { AgentDefinition: AgentDefinition })[] },
    task: string,
    abortController: AbortController,
    modelConfigId?: string,
    callbacks?: ExecutionCallbacks
  ): Promise<void> {
    try {
      // Build environment variables
      const env: Record<string, string | undefined> = {
        ...process.env,
        CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: '600000',
      };

      // Build Lead Agent's allowedTools - MUST include "Agent" for subagent invocation
      const leadAgentTools = this.parseAllowedTools(team.AgentDefinition.allowedTools);
      if (!leadAgentTools.includes('Agent')) {
        leadAgentTools.push('Agent');
      }

      // Build subagent definitions from team members
      // IMPORTANT: Subagent tools MUST NOT include "Agent" (SDK limitation - no nesting)
      const agents: Record<string, SdkAgentDefinition> = {};
      for (const member of team.AgentTeamMember) {
        const memberTools = this.parseMemberTools(member);
        // Ensure "Agent" is NOT in subagent tools (no nesting allowed)
        const filteredTools = memberTools.filter(t => t !== 'Agent');
        
        agents[member.AgentDefinition.name] = {
          description: member.AgentDefinition.description || `Use for ${member.role} tasks`,
          prompt: member.AgentDefinition.systemPrompt || `You are a ${member.role} agent.`,
          tools: filteredTools,
          model: member.overrideModel || member.AgentDefinition.model || undefined,
        };
      }

      // Build SDK options with safety limits
      const options: Options = {
        cwd: process.cwd(),
        model: team.AgentDefinition.model || 'claude-sonnet-4-20250514',
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
      if (team.AgentDefinition.mcpServers) {
        const mcpServers = this.parseMcpServers(team.AgentDefinition.mcpServers);
        if (mcpServers && Object.keys(mcpServers).length > 0) {
          options.mcpServers = mcpServers;
        }
      }

      // Configure system prompt
      if (team.AgentDefinition.systemPrompt) {
        options.systemPrompt = team.AgentDefinition.systemPrompt;
      }

      // Build prompt with team context
      const fullPrompt = this.buildTeamPrompt(team, task);

      // Track token usage per member
      const tokenUsageByMember: Map<string, { input: number; output: number }> = new Map();

      // Track active subagent invocations (agent_name -> member_execution_id)
      const activeSubagents: Map<string, string> = new Map();

      // Build member lookup map (agent_name -> member)
      const memberByAgentName: Map<string, typeof team.AgentTeamMember[0]> = new Map();
      for (const member of team.AgentTeamMember) {
        memberByAgentName.set(member.AgentDefinition.name, member);
      }

      // Track model per member for cost attribution
      const modelByMemberId: Map<string, string> = new Map();
      for (const member of team.AgentTeamMember) {
        const memberModel = member.overrideModel || member.AgentDefinition.model || team.AgentDefinition.model || 'claude-sonnet-4-20250514';
        modelByMemberId.set(member.id, memberModel);
      }

      // Lead agent model
      const leadAgentModel = team.AgentDefinition.model || 'claude-sonnet-4-20250514';

      // Run SDK query
      const q = query({ prompt: fullPrompt, options });

      let fullResponse = '';
      let currentMemberId: string | undefined;
      let currentModel = leadAgentModel;

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
                  
                  // Switch to subagent model for cost attribution
                  currentModel = modelByMemberId.get(member.id) || leadAgentModel;
                  
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
                
                // Switch back to lead agent model
                currentModel = leadAgentModel;
                
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

            // Calculate cost for this usage
            const costUsd = calculateCost(inputTokens, outputTokens, currentModel);

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
              model: currentModel,
              totalCostUsd: costUsd,
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
   * @param model Optional model for cost calculation (defaults to sonnet pricing)
   * @returns Execution status with member executions and estimated costs
   */
  async getStatus(executionId: string, model?: string): Promise<ExecutionStatus> {
    const execution = await prisma.agentTeamExecution.findUnique({
      where: { id: executionId },
      include: {
        AgentMemberExecution: {
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

    // Use provided model or default for cost calculation
    const costModel = model || 'claude-sonnet-4-20250514';
    
    // Calculate total estimated cost
    const totalCostUsd = calculateCost(
      execution.totalInputTokens,
      execution.totalOutputTokens,
      costModel
    );

    return {
      id: execution.id,
      teamId: execution.teamId,
      status: execution.status,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      totalInputTokens: execution.totalInputTokens,
      totalOutputTokens: execution.totalOutputTokens,
      estimatedCostUsd: totalCostUsd,
      memberExecutions: execution.AgentMemberExecution.map(me => ({
        id: me.id,
        memberId: me.memberId,
        status: me.status,
        inputTokens: me.inputTokens,
        outputTokens: me.outputTokens,
        estimatedCostUsd: calculateCost(me.inputTokens, me.outputTokens, costModel),
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
    team: AgentTeam & { AgentDefinition: AgentDefinition; AgentTeamMember: (AgentTeamMember & { AgentDefinition: AgentDefinition })[] },
    task: string
  ): string {
    const leadAgentInfo = `Lead Agent: ${team.AgentDefinition.displayName} (${team.AgentDefinition.category})`;
    
    const memberInfo = team.AgentTeamMember.length > 0
      ? `\nTeam Members:\n${team.AgentTeamMember.map(m => 
          `- ${m.AgentDefinition.displayName} (${m.AgentDefinition.category}) - Role: ${m.role}`
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
  private parseMemberTools(member: AgentTeamMember & { AgentDefinition: AgentDefinition }): string[] {
    // Use override tools if defined, otherwise use agent's allowed tools
    if (member.overrideTools) {
      try {
        return JSON.parse(member.overrideTools);
      } catch {
        return member.overrideTools.split(',').map(t => t.trim());
      }
    }
    
    if (member.AgentDefinition.allowedTools) {
      try {
        return JSON.parse(member.AgentDefinition.allowedTools);
      } catch {
        return member.AgentDefinition.allowedTools.split(',').map(t => t.trim());
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