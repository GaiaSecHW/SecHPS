// src/services/evaluation/ralph-loop-agent-wrapper.ts
//
// Ralph Loop Agent 包装器
// 在现有的 EnhancedEvaluationCaller 之上添加迭代验证功能
//

import { EnhancedEvaluationCaller } from './enhanced-caller';
import type { EnhancedEvaluationConfig, EnhancedEvaluationCallbacks } from './enhanced-caller';
import { prisma } from '@/lib/prisma';
import type { GenerateTextResult, ToolSet } from 'ai';
import type { VerifyCompletionFunction, VerifyCompletionResult } from './ralph-loop-agent-evaluator';
import {
  iterationCountIs,
  tokenCountIs,
  costIs,
  aggregateStepUsage,
  addLanguageModelUsage,
  isRalphStopConditionMet,
} from './ralph-loop-agent';
import type { RalphStopCondition, RalphStopConditionContext } from './ralph-loop-agent';

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
  onIterationEnd?: (iteration: number, duration: number, result: GenerateTextResult<any, never>) => void | Promise<void>;

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
    allResults: GenerateTextResult<any, never>[];
    totalUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
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
  readonly result: GenerateTextResult<any, never>;

  /**
   * 所有迭代的结果
   */
  readonly allResults: GenerateTextResult<any, never>[];

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
    context,
    callbacks,
  }: {
    evaluationId: string;
    projectId: string;
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
    const allResults: GenerateTextResult<any, never>[] = [];
    let iteration = 0;
    let totalUsage = this.createEmptyUsage();
    let completionReason: RalphLoopAgentResult['completionReason'] = 'max-iterations';
    let reason: string | undefined;

    const stopConditions = this.getStopConditions();
    const modelId = this.getModelId();

    // 主循环
    while (true) {
      iteration++;
      const startTime = Date.now();

      // 调用迭代开始回调
      if (this.config.onIterationStart) {
        await this.config.onIterationStart(iteration);
      }

      // 构建本次迭代的 context（后续迭代追加反馈提示）
      const iterationContext = {
        ...context,
        initialMessage:
          iteration === 1
            ? (context.initialMessage || context.taskDescription || '')
            : `继续工作。第 ${iteration - 1} 次尝试没有完成，请继续完成任务。如果任务已经完成，请明确说明。\n\n原始任务：${context.taskDescription || context.initialMessage || ''}`,
      };

      // 执行一次评估
      const result = await new Promise<GenerateTextResult<any, never>>(
        (resolve, reject) => {
          let fullText = '';

          const wrappedCallbacks: EnhancedEvaluationCallbacks = {
            onChunk: (text) => {
              fullText += text;
              callbacks.onChunk(text);
            },
            onToolCall: callbacks.onToolCall,
            onToolResult: callbacks.onToolResult,
            onComplete: async (fullResponse) => {
              resolve({
                text: fullResponse,
                steps: [],
                usage: {
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 0,
                },
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
              } as unknown as GenerateTextResult<any, never>);
            },
            onError: (error) => {
              reject(error);
            },
          };

          // 调用现有的评估调用器
          this.caller
            .startEvaluation(evaluationId, projectId, iterationContext, wrappedCallbacks)
            .catch(reject);
        }
      );

      allResults.push(result);

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

          // 保存反馈到数据库
          try {
            await prisma.sessionMessage.create({
              data: {
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
        const completionKeywords = ['任务完成', '评估完成', '扫描完成', 'task complete', 'completed'];
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
    this.caller.abort();
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
    onIterationEnd?: (iteration: number, duration: number, result: GenerateTextResult<any, never>) => void | Promise<void>;
    onContextSummarized?: (data: {
      iteration: number;
      summarizedIterations: number;
      tokensSaved: number;
    }) => void | Promise<void>;
  }
): RalphLoopAgent {
  // 解析模型名称
  let model: string;
  try {
    const parsed = JSON.parse(modelConfig.models);
    model = Array.isArray(parsed) ? (parsed[0] || 'claude-sonnet-4-20250514') : parsed;
  } catch {
    model = modelConfig.models || 'claude-sonnet-4-20250514';
  }

  const providerType: 'claude' | 'openai' =
    modelConfig.providerType === 'claude' ? 'claude' : 'openai';

  const agent = new RalphLoopAgent({
    providerType,
    apiKey: modelConfig.apiKey,
    baseUrl: modelConfig.apiBaseUrl || undefined,
    model,
    cwd: workingDirectory,
    ...ralphConfig,
  });

  if (workingDirectory) {
    agent.setWorkingDirectory(workingDirectory);
  }

  return agent;
}
