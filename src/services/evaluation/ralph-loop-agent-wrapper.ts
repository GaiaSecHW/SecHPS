// src/services/evaluation/ralph-loop-agent-wrapper.ts
//
// Ralph Loop Agent 包装器
// 在现有的 EnhancedEvaluationCaller 之上添加迭代验证功能
//

import { EnhancedEvaluationCaller } from './enhanced-caller';
import type { EnhancedEvaluationConfig, EnhancedEvaluationCallbacks } from './enhanced-caller';
import { prisma } from '@/lib/prisma';
import type { VerifyCompletionFunction, VerifyCompletionResult, SimpleGenerateTextResult } from './ralph-loop-agent-evaluator';
import {
  iterationCountIs,
  tokenCountIs,
  costIs,
  aggregateStepUsage,
  addLanguageModelUsage,
  isRalphStopConditionMet,
} from './ralph-loop-agent';
import type { RalphStopCondition, RalphStopConditionContext } from './ralph-loop-agent';
import {
  queryRelevantExperiences,
  buildDynamicExperiencePrompt,
  type ErrorContext,
  type ExperienceMatch,
} from '@/services/autonomous-evolution/experience-query-service';
import { EvaluationMessageStore, createEvaluationMessageStore } from '@/services/evaluation-message-store';

/**
 * Ralph Loop Agent 配置
 */
export interface RalphLoopAgentConfig extends EnhancedEvaluationConfig {
  /**
   * 最大迭代次数（默认 10）
   */
  maxIterations?: number;

  /**
   * 最大 token 数量（默认 100,000）
   */
  maxTokens?: number;

  /**
   * 最大成本（美元，默认 $5）
   */
  maxCost?: number;

  /**
   * 完成验证函数
   */
  verifyCompletion?: VerifyCompletionFunction<any>;

  /**
   * 迭代开始回调
   */
  onIterationStart?: (iteration: number) => void | Promise<void>;

  /**
   * 迭代结束回调
   */
  onIterationEnd?: (iteration: number, duration: number, result: SimpleGenerateTextResult) => void | Promise<void>;

  /**
   * 上下文总结回调
   */
  onContextSummarized?: (data: {
    iteration: number;
    summarizedIterations: number;
    tokensSaved: number;
  }) => void | Promise<void>;
}

/**
 * Ralph Loop Agent 回调
 */
export interface RalphLoopAgentCallbacks extends EnhancedEvaluationCallbacks {
  /**
   * Ralph 完成回调
   */
  onRalphComplete?: (result: {
    text: string;
    iterations: number;
    completionReason: 'verified' | 'max-iterations' | 'aborted';
    reason?: string;
    allResults: SimpleGenerateTextResult[];
    totalUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  }) => void | Promise<void>;

  /**
   * 经验查询回调 - 当错误发生时查询到相关经验
   */
  onExperienceQueried?: (data: {
    errorContext: ErrorContext;
    matches: ExperienceMatch[];
    guidancePrompt: string;
    iteration: number;
  }) => void | Promise<void>;
}

/**
 * Ralph Loop Agent 结果
 */
export interface RalphLoopAgentResult {
  /**
   * 最终文本输出
   */
  readonly text: string;

  /**
   * 迭代次数
   */
  readonly iterations: number;

  /**
   * 完成原因
   */
  readonly completionReason: 'verified' | 'max-iterations' | 'aborted';

  /**
   * 完成原因或反馈
   */
  readonly reason?: string;

  /**
   * 最后一次迭代的结果
   */
  readonly result: SimpleGenerateTextResult;

  /**
   * 所有迭代的结果
   */
  readonly allResults: SimpleGenerateTextResult[];

  /**
   * 聚合的 token 使用量
   */
  readonly totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * Ralph Loop Agent
 *
 * 在现有的 EnhancedEvaluationCaller 之上添加迭代验证功能
 * 解决任务结束时间不稳定的问题
 */
export class RalphLoopAgent {
  private caller: EnhancedEvaluationCaller;
  private config: RalphLoopAgentConfig;
  private aborted: boolean = false;  // 中止标志
  private messageStore: EvaluationMessageStore | null = null;  // JSONL 消息存储

  constructor(config: RalphLoopAgentConfig) {
    this.config = config;
    this.caller = new EnhancedEvaluationCaller(config);
  }

  /**
   * 设置工作目录
   */
  setWorkingDirectory(dir: string): void {
    this.caller.setWorkingDirectory(dir);
  }

  /**
   * 获取工作目录
   */
  getWorkingDirectory(): string | undefined {
    return this.caller.getWorkingDirectory();
  }

  /**
   * 获取模型标识符
   */
  private getModelId(): string {
    return this.config.model || 'anthropic/claude-sonnet-4';
  }

  /**
   * 获取停止条件
   */
  private getStopConditions(): Array<RalphStopCondition<any>> {
    const conditions: RalphStopCondition<any>[] = [];

    // 迭代次数限制
    if (this.config.maxIterations !== undefined) {
      conditions.push(iterationCountIs(this.config.maxIterations));
    } else {
      // 默认 10 次迭代
      conditions.push(iterationCountIs(10));
    }

    // Token 数量限制
    if (this.config.maxTokens !== undefined) {
      conditions.push(tokenCountIs(this.config.maxTokens));
    }

    // 成本限制
    if (this.config.maxCost !== undefined) {
      conditions.push(costIs(this.config.maxCost, this.getModelId()));
    }

    return conditions.length > 0 ? conditions : [iterationCountIs(10)];
  }

  /**
   * 创建空的 usage 对象
   */
  private createEmptyUsage(): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
  }

  /**
   * 启动 Ralph Loop Agent
   */
  async loop({
    evaluationId,
    projectId,
    workflowNodeId,
    context,
    callbacks,
  }: {
    evaluationId: string;
    projectId: string;
    workflowNodeId?: string;  // 工作流节点 ID
    context: {
      projectName: string;
      projectDescription?: string;
      environmentUrl?: string;
      files: Array<{ name: string; type: string; size: number }>;
      taskDescription?: string | null;
      initialMessage?: string | null;
      workflowName?: string | null;
    };
    callbacks: RalphLoopAgentCallbacks;
  }): Promise<RalphLoopAgentResult> {
    const allResults: SimpleGenerateTextResult[] = [];
    let iteration = 0;
    let totalUsage = this.createEmptyUsage();
    let completionReason: RalphLoopAgentResult['completionReason'] = 'max-iterations';
    let reason: string | undefined;
    let lastExperienceGuidance: string | undefined;  // 存储上一轮错误查询到的经验指导
    
    // 初始化 JSONL 消息存储
    this.messageStore = createEvaluationMessageStore(projectId, evaluationId);
    try {
      await this.messageStore.initialize();
      console.log(`[Ralph Loop] JSONL 消息存储初始化成功`);
    } catch (error) {
      console.error(`[Ralph Loop] JSONL 消息存储初始化失败:`, error);
      this.messageStore = null;  // 失败时置空，不影响主流程
    }

    const stopConditions = this.getStopConditions();
    const modelId = this.getModelId();

    // 主循环
    while (true) {
      // 检查是否已中止
      if (this.isAborted()) {
        console.log('[Ralph Loop] 检测到中止信号，停止循环');
        completionReason = 'aborted';
        reason = '用户中止';
        break;
      }

      iteration++;
      const startTime = Date.now();

      // 调用迭代开始回调
      if (this.config.onIterationStart) {
        await this.config.onIterationStart(iteration);
      }

      // 构建本次迭代的 context（后续迭代追加反馈提示和经验指导）
      let iterationInitialMessage: string;
      if (iteration === 1) {
        iterationInitialMessage = context.initialMessage || context.taskDescription || '';
      } else {
        // 后续迭代：包含上一轮的经验指导（如果有）
        const experienceSection = lastExperienceGuidance
          ? `\n\n${lastExperienceGuidance}\n`
          : '';
        iterationInitialMessage = `继续工作。第 ${iteration - 1} 次尝试没有完成，请继续完成任务。如果任务已经完成，请明确说明。${experienceSection}\n\n原始任务：${context.taskDescription || context.initialMessage || ''}`;
        // 清除已使用的经验指导
        lastExperienceGuidance = undefined;
      }

      const iterationContext = {
        ...context,
        initialMessage: iterationInitialMessage,
      };

      // 执行一次评估
      // 用于存储错误时启动的经验查询 Promise
      let experienceQueryPromise: Promise<{ prompt: string; matches: ExperienceMatch[] }> | null = null;

      const result = await new Promise<SimpleGenerateTextResult>(
        (resolve, reject) => {
          let fullText = '';
          let iterationUsage: { inputTokens: number; outputTokens: number; totalTokens: number } = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          };

          const wrappedCallbacks: EnhancedEvaluationCallbacks = {
            onChunk: (text) => {
              fullText += text;
              callbacks.onChunk(text);
            },
            onThinking: callbacks.onThinking,
            onToolCall: callbacks.onToolCall,
            onToolResult: callbacks.onToolResult,
            onUsage: (usage) => {
              // 注意：上游 claude-agent.ts 返回的 usage 是累计值（cumulative）
              // 所以这里使用 Math.max 而不是累加，避免重复计算
              // 参考：https://docs.anthropic.com/en/api/streaming
              iterationUsage = {
                inputTokens: Math.max(iterationUsage.inputTokens, usage.inputTokens || 0),
                outputTokens: Math.max(iterationUsage.outputTokens, usage.outputTokens || 0),
                totalTokens: Math.max(iterationUsage.inputTokens, usage.inputTokens || 0) + Math.max(iterationUsage.outputTokens, usage.outputTokens || 0),
              };
              console.log(`[Ralph Loop] 迭代 ${iteration} 累计 Token (cumulative):`, {
                本次: { input: usage.inputTokens, output: usage.outputTokens },
                累计: iterationUsage,
              });
              
              // 传递给上层回调（累计值）
              callbacks.onUsage?.({
                ...usage,
                inputTokens: iterationUsage.inputTokens,
                outputTokens: iterationUsage.outputTokens,
              });
            },
            onComplete: async (fullResponse) => {
              resolve({
                text: fullResponse,
                steps: [],
                usage: iterationUsage,  // 使用真实的 usage 数据
                response: {
                  messages: [
                    {
                      role: 'assistant',
                      content: [
                        {
                          type: 'text',
                          text: fullResponse,
                        },
                      ],
                    },
                  ],
                },
                finishReason: 'stop',
                experimental_providerMetadata: undefined,
                warnings: undefined,
                request: {
                  messages: [],
                },
              } as unknown as SimpleGenerateTextResult);
            },
            onError: (error) => {
              // 区分致命错误和可恢复错误
              const isFatal =
                error.message.includes('error_max_turns') ||
                error.message.includes('error_max_budget_usd') ||
                error.message.includes('error_max_structured_output_retries');

              if (isFatal) {
                console.error(`[Ralph Loop] 致命错误，终止迭代:`, error.message);
                reject(error);
              } else {
                // error_during_execution 等可恢复错误：记录日志，用空结果继续
                console.warn(`[Ralph Loop] 迭代 ${iteration} 遇到可恢复错误，继续下一轮:`, error.message);

                // 启动经验查询（异步，不阻塞 resolve）
                const errorContext: ErrorContext = {
                  errorMessage: error.message,
                };
                experienceQueryPromise = buildDynamicExperiencePrompt(errorContext);
                console.log(`[Ralph Loop] 已启动经验查询，错误: ${error.message.substring(0, 100)}...`);

                resolve({
                  text: `[迭代错误] ${error.message}`,
                  steps: [],
                  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                  response: { messages: [] },
                  finishReason: 'error',
                  experimental_providerMetadata: undefined,
                  warnings: undefined,
                  request: { messages: [] },
                } as unknown as SimpleGenerateTextResult);
              }
            },
          };

          // 调用现有的评估调用器
          this.caller
            .startEvaluation(evaluationId, projectId, iterationContext, wrappedCallbacks)
            .catch(reject);
        }
      );

      allResults.push(result);

// 如果有经验查询 Promise，等待结果并处理
      if (experienceQueryPromise) {
        try {
          const expData = await experienceQueryPromise as { prompt: string; matches: ExperienceMatch[] };
          const prompt = expData.prompt;
          const matches = expData.matches;
          if (prompt && matches && matches.length > 0) {
            lastExperienceGuidance = prompt;
            console.log(`[Ralph Loop] ========== 动态查询结果注入 ==========`);
            console.log(`[Ralph Loop] 查询到 ${matches.length} 条相关经验，已注入下一轮指导`);
            console.log(`[Ralph Loop] 注入位置: iteration.feedback.experienceGuidance`);
            
            for (let i = 0; i < matches.length; i++) {
              const match = matches[i];
              console.log(`[Ralph Loop] 经验 ${i + 1}: "${match.experience.title}"`);
              console.log(`[Ralph Loop]   - 评分: ${match.relevanceScore.toFixed(1)}`);
              console.log(`[Ralph Loop]   - 匹配特征: ${match.matchedPatterns.join(', ')}`);
            }
            console.log(`[Ralph Loop] ========== 动态查询注入完成 ==========`);

            // 调用经验查询回调（发送 SSE 事件）
            if (callbacks.onExperienceQueried) {
              await callbacks.onExperienceQueried({
                errorContext: { errorMessage: allResults[allResults.length - 1]?.text?.replace('[迭代错误] ', '') || '' },
                matches,
                guidancePrompt: prompt,
                iteration,
              });
            }
          } else {
            console.log(`[Ralph Loop] 经验查询无结果，跳过注入`);
          }
        } catch (queryError) {
          console.error('[Ralph Loop] 经验查询失败:', queryError);
        }
        experienceQueryPromise = null;
      }

      // 迭代结束后再次检查中止状态
      if (this.isAborted()) {
        console.log('[Ralph Loop] 迭代结束后检测到中止信号');
        completionReason = 'aborted';
        reason = '用户中止';
        break;
      }

      // 更新总 token 使用量
      const iterationUsage = aggregateStepUsage(result);
      totalUsage = addLanguageModelUsage(totalUsage, iterationUsage);

      const duration = Date.now() - startTime;

      // 调用迭代结束回调
      if (this.config.onIterationEnd) {
        await this.config.onIterationEnd(iteration, duration, result);
      }

      // 检查停止条件
      const stopContext: RalphStopConditionContext<any> = {
        iteration,
        allResults,
        totalUsage,
        model: modelId,
      };

      if (await isRalphStopConditionMet({ stopConditions, context: stopContext })) {
        completionReason = 'max-iterations';
        break;
      }

      // 验证是否完成
      if (this.config.verifyCompletion) {
        const verification: VerifyCompletionResult = await this.config.verifyCompletion({
          result,
          iteration,
          allResults,
          originalPrompt: context.taskDescription || context.initialMessage || '',
        });

        if (verification.complete) {
          completionReason = 'verified';
          reason = verification.reason;
          break;
        }

        // 如果验证提供了反馈，记录到数据库
        if (verification.reason && !verification.complete) {
          console.log(`[Ralph] 迭代 ${iteration} 反馈: ${verification.reason}`);

          // ========================================
          // 双写机制：同时写入 Prisma 和 JSONL
          // ========================================
          
          // 1. 写入 JSONL（先写）
          if (this.messageStore) {
            try {
              await this.messageStore.appendMessage({
                role: 'system',
                nodeId: workflowNodeId || 'ralph-feedback',  // 使用 workflowNodeId 或固定 nodeId
                nodeIndex: iteration,  // 使用迭代次数作为 nodeIndex
                content: `[Ralph 反馈]\n${verification.reason}`,
                agentCallMsgId: null,
              });
            } catch (jsonlError) {
              console.error('[Ralph] JSONL 写入失败:', jsonlError);
            }
          }
          
          // 2. 写入 Prisma（双写过渡期保留）
          try {
            await prisma.sessionMessage.create({
              data: {
                id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                evaluationSessionId: evaluationId,
                role: 'system',
                content: `[Ralph 反馈]\n${verification.reason}`,
              },
            });
          } catch (error) {
            console.error('[Ralph] 保存反馈失败:', error);
          }
        }
      } else {
        // 没有验证函数时，检查文本是否包含完成信号
        const text = result.text.toLowerCase();
        const completionKeywords = [
          '任务完成', '评估完成', '扫描完成', '已完成', '完成了', '全部完成',
          'task complete', 'completed', 'done', 'finished', 'all tasks', 'successfully completed',
        ];
        if (completionKeywords.some((kw) => text.includes(kw))) {
          completionReason = 'verified';
          reason = '检测到完成关键词';
          break;
        }
      }
    }

    const finalResult = allResults[allResults.length - 1]!;

    const ralphResult: RalphLoopAgentResult = {
      text: finalResult.text,
      iterations: iteration,
      completionReason,
      reason,
      result: finalResult,
      allResults,
      totalUsage,
    };

    // 调用 Ralph 完成回调
    if (callbacks.onRalphComplete) {
      await callbacks.onRalphComplete(ralphResult);
    }

    return ralphResult;
  }

  /**
   * 中止评估
   */
  abort(): void {
    console.log('[Ralph Loop] 收到中止请求，设置中止标志');
    this.aborted = true;
    this.caller.abort();
  }

  /**
   * 检查是否已中止
   */
  isAborted(): boolean {
    return this.aborted || this.caller.isAborted();
  }
}

/**
 * 创建 Ralph Loop Agent 的工厂方法
 */
export function createRalphLoopAgent(
  modelConfig: {
    providerType: string;
    apiKey: string;
    apiBaseUrl: string;
    models: string;
  },
  workingDirectory?: string,
  ralphConfig?: {
    maxIterations?: number;
    maxTokens?: number;
    maxCost?: number;
    verifyCompletion?: VerifyCompletionFunction<any>;
    onIterationStart?: (iteration: number) => void | Promise<void>;
  onIterationEnd?: (iteration: number, duration: number, result: SimpleGenerateTextResult<any>) => void | Promise<void>;
    onContextSummarized?: (data: {
      iteration: number;
      summarizedIterations: number;
      tokensSaved: number;
    }) => void | Promise<void>;
  },
  sdkOptions?: {
    mcpServers?: Array<{
      name: string;
      type: 'local' | 'remote';
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
      isEnabled?: boolean;
      autoStart?: boolean;
    }>;
    toolPermissions?: Array<{
      toolPattern: string;
      permission: 'allow' | 'deny' | 'ask';
    }>;
    systemPrompt?: string;
    settingSources?: ('project' | 'user' | 'local')[];
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
    allowDangerouslySkipPermissions?: boolean;
    workflowNodeId?: string;  // 工作流节点 ID，用于保存 session_id
    allowedTools?: string[];  // 允许的工具列表（包含注册的 Skills）
  }
): RalphLoopAgent {
  // 解析模型名称
  let model: string;
  try {
    const parsed = JSON.parse(modelConfig.models);
    model = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    model = modelConfig.models;
  }
  
  if (!model) {
    throw new Error(`模型配置的 models 字段为空，必须配置至少一个模型。`);
  }

  const providerType: 'claude' | 'openai' =
    modelConfig.providerType === 'claude' ? 'claude' : 'openai';

  const agent = new RalphLoopAgent({
    providerType,
    apiKey: modelConfig.apiKey,
    baseUrl: modelConfig.apiBaseUrl || undefined,
    model,
    cwd: workingDirectory,
    // SDK 高级配置
    mcpServers: sdkOptions?.mcpServers,
    toolPermissions: sdkOptions?.toolPermissions,
    systemPrompt: sdkOptions?.systemPrompt,
    settingSources: sdkOptions?.settingSources,
    permissionMode: sdkOptions?.permissionMode,
    allowDangerouslySkipPermissions: sdkOptions?.allowDangerouslySkipPermissions,
    workflowNodeId: sdkOptions?.workflowNodeId,  // 传递 workflowNodeId
    allowedTools: sdkOptions?.allowedTools,  // 传递 allowedTools（包含注册的 Skills）
    // Ralph Loop 配置
    ...ralphConfig,
  });

  if (workingDirectory) {
    agent.setWorkingDirectory(workingDirectory);
  }

  return agent;
}
