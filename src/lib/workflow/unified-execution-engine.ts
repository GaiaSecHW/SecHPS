/**
 * Unified Workflow Execution Engine
 *
 * 统一执行引擎，用于 FSM 工作流和自定义 DAG 工作流的执行
 * 支持串行节点执行、角色模型配置、重试机制、完整错误堆栈记录
 */

import { prisma } from '@/lib/prisma';
import { createRalphLoopAgent, RalphLoopAgent } from '@/services/evaluation';
import { NodeStreamStore } from '@/services/node-stream-store';
import { loadMcpServersForProject } from '@/lib/mcp-loader';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';
import type {
  UnifiedNodeDefinition,
  ModelConfigForExecution,
  UnifiedExecutionConfig,
  UnifiedExecutionCallbacks,
  NodeExecutionResult,
  WorkflowExecutionResult,
  NodeExecutionStatus,
  WorkflowExecutionStatus,
} from './types';

/**
 * 统一工作流执行引擎
 *
 * 核心功能：
 * - 串行执行所有节点
 * - 每个节点根据 roleId 使用不同的模型配置
 * - 完整的错误堆栈记录
 * - 重试机制（15次，间隔1分钟）
 * - 支持 abort 中止
 */
export class UnifiedWorkflowExecutionEngine {
  /** 执行配置 */
  private config: UnifiedExecutionConfig;
  
  /** 执行回调 */
  private callbacks: UnifiedExecutionCallbacks;
  
  /** 节点列表（由外部设置） */
  private nodes: UnifiedNodeDefinition[] = [];
  
  /** 中止标志 */
  private aborted: boolean = false;
  
  /** 当前执行的 Agent（用于中止） */
  private currentAgent: RalphLoopAgent | null = null;
  
  /** 模型配置缓存 */
  private modelConfigCache: Map<string, ModelConfigForExecution> = new Map();
  
  /** 累计 Token 使用量 */
  private cumulativeTokens: { input: number; output: number } = { input: 0, output: 0 };
  
  /** 每个节点的 Token 使用量（避免重复累加） */
  private nodeTokens: Record<number, { input: number; output: number }> = {};
  
  /** Token 更新待处理（debounce） */
  private tokenUpdatePending: Record<string, { input: number; output: number; modelName: string; modelConfigId: string }> = {};
  
  /** Token 更新定时器 */
  private tokenUpdateTimer: NodeJS.Timeout | null = null;
  
  /** Token 更新间隔（毫秒）- 前端轮询5秒，我们2秒更新一次即可 */
  private TOKEN_UPDATE_INTERVAL = 2000;
  
  /** 执行开始时间 */
  private startTime: Date = new Date();
  
  /** 节点流存储（一个 SSE 流对应一个文件） */
  private nodeStreamStore: NodeStreamStore;
  
  /** 当前活跃的 agentId（用于子Agent流） */
  private activeAgentId: string | null = null;
  
  /** 当前节点的 SkillExecution IDs（用于追踪执行完成） */
  private currentSkillExecutionIds: string[] = [];
  
  /** 当前节点的 Skill IDs */
  private currentSkillIds: string[] = [];

  constructor(config: UnifiedExecutionConfig, callbacks: UnifiedExecutionCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    
    // 初始化节点流存储
    this.nodeStreamStore = new NodeStreamStore({
      evaluationSessionId: config.evaluationSessionId,
      projectId: config.projectId,
    });
  }

  /**
   * 设置节点列表
   * @param nodes 节点定义数组（已排序）
   */
setNodes(nodes: UnifiedNodeDefinition[]): void {
      // 过滤节点：如果 start/end 节点没有配置描述，标记为跳过（但仍保留在列表中以计入进度）
      const processedNodes = nodes.map(node => {
        const nodeType = node.type || 'task';
        
        // start 节点：如果没有 startNodeDescription 则跳过
        if (nodeType === 'start') {
          const hasDescription = this.config.workflowConfig?.startNodeDescription || node.description;
          if (!hasDescription) {
            console.log(`[UnifiedEngine] 标记跳过 start 节点: ${node.label} (未配置 startNodeDescription)`);
            return { ...node, skip: true, skipReason: '未配置开始节点描述' };
          }
        }
        
        // end 节点：如果没有 endNodeDescription 则跳过
        if (nodeType === 'end') {
          const hasDescription = this.config.workflowConfig?.endNodeDescription || node.description;
          if (!hasDescription) {
            console.log(`[UnifiedEngine] 标记跳过 end 节点: ${node.label} (未配置 endNodeDescription)`);
            return { ...node, skip: true, skipReason: '未配置结束节点描述' };
          }
        }
        
        return { ...node, skip: false };
      });
      
      this.nodes = processedNodes;
      const skippedCount = processedNodes.filter(n => n.skip).length;
      console.log(`[UnifiedEngine] 设置节点列表: ${processedNodes.length} 个节点 (${skippedCount} 个将跳过)`);
      for (const node of processedNodes) {
        if (node.skip && 'skipReason' in node) {
          console.log(`[UnifiedEngine] - Node ${node.id}: ${node.label} (跳过: ${node.skipReason})`);
        } else {
          console.log(`[UnifiedEngine] - Node ${node.id}: ${node.label} (type: ${node.type || 'task'}, roleId: ${node.roleId || 'default'})`);
        }
      }
    }

  /**
   * 中止执行
   */
  abort(): void {
    console.log('[UnifiedEngine] 收到中止请求，设置中止标志');
    this.aborted = true;
    if (this.currentAgent) {
      this.currentAgent.abort();
    }
  }

  /**
   * 检查是否已中止
   */
  isAborted(): boolean {
    return this.aborted;
  }

  /**
   * 主执行流程
   */
  async execute(): Promise<WorkflowExecutionResult> {
    this.startTime = new Date();
    console.log(`[UnifiedEngine] 开始执行工作流: ${this.config.workflowId}`);
    console.log(`[UnifiedEngine] 项目: ${this.config.projectName}`);
    console.log(`[UnifiedEngine] 节点数量: ${this.nodes.length}`);
    
    // 1. 更新数据库状态为 'running'
    await this.updateSessionStatus('running', '工作流开始执行');

    const nodeResults: NodeExecutionResult[] = [];

    try {
      // 2. 串行执行所有节点
      for (let i = 0; i < this.nodes.length; i++) {
        if (this.aborted) {
          console.log('[UnifiedEngine] 检测到中止信号，停止执行');
          break;
        }

        const node = this.nodes[i];
        
        // 检查节点是否需要跳过
        if (node.skip) {
          console.log(`[UnifiedEngine] ========== 跳过节点 ${i + 1}/${this.nodes.length}: ${node.label} ==========`);
          console.log(`[UnifiedEngine] 跳过原因: ${node.skipReason}`);
          
          // 为跳过的节点创建执行记录（status=completed, skipped=true）
          await this.saveSkippedNodeExecution(i, node);
          
          // 创建结果记录
          const skippedResult: NodeExecutionResult = {
            nodeIndex: i,
            nodeId: node.id,
            nodeName: node.label,
            status: 'completed',
            iterations: 0,
            retryCount: 0,
            duration: 0,
            inputTokens: 0,
            outputTokens: 0,
            modelName: '',
            modelConfigId: '',
          };
          nodeResults.push(skippedResult);
          
          // 调用节点完成回调
          await this.callbacks.onNodeComplete(i, skippedResult);
          
          continue; // 跳过此节点
        }
        
        console.log(`[UnifiedEngine] ========== 开始执行节点 ${i + 1}/${this.nodes.length}: ${node.label} ==========`);
        
        const result = await this.executeNode(i, node);
        nodeResults.push(result);

        // 3. 节点失败时停止
        if (result.status === 'failed') {
          console.log(`[UnifiedEngine] 节点 ${node.label} 执行失败，停止工作流`);
          break;
        }

        // 注意：不再在这里累加 Token，因为 onUsage 回调已经实时更新了 cumulativeTokens
        // 避免重复累加（onUsage 使用 nodeTokens 对象正确处理累计）
        console.log(`[UnifiedEngine] 节点完成后累计 Token: input=${this.cumulativeTokens.input}, output=${this.cumulativeTokens.output}`);
      }

      // 4. 生成最终结果
      const status = this.determineStatus(nodeResults);
      const endReason = this.determineEndReason(status);
      const endMessage = this.generateEndMessage(status, nodeResults);

      const workflowResult: WorkflowExecutionResult = {
        sessionId: this.config.evaluationSessionId,
        projectId: this.config.projectId,
        projectName: this.config.projectName,
        workflowId: this.config.workflowId,
        workflowType: this.config.workflowType,
        status,
        nodeResults,
        totalDuration: Date.now() - this.startTime.getTime(),
        totalInputTokens: this.cumulativeTokens.input,
        totalOutputTokens: this.cumulativeTokens.output,
        startReason: '工作流开始执行',
        endReason,
        endMessage,
        startedAt: this.startTime,
        completedAt: new Date(),
      };

      // 5. 更新数据库状态
      await this.updateSessionStatus(status, endReason, workflowResult);

      // 6. 调用完成回调（漏洞入库由调用方在项目结束时处理）
      await this.callbacks.onWorkflowComplete(workflowResult);

      console.log(`[UnifiedEngine] 工作流执行完成: ${status}`);
      console.log(`[UnifiedEngine] 总耗时: ${workflowResult.totalDuration}ms`);
      console.log(`[UnifiedEngine] 总 Token: input=${workflowResult.totalInputTokens}, output=${workflowResult.totalOutputTokens}`);

      return workflowResult;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[UnifiedEngine] 工作流执行异常:', err.message);
      console.error('[UnifiedEngine] 错误堆栈:', err.stack);

      // 更新数据库状态为失败
      await this.updateSessionStatus('failed', '执行异常', {
        error: err.message,
        errorStack: err.stack || '',
      });

      // 调用错误回调
      this.callbacks.onWorkflowError(err);

      return {
        sessionId: this.config.evaluationSessionId,
        projectId: this.config.projectId,
        projectName: this.config.projectName,
        workflowId: this.config.workflowId,
        workflowType: this.config.workflowType,
        status: 'failed',
        nodeResults,
        totalDuration: Date.now() - this.startTime.getTime(),
        totalInputTokens: this.cumulativeTokens.input,
        totalOutputTokens: this.cumulativeTokens.output,
        startReason: '工作流开始执行',
        endReason: '执行异常',
        endMessage: err.message,
        startedAt: this.startTime,
        completedAt: new Date(),
        error: err.message,
        errorStack: err.stack || '',
      };
    }
  }

  /**
   * 执行单个节点
   * 
   * 实现重试机制：
   * - 最大重试次数: 15
   * - 重试间隔: 60000ms (1分钟)
   * - 每次重试调用 onNodeRetry 回调
   * - 达到最大重试次数后标记为失败
   */
  private async executeNode(
    nodeIndex: number,
    node: UnifiedNodeDefinition
  ): Promise<NodeExecutionResult> {
    const nodeStartTime = Date.now();
    const nodeName = node.label;
    const nodeId = node.id;

    console.log(`[executeNode] 开始执行节点: ${nodeName}`);
    console.log(`[executeNode] nodeId: ${nodeId}`);
    console.log(`[executeNode] roleId: ${node.roleId || 'default'}`);
    console.log(`[executeNode] skillPath: ${node.skillPath || 'none'}`);
    console.log(`[executeNode] node.skills: ${JSON.stringify(node.skills)}`);
    console.log(`[executeNode] node.vulnerabilityCategories: ${JSON.stringify(node.vulnerabilityCategories)}`);

    // 调用节点开始回调
    await this.callbacks.onNodeStart(nodeIndex, nodeId, nodeName);

    // 初始化节点目录（创建 node-{nodeId}/ 和 agents/ 目录）
    await this.nodeStreamStore.initNodeDir(nodeId);
    console.log(`[executeNode] 初始化节点目录: node-${nodeId}`);

    // 获取模型配置
    const modelConfig = await this.getModelConfigForRole(node.roleId ?? undefined);
    console.log(`[executeNode] 使用模型: ${modelConfig.name} (${modelConfig.providerType})`);

    // 创建节点执行记录（status='running'）- 让 token 更新能找到记录
    await this.createNodeExecutionRecord(node, nodeIndex, modelConfig);
    
    // 为节点的 skills 创建 SkillExecution 记录
    if (node.skills && node.skills.length > 0) {
      await this.createSkillExecutions(node, nodeIndex);
    }

    // 重试机制
    const maxRetries = this.config.maxRetries;
    const retryDelayMs = this.config.retryDelayMs;
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= maxRetries) {
      if (this.aborted) {
        console.log(`[executeNode] 检测到中止信号，停止节点执行`);
        return {
          nodeIndex,
          nodeId,
          nodeName,
          status: 'failed',
          iterations: 0,
          retryCount,
          duration: Date.now() - nodeStartTime,
          inputTokens: 0,
          outputTokens: 0,
          modelName: modelConfig.name,
          modelConfigId: modelConfig.id,
          error: '用户中止',
          errorStack: '',
        };
      }

      try {
        // 创建 RalphLoopAgent (async - 需要 await)
        const agent = await this.createNodeAgent(nodeIndex, modelConfig, node);
        this.currentAgent = agent;

        // 构建节点提示词
        const prompt = await this.buildNodePrompt(nodeIndex, node);

        // 保存用户消息（提示词）到 stream.jsonl
        this.nodeStreamStore.appendToStream(nodeId, {
          event: 'user',
          data: { text: prompt },
        }).catch(err => console.error('[executeNode] 保存用户消息失败:', err));

        // 累积助手响应文本（用于最终保存）
        let accumulatedAssistantText = '';

        // 执行节点
        const result = await agent.loop({
          evaluationId: this.config.evaluationSessionId,  // 使用真实的 evaluationSessionId
          projectId: this.config.projectId,
          workflowNodeId: node.id,  // 传递 workflowNodeId
          context: {
            projectName: this.config.projectName,
            taskDescription: prompt,
            initialMessage: prompt,
            files: [],
          },
callbacks: {
            onChunk: (text) => {
              // 累积助手响应文本
              accumulatedAssistantText += text;
              
              // 写入 stream.jsonl
              this.nodeStreamStore.appendToStream(nodeId, {
                event: 'text',
                data: { text, cumulativeLength: accumulatedAssistantText.length },
              }).catch(err => console.error('[executeNode] 保存文本失败:', err));
              
              // 调用外部回调
              this.callbacks.onNodeChunk(nodeIndex, text);
            },
            onThinking: (thinking) => {
              // 写入 stream.jsonl
              this.nodeStreamStore.appendToStream(nodeId, {
                event: 'thinking',
                data: { text: thinking },
              }).catch(err => console.error('[executeNode] 保存思考失败:', err));
            },
            onToolCall: (toolUseId, name, args) => {
              // 子Agent交互日志
              if (name === 'Agent' || name === 'task') {
                console.log('\n' + '='.repeat(80));
                console.log('[子Agent交互] 工具调用:', name, toolUseId);
                console.log('[子Agent交互] 参数:', JSON.stringify(args, null, 2));
                console.log('='.repeat(80) + '\n');
              }
              
              // 写入 stream.jsonl
              this.nodeStreamStore.appendToStream(nodeId, {
                event: 'tool_use',
                data: { toolUseId, name, args },
              }).catch(err => console.error('[executeNode] 保存工具调用失败:', err));
              
              // 调用外部回调
              this.callbacks.onNodeToolCall(nodeIndex, name, args);
            },
            onToolResult: (toolUseId, content, isError) => {
              // 子Agent交互日志
              console.log('\n' + '='.repeat(80));
              console.log('[子Agent交互] 工具结果:', toolUseId, 'isError:', isError);
              const resultContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
              console.log(resultContent);
              console.log('='.repeat(80) + '\n');
              
              // 检查是否是 async_launched（子Agent启动）
              const resultData = typeof content === 'string' ? (() => { try { return JSON.parse(content); } catch { return {}; } })() : content;
              if (resultData?.isAsync || resultData?.status === 'async_launched') {
                const agentId = resultData?.agentId;
                if (agentId) {
                  this.activeAgentId = agentId;
                  console.log(`[executeNode] 子Agent启动: agentId=${agentId}`);
                  
                  // 写入 stream.jsonl（标记子Agent启动）
                  this.nodeStreamStore.appendToStream(nodeId, {
                    event: 'agent_launched',
                    data: { toolUseId, agentId, description: resultData?.description },
                  }).catch(err => console.error('[executeNode] 保存 agent_launched 失败:', err));
                }
              }
              
              // 写入 stream.jsonl
              this.nodeStreamStore.appendToStream(nodeId, {
                event: 'tool_result',
                data: { toolUseId, content: resultData, isError },
              }).catch(err => console.error('[executeNode] 保存工具结果失败:', err));
            },
            onComplete: () => {
              // 写入 message_stop 到 stream.jsonl
              this.nodeStreamStore.appendToStream(nodeId, {
                event: 'message_stop',
                data: { text: accumulatedAssistantText },
              }).catch(err => console.error('[executeNode] 保存 message_stop 失败:', err));
            },
            onError: (error) => {
              console.error(`[executeNode] Agent 错误: ${error.message}`);
              // 写入 error 到 stream.jsonl
              this.nodeStreamStore.appendToStream(nodeId, {
                event: 'error',
                data: { message: error.message, stack: error.stack },
              }).catch(err => console.error('[executeNode] 保存 error 失败:', err));
            },
            onUsage: (usage) => {
              // SDK 返回的是当前节点的累计值
              this.nodeTokens[nodeIndex] = {
                input: usage.inputTokens || 0,
                output: usage.outputTokens || 0,
              };
              
              // 计算所有节点的总累计值
              this.cumulativeTokens.input = Object.values(this.nodeTokens)
                .reduce((sum: number, t: any) => sum + (t.input || 0), 0);
              this.cumulativeTokens.output = Object.values(this.nodeTokens)
                .reduce((sum: number, t: any) => sum + (t.output || 0), 0);
              
              // 实时更新 NodeExecution 表的 Token
              this.updateNodeExecutionTokensDebounced(nodeId, usage.inputTokens || 0, usage.outputTokens || 0, modelConfig);
              
              // 写入 token_usage 到 stream.jsonl
              this.nodeStreamStore.appendToStream(nodeId, {
                event: 'token_usage',
                data: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
              }).catch(err => console.error('[executeNode] 保存 token_usage 失败:', err));
              
              // 实时推送 Token 使用量
              this.callbacks.onTokenUsage({
                nodeIndex,
                nodeId,
                nodeName,
                modelName: modelConfig.name,
                modelConfigId: modelConfig.id,
                inputTokens: usage.inputTokens || 0,
                outputTokens: usage.outputTokens || 0,
                totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
                cumulativeInputTokens: this.cumulativeTokens.input,
                cumulativeOutputTokens: this.cumulativeTokens.output,
                cumulativeTotalTokens: this.cumulativeTokens.input + this.cumulativeTokens.output,
              });
            },
            onRalphComplete: async () => {},
          },
        });

        this.currentAgent = null;

        // 检查执行结果
        if (result.completionReason === 'aborted') {
          console.log(`[executeNode] 节点被中止`);
          return {
            nodeIndex,
            nodeId,
            nodeName,
            status: 'failed',
            iterations: result.iterations,
            retryCount,
            duration: Date.now() - nodeStartTime,
            inputTokens: result.totalUsage.inputTokens,
            outputTokens: result.totalUsage.outputTokens,
            modelName: modelConfig.name,
            modelConfigId: modelConfig.id,
            error: '用户中止',
            errorStack: '',
          };
        }

        // 成功完成
        if (result.completionReason === 'verified' || result.text.length > 100) {
          console.log(`[executeNode] 节点执行成功: iterations=${result.iterations}`);

          // 确保 Token 数据正确（使用 result.totalUsage 作为最终值）
          // 如果 onUsage 回调没有被正确调用，使用 result.totalUsage 作为备份
          if (result.totalUsage && result.totalUsage.inputTokens > 0) {
            console.log(`[executeNode] 使用 result.totalUsage 更新 nodeTokens: input=${result.totalUsage.inputTokens}, output=${result.totalUsage.outputTokens}`);
            this.nodeTokens[nodeIndex] = {
              input: result.totalUsage.inputTokens,
              output: result.totalUsage.outputTokens,
            };
            // 重新计算所有节点的总累计值
            this.cumulativeTokens.input = Object.values(this.nodeTokens)
              .reduce((sum: number, t: any) => sum + (t.input || 0), 0);
            this.cumulativeTokens.output = Object.values(this.nodeTokens)
              .reduce((sum: number, t: any) => sum + (t.output || 0), 0);
          }

          // 写入 YAML 输出
          const outputYamlPath = await this.writeNodeOutput(nodeIndex, node, result.text);

          const nodeResult: NodeExecutionResult = {
            nodeIndex,
            nodeId,
            nodeName,
            status: 'completed',
            outputYamlPath,
            iterations: result.iterations,
            retryCount,
            duration: Date.now() - nodeStartTime,
            inputTokens: result.totalUsage.inputTokens,
            outputTokens: result.totalUsage.outputTokens,
            modelName: modelConfig.name,
            modelConfigId: modelConfig.id,
          };

          // 调用节点完成回调
          await this.callbacks.onNodeComplete(nodeIndex, nodeResult);

          // 保存节点执行记录到数据库
          await this.saveNodeExecutionToDB(nodeIndex, node, nodeResult, modelConfig);
          
          // 完成 SkillExecution 记录（统计漏洞数量）
          await this.completeSkillExecutions(nodeIndex);

          return nodeResult;
        }

        // 未验证成功，需要重试
        console.log(`[executeNode] 节点未验证成功，准备重试`);
        lastError = new Error(`节点执行未完成验证: ${result.reason || '未知原因'}`);

      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(`[executeNode] 节点执行异常: ${err.message}`);
        console.error(`[executeNode] 错误堆栈: ${err.stack}`);
        lastError = err;
        this.currentAgent = null;
      }

      // 重试逻辑
      retryCount++;
      if (retryCount <= maxRetries) {
        console.log(`[executeNode] 准备重试 (${retryCount}/${maxRetries})，等待 ${retryDelayMs}ms`);
        
        // 调用重试回调
        if (lastError) {
          this.callbacks.onNodeRetry(nodeIndex, nodeId, nodeName, retryCount, maxRetries, lastError);
        }

        // 等待重试间隔
        await this.sleep(retryDelayMs);
      }
    }

    // 达到最大重试次数，标记为失败
    console.log(`[executeNode] 达到最大重试次数 ${maxRetries}，节点失败`);

    const failedResult: NodeExecutionResult = {
      nodeIndex,
      nodeId,
      nodeName,
      status: 'failed',
      iterations: 0,
      retryCount: retryCount - 1,
      duration: Date.now() - nodeStartTime,
      inputTokens: 0,
      outputTokens: 0,
      modelName: modelConfig.name,
      modelConfigId: modelConfig.id,
      error: lastError?.message || '达到最大重试次数',
      errorStack: lastError?.stack || '',
    };

    // 完成 SkillExecution 记录（标记失败）
    await this.failSkillExecutions(lastError?.message || '节点执行失败');

    // 调用节点错误回调
    if (lastError) {
      this.callbacks.onNodeError(nodeIndex, nodeId, nodeName, lastError);
    }

    return failedResult;
  }

  /**
   * 根据 roleId 获取模型配置
   * 
   * - 从 roleModels 查找对应模型
   * - 从数据库加载 ModelConfig
   * - 使用缓存避免重复查询
   */
  private async getModelConfigForRole(roleId?: string): Promise<ModelConfigForExecution> {
    // 如果没有 roleModels 配置，使用默认模型
    if (!this.config.roleModels || this.config.roleModels.length === 0) {
      console.log(`[getModelConfigForRole] No roleModels config, using default model`);
      return this.config.defaultModelConfig;
    }

    // 查找角色对应的模型ID
    // 如果 roleId 为空，查找 "default" 角色
    const targetRoleId = roleId || 'default';
    const roleModel = this.config.roleModels.find(rm => rm.roleId === targetRoleId);

    if (!roleModel) {
      console.log(`[getModelConfigForRole] No model found for role ${targetRoleId}, using default model`);
      return this.config.defaultModelConfig;
    }

    const modelId = roleModel.modelId;
    console.log(`[getModelConfigForRole] Role ${targetRoleId} -> Model ${modelId}`);

    // 检查缓存
    if (this.modelConfigCache.has(modelId)) {
      console.log(`[getModelConfigForRole] Using cached model config for ${modelId}`);
      return this.modelConfigCache.get(modelId)!;
    }

    // 从数据库加载模型配置
    try {
      const modelConfig = await prisma.modelConfig.findUnique({
        where: { id: modelId },
      });

      if (!modelConfig) {
        console.warn(`[getModelConfigForRole] Model ${modelId} not found, using default model`);
        return this.config.defaultModelConfig;
      }

      // 构建模型配置
      const config: ModelConfigForExecution = {
        id: modelConfig.id,
        name: modelConfig.name,
        providerType: modelConfig.providerType,
        apiKey: modelConfig.apiKey,
        apiBaseUrl: modelConfig.apiBaseUrl || '',
        models: modelConfig.models,
      };

      // 缓存
      this.modelConfigCache.set(modelId, config);
      console.log(`[getModelConfigForRole] Loaded model config: ${modelConfig.name} (${modelConfig.providerType})`);

      return config;
    } catch (error) {
      console.error(`[getModelConfigForRole] Failed to load model ${modelId}:`, error);
      return this.config.defaultModelConfig;
    }
  }

/**
 * 创建节点 Agent
   * 
   * 动态查询节点配置的 Skills，使用 SDK 的 skills 参数注册
   * 传递 MCP 服务器配置给 Claude Agent SDK
   * 
   * 重要：子 Agent（通过 Agent 工具创建）需要通过 agents 配置来继承 MCP 和 Skills
   * 根据 SDK 官方文档，子 Agent 不会自动继承父 Agent 的 MCP 和 Skills
   */
  private async createNodeAgent(
    nodeIndex: number,
    modelConfig: ModelConfigForExecution,
    node: UnifiedNodeDefinition
  ): Promise<RalphLoopAgent> {
    console.log(`[createNodeAgent] Creating agent for node ${nodeIndex}: ${node.label}`);
    console.log(`[createNodeAgent] Model: ${modelConfig.name}`);
    console.log(`[createNodeAgent] WorkflowNodeId: ${node.id}`);

    // 动态查询节点配置的 Skills
    const skills = await this.getNodeSkills(node);
    
    // 基础工具权限（包含 Skill 工具）
    const allowedTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash', 'Skill'];
    
    // Skills 注册：使用 SDK 的 skills 参数（直接传 skill name）
    const skillNames = skills.map(s => s.name);
    
    // MCP 配置：从 config 获取并传递给 SDK
    const mcpServers = this.config.mcpServers;
    
    // 构建子 Agent 定义（让 Agent 工具创建的子 Agent 继承所有父 Agent 配置）
    // 这是 SDK 官方推荐的传递 MCP/Skills 给子 Agent 的方式
    // 子 Agent 应该总是继承：allowedTools、mcpServers、skills
    const agents: Record<string, any> = {};
    
    // 获取 MCP 服务器名称列表（用于子 Agent 引用）
    const mcpServerNames = mcpServers ? mcpServers.map(m => m.name) : [];
    
    // 创建一个通用的子 Agent 配置，继承父 Agent 的所有配置
    // Agent 工具会根据任务类型选择合适的子 Agent
    agents['general-purpose'] = {
      description: '通用子Agent，继承父Agent的allowedTools、MCP和Skills',
      prompt: 'You are a helpful assistant. Follow the instructions and use available tools.',
      tools: allowedTools,  // 继承父 Agent 的 allowedTools
      mcpServers: mcpServerNames.length > 0 ? mcpServerNames : undefined,  // 子 Agent 引用父 Agent 已定义的 MCP 服务器（按名称），无配置则不传递
      skills: skillNames.length > 0 ? skillNames : undefined,  // 子 Agent 继承 Skills，无配置则不传递
      model: 'inherit',  // 使用父 Agent 的模型
    };
    
    console.log(`[createNodeAgent] 配置子Agent 'general-purpose' 继承:`);
    console.log(`  - allowedTools: ${allowedTools.join(', ')}`);
    if (mcpServerNames.length > 0) {
      console.log(`  - MCP Servers: ${mcpServerNames.join(', ')}`);
    } else {
      console.log(`  - MCP Servers: 无（父Agent未配置）`);
    }
    if (skillNames.length > 0) {
      console.log(`  - Skills: ${skillNames.join(', ')}`);
    } else {
      console.log(`  - Skills: 无（父Agent未配置）`);
    }
    
    console.log(`[createNodeAgent] allowedTools: ${allowedTools.join(', ')}`);
    if (skillNames.length > 0) {
      console.log(`[createNodeAgent] 注册 Skills: ${skillNames.join(', ')}`);
    }
    if (mcpServers && mcpServers.length > 0) {
      console.log(`[createNodeAgent] MCP 服务器: ${mcpServers.map(m => m.name).join(', ')}`);
    }

    return createRalphLoopAgent(
      {
        providerType: modelConfig.providerType,
        apiKey: modelConfig.apiKey,
        apiBaseUrl: modelConfig.apiBaseUrl || '',
        models: typeof modelConfig.models === 'string' ? modelConfig.models : JSON.stringify(modelConfig.models),
      },
      this.config.workspacePath,
      {
        maxIterations: this.config.maxIterationsPerNode,
        // 不设置 verifyCompletion，让 Agent 自主完成
      },
      {
        systemPrompt: this.config.systemPrompt,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        workflowNodeId: node.id,  // 传递 workflowNodeId，用于保存 session_id
        allowedTools,  // 父 Agent 工具权限
        skills: skillNames.length > 0 ? skillNames : undefined,  // 父 Agent 注册 Skills
        mcpServers,  // 父 Agent MCP 服务器配置
        agents,  // 子 Agent 定义（总是传递，让子 Agent 继承所有父配置）
      }
    );
  }

/**
    * 获取节点配置的 Skills
    * 
    * 根据节点配置动态查询匹配的 Skills
    * 
    * 判断规则（优先级）：
    * 1. 如果 node.skills 有值 -> manual 模式，从 skill ID 数组查询
    * 2. 如果 node.vulnerabilityCategories 有值 -> vulnerability 模式，从漏洞分类匹配（考虑技术栈）
    * 3. 否则 -> description 模式，不需要 Skills
    */
  private async getNodeSkills(node: UnifiedNodeDefinition): Promise<Array<{ name: string; displayName: string }>> {
    console.log(`[getNodeSkills] 节点: ${node.label}`);
    console.log(`[getNodeSkills] node.skills: ${JSON.stringify(node.skills)}`);
    console.log(`[getNodeSkills] node.vulnerabilityCategories: ${JSON.stringify(node.vulnerabilityCategories)}`);
    
    // 优先级 1: manual 模式 - node.skills 有 skill ID 数组
    if (node.skills && node.skills.length > 0) {
      const skillIds = node.skills;
      
      console.log(`[getNodeSkills] manual 模式 (node.skills), skillIds: ${skillIds.join(', ')}`);
      
      // 从数据库查询 Skill 详情
      try {
        const skills = await prisma.skill.findMany({
          where: {
            id: { in: skillIds },
            isActive: true,
          },
          select: {
            name: true,
            displayName: true,
          },
        });
        
        console.log(`[getNodeSkills] 查询到 ${skills.length} 个 Skills`);
        return skills;
      } catch (error) {
        console.error(`[getNodeSkills] 查询失败:`, error);
        return [];
      }
    }

    // 优先级 2: vulnerability 模式 - node.vulnerabilityCategories 有漏洞分类数组
    if (node.vulnerabilityCategories && node.vulnerabilityCategories.length > 0) {
      const categories = node.vulnerabilityCategories;
      
      console.log(`[getNodeSkills] vulnerability 模式 (node.vulnerabilityCategories), categories: ${categories.join(', ')}`);
      
      // 从数据库查询匹配漏洞分类的 Skills
      // 步骤1: 先找到这些分类对应的 VulnerabilityPattern IDs
      // 步骤2: 再查询 Skills 匹配这些 vulnerabilityPatternIds
      const techStackIds = this.config.techStackIds || [];
      
      try {
        // 查询 VulnerabilityPattern IDs（通过 VulnerabilityCategory.value 匹配）
        const vulnPatterns = await prisma.vulnerabilityPattern.findMany({
          where: {
            isActive: true,
            VulnerabilityCategory: {
              value: { in: categories },
            },
          },
          select: {
            id: true,
          },
        });
        
        const patternIds = vulnPatterns.map(p => p.id);
        console.log(`[getNodeSkills] 找到 ${patternIds.length} 个 VulnerabilityPattern IDs`);
        
        if (patternIds.length === 0) {
          console.log(`[getNodeSkills] 未找到匹配的 VulnerabilityPattern，返回空`);
          return [];
        }
        
        // 查询匹配这些 vulnerabilityPatternIds 的 Skills
        const whereClause: any = {
          isActive: true,
          vulnerabilityPatternId: { in: patternIds },
        };
        
        // 技术栈匹配：Skill 无技术栈(通用) 或匹配工作流技术栈
        if (techStackIds.length > 0) {
          whereClause.OR = [
            { techStackId: null },
            { techStackId: { in: techStackIds } },
          ];
        }
        
        const skills = await prisma.skill.findMany({
          where: whereClause,
          select: {
            name: true,
            displayName: true,
          },
        });
        
        console.log(`[getNodeSkills] 查询到 ${skills.length} 个匹配漏洞分类的 Skills`);
        return skills;
      } catch (error) {
        console.error(`[getNodeSkills] 查询失败:`, error);
        return [];
      }
    }

    // 优先级 3: description 模式 - 无 Skills 配置
    console.log(`[getNodeSkills] description 模式，节点 ${node.label} 无 Skills 配置`);
    return [];
  }

/**
    * 加载 FSM Phase Skill 内容
    * 从 skills/ 目录读取预设的 Phase 执行指令
    * 
    * 注意：skillPath 可能是相对路径（如 phases/P1-xxx.md）
    * 需要根据 FSM Template 的 skillPath 拼接完整路径
    */
  private async loadFSMPhaseSkillContent(node: UnifiedNodeDefinition): Promise<string> {
    // 检查节点是否有 skillPath
    const nodeSkillPath = node.skillPath;
    if (!nodeSkillPath) {
      throw new Error(`FSM Phase 节点 ${node.label} 缺少 skillPath 配置，无法执行。请检查 FSM Template 配置。`);
    }

    // 拼接完整 Skill 路径
    // FSM Template 的 skillPath: "skills/threat-modeling" -> 提取 "threat-modeling"
    // 节点的 skillPath: "phases/P1-PROJECT-UNDERSTANDING.md"
    // 完整路径: "threat-modeling/phases/P1-PROJECT-UNDERSTANDING.md"
    let fullSkillPath = nodeSkillPath;
    
    // 如果 skillPath 不包含 "/" 或以 "phases/" 开头，需要加上 FSM Template 前缀
    if (nodeSkillPath.startsWith('phases/') || !nodeSkillPath.includes('/')) {
      // 从 config.workflowId 获取 FSM Template 的 skillPath
      const fsmTemplateSkillPath = this.config.workflowConfig?.fsmTemplateSkillPath;
      if (fsmTemplateSkillPath) {
        // fsmTemplateSkillPath 格式: "skills/threat-modeling" -> 提取 "threat-modeling"
        const templatePrefix = fsmTemplateSkillPath.replace(/^skills\//, '').replace(/\/$/, '');
        fullSkillPath = `${templatePrefix}/${nodeSkillPath}`;
      } else {
        // 默认使用 threat-modeling（如果找不到 Template skillPath）
        fullSkillPath = `threat-modeling/${nodeSkillPath}`;
        console.warn(`[loadFSMPhaseSkillContent] 未找到 FSM Template skillPath，使用默认前缀 threat-modeling`);
      }
    }

    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // 完整物理路径: process.cwd()/skills/threat-modeling/phases/P1-xxx.md
      const fullPath = path.join(process.cwd(), 'skills', fullSkillPath);
      
      console.log(`[loadFSMPhaseSkillContent] Reading skill file: ${fullPath}`);
      console.log(`[loadFSMPhaseSkillContent] Node skillPath: ${nodeSkillPath}, Full skillPath: ${fullSkillPath}`);
      
      const content = await fs.readFile(fullPath, 'utf-8');
      console.log(`[loadFSMPhaseSkillContent] Loaded ${content.length} bytes from ${fullSkillPath}`);
      
      // 验证文件内容是否有效（至少包含 Phase 标题）
      if (!content.includes('# Phase') && !content.includes('## Objective')) {
        throw new Error(`Skill 文件 ${fullSkillPath} 内容无效，缺少必要的 Phase 定义。`);
      }
      
      return content;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`FSM Phase 节点 ${node.label} Skill 文件读取失败: ${fullSkillPath}。错误: ${errorMsg}。请检查 Skill 文件是否存在且路径正确。`);
    }
  }

  /**
    * FSM Phase 默认内容 - 已禁用
    * FSM 节点必须配置 skillPath，不再使用默认模板
    */
  private getFSMPhaseDefaultPrompt(phase: number): string {
    // 禁止使用默认模板，抛出错误
    throw new Error(`FSM Phase ${phase} 未配置 Skill 文件，无法执行。请为 FSM Template 的每个节点配置 skillPath。`);
  }

/**
    * 构建节点提示词
    * 根据节点类型使用不同的内容来源：
    * - start 节点：使用 workflowConfig.startNodeDescription
    * - end 节点：使用 workflowConfig.endNodeDescription
    * - fsm_phase 节点：优先读取 Skill 文件内容，否则使用默认内容
    * - 其他节点：使用 node.description 或 node.data 中的内容
    */
  private async buildNodePrompt(
    nodeIndex: number,
    node: UnifiedNodeDefinition
  ): Promise<string> {
    // 获取前序节点输出
    const previousOutputs = await this.getPreviousOutputs(nodeIndex);

    // 根据节点类型获取节点描述内容
    let nodeDescription: string;
    const nodeType = node.type || 'task';

    if (nodeType === 'start') {
      // 开始节点：使用 workflowConfig.startNodeDescription
      nodeDescription = this.config.workflowConfig?.startNodeDescription || 
        node.description || 
        '开始工作流执行，准备项目环境';
    } else if (nodeType === 'end') {
      // 结束节点：使用 workflowConfig.endNodeDescription
      nodeDescription = this.config.workflowConfig?.endNodeDescription || 
        node.description || 
        '结束工作流执行，汇总所有结果';
    } else if (nodeType === 'fsm_phase' && node.fsmPhase) {
      // FSM Phase 节点：必须读取 Skill 文件内容
      // loadFSMPhaseSkillContent 会抛出错误如果文件不存在
      nodeDescription = await this.loadFSMPhaseSkillContent(node);
    } else {
      // 其他节点：使用 node.description 或 node.data
      nodeDescription = node.description || 
        (node.data?.description as string) || 
        (node.data?.taskDescription as string) || 
        '执行节点任务';
    }

    // FSM Phase：Skill 文件已经包含完整的执行指令，直接使用
    // Skill 文件内容格式: "# Phase 1: Project Understanding..."
    if (nodeType === 'fsm_phase') {
      // 构建 Skill 内容 + 项目上下文
      const prompt = `
${nodeDescription}

---

## 项目上下文

### 项目信息
- 项目名称: ${this.config.projectName}
- 项目路径: ${this.config.workspacePath}

### 前序节点输出
${previousOutputs || '(首个节点，无前序输出)'}

### 输出路径
- 输出目录: outputs/phases/${nodeIndex + 1}-${node.label}/
- 输出文件: output.yaml

${this.config.userPrompt ? `### 用户附加提示\n${this.config.userPrompt}` : ''}
`;
      return prompt;
    }

    // start/end 节点：不需要 Skills 提示词，直接返回简单提示词
    if (nodeType === 'start' || nodeType === 'end') {
      const prompt = `
# 工作流节点执行: ${node.label}

## 项目信息
- 项目名称: ${this.config.projectName}
- 项目路径: ${this.config.workspacePath}

## 当前节点
- 节点名称: ${node.label}
- 节点类型: ${nodeType}
- 节点描述: ${nodeDescription}

## 前序节点输出
${previousOutputs}

## 任务要求
${nodeDescription}

${this.config.userPrompt ? `## 用户附加提示\n${this.config.userPrompt}` : ''}
`;
      return prompt;
    }

    // task / subtask / agent-zone 节点
    // 根据模式生成提示词：
    // - description 模式：直接用用户写的节点描述
    // - manual/vulnerability 模式：根据 Skills 生成提示词
    
    // 获取节点配置的 Skills
    const skills = await this.getNodeSkills(node);
    
    // 获取节点模式（从 node.data 中读取）
    const nodeData = node.data as Record<string, unknown> | undefined;
    const mode = (nodeData?.skillLoadingMode as string) || 'description';
    
    let prompt = '';
    
    if (mode === 'description' || skills.length === 0) {
      // description 模式或无 Skills：直接用用户写的描述
      prompt = `${nodeDescription}`;
      console.log(`[buildNodePrompt] description 模式，提示词: ${prompt.slice(0, 100)}...`);
    } else {
      // manual 或 vulnerability 模式：根据 Skills 生成提示词
      prompt = `请执行以下安全检查任务，必须执行所有指定的 Skills：

必须执行的 Skills：
${skills.map((s, i) => `${i + 1}. ${s.displayName}`).join('\n')}

请确保以上所有 Skills 都被执行，且每个skill以独立子代理（Subagent）执行，不要遗漏。`;
      console.log(`[buildNodePrompt] ${mode} 模式，生成 Skills 提示词，共 ${skills.length} 个 Skills`);
    }

    return prompt;
  }

  /**
   * 获取前序节点输出
   */
  private async getPreviousOutputs(currentNodeIndex: number): Promise<string> {
    const outputs: string[] = [];

    for (let i = 0; i < currentNodeIndex; i++) {
      const node = this.nodes[i];
      // 尝试读取前序节点的 YAML 输出 - 使用 outputs/ 替代 .claude/
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const outputPath = path.join(
          this.config.workspacePath,
          'outputs',
          'phases',
          `${i + 1}-${node.label}`,
          'output.yaml'
        );
        const content = await fs.readFile(outputPath, 'utf-8');
        outputs.push(`### ${node.label} (Node ${i + 1})\n${content}`);
      } catch {
        outputs.push(`### ${node.label} (Node ${i + 1})\n(输出文件未找到)`);
      }
    }

    return outputs.length > 0 ? outputs.join('\n\n') : '(无前序节点输出)';
  }

  /**
   * 写入节点 YAML 输出
   */
  private async writeNodeOutput(
    nodeIndex: number,
    node: UnifiedNodeDefinition,
    content: string
  ): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');

    // 提取 YAML 内容
    const yamlContent = this.extractYamlFromResult(content);

    // 创建输出目录 - 使用 outputs/ 替代 .claude/
    const phaseDir = path.join(
      this.config.workspacePath,
      'outputs',
      'phases',
      `${nodeIndex + 1}-${node.label}`
    );
    await fs.mkdir(phaseDir, { recursive: true });

    // 写入 YAML 文件
    const outputPath = path.join(phaseDir, 'output.yaml');
    await fs.writeFile(outputPath, yamlContent, 'utf-8');

    console.log(`[writeNodeOutput] 写入 YAML 输出: ${outputPath}`);
    return outputPath;
  }

  /**
   * 从结果中提取 YAML
   */
  private extractYamlFromResult(text: string): string {
    // 尝试多种 YAML 提取模式
    const patterns = [
      /```yaml\n([\s\S]*?)\n```/,
      /```yml\n([\s\S]*?)\n```/,
      /---\n([\s\S]*?)\n---/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // 如果没有找到 YAML 块，尝试直接提取结构化内容
    const yamlStart = text.search(/^[a-z_]+:/m);
    if (yamlStart >= 0) {
      return text.slice(yamlStart).trim();
    }

    // 返回原始文本（截取前 2000 字符）
    return text.substring(0, 2000);
  }

  /**
   * 保存节点执行记录到数据库
   * 
   * FSM 模式：workflowNodeId 使用 FSM phase 标识（如 "P1", "P2"），不对应 WorkflowNode 表记录
   * DAG 模式：workflowNodeId 对应 WorkflowNode 表的真实 ID
   * 
   * 注意：NodeExecution 表没有对 WorkflowNode 的外键约束，只有唯一约束
   */
  private async saveNodeExecutionToDB(
    nodeIndex: number,
    node: UnifiedNodeDefinition,
    result: NodeExecutionResult,
    modelConfig: ModelConfigForExecution
  ): Promise<void> {
    try {
      // 检查是否已存在（避免唯一约束冲突）
      const existing = await prisma.nodeExecution.findUnique({
        where: {
          evaluationSessionId_workflowNodeId: {
            evaluationSessionId: this.config.evaluationSessionId,
            workflowNodeId: node.id,
          },
        },
        select: {
          id: true,
          startedAt: true,
          status: true,
        },
      });

      console.log(`[saveNodeExecutionToDB] 查询结果: ${node.label}, existing=${existing ? '存在' : '不存在'}, startedAt=${existing?.startedAt || 'null'}, status=${existing?.status || 'null'}`);

      const data = {
        evaluationSessionId: this.config.evaluationSessionId,
        workflowNodeId: node.id,
        nodeLabel: node.label,
        nodeType: node.fsmPhase ? 'fsm_phase' : (node.type || 'custom'),
        status: result.status,
        startedAt: new Date(this.startTime.getTime() + result.duration * nodeIndex),
        completedAt: new Date(),
        updatedAt: new Date(),
        order: nodeIndex,
        modelConfigId: modelConfig.id,
        modelName: modelConfig.name,
        roleId: node.roleId ?? undefined,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
      };

      if (existing) {
        // 更新现有记录
        // 确保 startedAt 被设置（如果之前未设置）
        const updateData: any = {
          status: result.status,
          completedAt: new Date(),
          updatedAt: new Date(),
          modelConfigId: modelConfig.id,
          modelName: modelConfig.name,
          inputTokens: result.inputTokens || 0,
          outputTokens: result.outputTokens || 0,
        };
        
        // 如果 startedAt 未设置，使用计算值（节点开始时间）
        if (!existing.startedAt) {
          updateData.startedAt = new Date(this.startTime.getTime() + result.duration * nodeIndex);
          console.log(`[saveNodeExecutionToDB] 补充设置 startedAt: ${node.label}`);
        }
        
        await prisma.nodeExecution.update({
          where: { id: existing.id },
          data: updateData,
        });
        console.log(`[saveNodeExecutionToDB] 更新节点执行记录: ${node.label}, startedAt=${existing.startedAt || '已补充'}, completedAt=已设置`);
      } else {
        // 创建新记录
        await prisma.nodeExecution.create({
          data: {
            id: `node-exec-${this.config.evaluationSessionId}-${nodeIndex}`,
            ...data,
          },
        });
        console.log(`[saveNodeExecutionToDB] 创建节点执行记录: ${node.label}, workflowType=${this.config.workflowType}`);
      }
    } catch (error) {
      console.error(`[saveNodeExecutionToDB] 保存失败:`, error);
      // 不抛出错误，允许执行继续进行
    }
  }

  /**
   * 保存跳过节点的执行记录到数据库
   * 
   * 跳过的节点：status='completed', skipped=true, skipReason记录原因
   */
  private async saveSkippedNodeExecution(
    nodeIndex: number,
    node: UnifiedNodeDefinition & { skipReason?: string }
  ): Promise<void> {
    try {
      // 检查是否已存在（避免唯一约束冲突）
      const existing = await prisma.nodeExecution.findUnique({
        where: {
          evaluationSessionId_workflowNodeId: {
            evaluationSessionId: this.config.evaluationSessionId,
            workflowNodeId: node.id,
          },
        },
      });

      const now = new Date();
      const data = {
        evaluationSessionId: this.config.evaluationSessionId,
        workflowNodeId: node.id,
        nodeLabel: node.label,
        nodeType: node.fsmPhase ? 'fsm_phase' : (node.type || 'custom'),
        status: 'completed',
        skipped: true,
        skipReason: node.skipReason || '未配置',
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        order: nodeIndex,
        modelConfigId: null,
        modelName: null,
        inputTokens: 0,
        outputTokens: 0,
      };

      if (existing) {
        // 更新现有记录
        await prisma.nodeExecution.update({
          where: { id: existing.id },
          data: {
            status: 'completed',
            skipped: true,
            skipReason: node.skipReason || '未配置',
            startedAt: now,
            completedAt: now,
            updatedAt: now,
          },
        });
        console.log(`[saveSkippedNodeExecution] 更新跳过节点记录: ${node.label}`);
      } else {
        // 创建新记录
        await prisma.nodeExecution.create({
          data: {
            id: `node-exec-${this.config.evaluationSessionId}-${nodeIndex}`,
            ...data,
          },
        });
        console.log(`[saveSkippedNodeExecution] 创建跳过节点记录: ${node.label}`);
      }
    } catch (error) {
      console.error(`[saveSkippedNodeExecution] 保存失败:`, error);
    }
  }

  /**
   * 为节点创建 SkillExecution 记录
   * 
   * 每个 skill 创建一条独立的执行记录，支持同一 skill 多次执行
   */
  private async createSkillExecutions(
    node: UnifiedNodeDefinition,
    nodeIndex: number
  ): Promise<void> {
    const skills = node.skills || [];
    this.currentSkillExecutionIds = [];
    this.currentSkillIds = [];
    
    for (const skillName of skills) {
      try {
        // 查找 Skill ID
        const skill = await prisma.skill.findFirst({
          where: { name: skillName, isLatest: true },
          select: { id: true, name: true, displayName: true },
        });
        
        if (!skill) {
          console.log(`[createSkillExecutions] Skill 未找到: ${skillName}`);
          continue;
        }
        
        // 创建 SkillExecution 记录
        const executionId = `sklexec-${this.config.evaluationSessionId}-${nodeIndex}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        await prisma.skillExecution.create({
          data: {
            id: executionId,
            skillId: skill.id,
            projectId: this.config.projectId,
            evaluationId: this.config.evaluationSessionId,
            input: JSON.stringify({ nodeName: node.label, nodeIndex }),
            status: 'running',
            startedAt: new Date(),
          },
        });
        
        // 更新 Skill 的 execCount
        await prisma.skill.update({
          where: { id: skill.id },
          data: { execCount: { increment: 1 }, updatedAt: new Date() },
        });
        
        this.currentSkillExecutionIds.push(executionId);
        this.currentSkillIds.push(skill.id);
        
        console.log(`[createSkillExecutions] Skill 执行记录已创建: ${skillName} (${skill.displayName}), executionId=${executionId}`);
      } catch (error) {
        console.error(`[createSkillExecutions] 创建 Skill 执行记录失败: ${skillName}`, error);
      }
    }
    
    console.log(`[createSkillExecutions] 共创建 ${this.currentSkillExecutionIds.length} 条 SkillExecution 记录`);
  }

  /**
   * 完成 SkillExecution 记录
   * 
   * 统计该节点发现的漏洞数量，更新 findingsCount
   */
  private async completeSkillExecutions(nodeIndex: number): Promise<void> {
    if (this.currentSkillExecutionIds.length === 0) {
      return;
    }
    
    const completedAt = new Date();
    
    // 统计本次评估中该节点发现的漏洞数量
    let totalFindings = 0;
    try {
      // 从 Vulnerability 表统计（按 evaluationId）
      totalFindings = await prisma.vulnerability.count({
        where: { evaluationId: this.config.evaluationSessionId },
      });
    } catch (error) {
      console.error(`[completeSkillExecutions] 统计漏洞数量失败:`, error);
    }
    
    // 平均分配到每个 Skill（简化处理）
    const findingsPerSkill = Math.ceil(totalFindings / this.currentSkillIds.length) || 0;
    
    for (let i = 0; i < this.currentSkillExecutionIds.length; i++) {
      const executionId = this.currentSkillExecutionIds[i];
      const skillId = this.currentSkillIds[i];
      
      try {
        // 获取 startedAt 计算 duration
        const existing = await prisma.skillExecution.findUnique({
          where: { id: executionId },
          select: { startedAt: true },
        });
        
        const duration = existing?.startedAt
          ? completedAt.getTime() - new Date(existing.startedAt).getTime()
          : 0;
        
        // 更新 SkillExecution
        await prisma.skillExecution.update({
          where: { id: executionId },
          data: {
            status: 'completed',
            completedAt,
            duration,
            findingsCount: findingsPerSkill,
            updatedAt: completedAt,
          },
        });
        
        // 更新 Skill 的 vulnerabilityCount
        if (findingsPerSkill > 0) {
          await prisma.skill.update({
            where: { id: skillId },
            data: { vulnerabilityCount: { increment: findingsPerSkill }, updatedAt: completedAt },
          });
        }
        
        console.log(`[completeSkillExecutions] Skill 执行完成: executionId=${executionId}, duration=${duration}ms, findings=${findingsPerSkill}`);
      } catch (error) {
        console.error(`[completeSkillExecutions] 更新 Skill 执行记录失败: ${executionId}`, error);
      }
    }
    
    // 清空当前追踪
    this.currentSkillExecutionIds = [];
    this.currentSkillIds = [];
    
    console.log(`[completeSkillExecutions] 共完成 SkillExecution, totalFindings=${totalFindings}`);
  }

  /**
   * 标记 SkillExecution 为失败状态
   */
  private async failSkillExecutions(error: string): Promise<void> {
    if (this.currentSkillExecutionIds.length === 0) {
      return;
    }
    
    const completedAt = new Date();
    
    for (const executionId of this.currentSkillExecutionIds) {
      try {
        const existing = await prisma.skillExecution.findUnique({
          where: { id: executionId },
          select: { startedAt: true, skillId: true },
        });
        
        const duration = existing?.startedAt
          ? completedAt.getTime() - new Date(existing.startedAt).getTime()
          : 0;
        
        await prisma.skillExecution.update({
          where: { id: executionId },
          data: {
            status: 'failed',
            completedAt,
            duration,
            error,
            updatedAt: completedAt,
          },
        });
        
        console.log(`[failSkillExecutions] Skill 执行失败: executionId=${executionId}, error=${error}`);
      } catch (err) {
        console.error(`[failSkillExecutions] 更新 Skill 执行记录失败: ${executionId}`, err);
      }
    }
    
    this.currentSkillExecutionIds = [];
    this.currentSkillIds = [];
  }

  /**
   * 更新数据库状态
   */
  private async updateSessionStatus(
    status: WorkflowExecutionStatus,
    reason: string,
    result?: WorkflowExecutionResult | { error?: string; errorStack?: string }
  ): Promise<void> {
    try {
      const updateData: {
        status: string;
        endReason?: string;
        endMessage?: string;
        completedAt?: Date;
        totalInputTokens?: number;
        totalOutputTokens?: number;
        totalTokens?: number;
        errorMessage?: string;
      } = {
        status,
        endReason: reason,
      };

      if (status === 'completed' || status === 'failed' || status === 'partial' || status === 'cancelled') {
        updateData.completedAt = new Date();
      }

      if (result) {
        if ('totalInputTokens' in result) {
          updateData.totalInputTokens = result.totalInputTokens;
          updateData.totalOutputTokens = result.totalOutputTokens;
          updateData.totalTokens = result.totalInputTokens + result.totalOutputTokens;
        }
        if ('endMessage' in result && result.endMessage) {
          updateData.endMessage = result.endMessage;
        }
        if ('error' in result && result.error) {
          updateData.errorMessage = result.error;
        }
      }

      await prisma.evaluationSession.update({
        where: { id: this.config.evaluationSessionId },
        data: updateData,
      });

      // 同步更新 Project 状态（确保前端显示正确）
      // 评估完成后，项目状态应与评估状态一致
      await prisma.project.update({
        where: { id: this.config.projectId },
        data: { status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : status },
      });

      console.log(`[updateSessionStatus] 更新状态: ${status}, reason: ${reason}, 项目状态已同步更新`);
    } catch (error) {
      console.error(`[updateSessionStatus] 更新失败:`, error);
    }
  }

  /**
   * 确定最终状态
   */
  private determineStatus(nodeResults: NodeExecutionResult[]): WorkflowExecutionStatus {
    if (this.aborted) {
      return 'cancelled';
    }

    const allCompleted = nodeResults.every(r => r.status === 'completed');
    const anyFailed = nodeResults.some(r => r.status === 'failed');
    const allNodesExecuted = nodeResults.length === this.nodes.length;

    if (allCompleted && allNodesExecuted) {
      return 'completed';
    }
    if (anyFailed) {
      return 'failed';
    }
    return 'partial';
  }

  /**
   * 确定结束原因
   */
  private determineEndReason(status: WorkflowExecutionStatus): string {
    switch (status) {
      case 'completed':
        return '所有节点执行完成';
      case 'failed':
        return '节点执行失败';
      case 'partial':
        return '部分节点执行完成';
      case 'cancelled':
        return '用户中止';
      default:
        return '未知';
    }
  }

  /**
   * 生成结束消息
   */
  private generateEndMessage(
    status: WorkflowExecutionStatus,
    nodeResults: NodeExecutionResult[]
  ): string {
    const completedCount = nodeResults.filter(r => r.status === 'completed').length;
    const failedCount = nodeResults.filter(r => r.status === 'failed').length;
    const totalNodes = this.nodes.length;

    let message = `工作流执行结束: ${status}\n`;
    message += `完成节点: ${completedCount}/${totalNodes}\n`;
    message += `失败节点: ${failedCount}\n`;
    message += `总 Token: input=${this.cumulativeTokens.input}, output=${this.cumulativeTokens.output}\n`;

    if (failedCount > 0) {
      const failedNodes = nodeResults.filter(r => r.status === 'failed');
      message += `\n失败节点详情:\n`;
      for (const node of failedNodes) {
        message += `- ${node.nodeName}: ${node.error || '未知错误'}\n`;
        if (node.errorStack) {
          message += `  堆栈: ${node.errorStack.substring(0, 200)}...\n`;
        }
      }
    }

    return message;
  }

  /**
   * 休眠工具函数
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Debounce 更新 NodeExecution Token（避免频繁写入数据库）
   * 
   * 前端每5秒轮询 nodes API，我们每2秒更新一次即可
   */
  private updateNodeExecutionTokensDebounced(
    nodeId: string,
    inputTokens: number,
    outputTokens: number,
    modelConfig: ModelConfigForExecution
  ): void {
    // 记录待更新的 token 数据
    this.tokenUpdatePending[nodeId] = {
      input: inputTokens,
      output: outputTokens,
      modelName: modelConfig.name,
      modelConfigId: modelConfig.id,
    };
    
    // 如果已有定时器，不重复设置
    if (this.tokenUpdateTimer) {
      return;
    }
    
    // 设置定时器，延迟更新
    this.tokenUpdateTimer = setTimeout(async () => {
      this.tokenUpdateTimer = null;
      
      // 执行所有待更新的 token
      const pending = { ...this.tokenUpdatePending };
      this.tokenUpdatePending = {};
      
      for (const [nodeId, data] of Object.entries(pending)) {
        try {
          await this.updateNodeExecutionTokens(nodeId, data.input, data.output, data.modelName, data.modelConfigId);
        } catch (e) {
          console.error(`[updateNodeExecutionTokensDebounced] 更新 ${nodeId} 失败:`, e);
        }
      }
    }, this.TOKEN_UPDATE_INTERVAL);
  }

  /**
   * 创建节点执行记录（节点开始时）
   * 
   * 让 token 更新能找到记录进行更新
   */
  private async createNodeExecutionRecord(
    node: UnifiedNodeDefinition,
    nodeIndex: number,
    modelConfig: ModelConfigForExecution
  ): Promise<void> {
    try {
      const now = new Date();
      console.log(`[createNodeExecutionRecord] 开始: ${node.label}, nodeIndex=${nodeIndex}, workflowNodeId=${node.id}, evalSessionId=${this.config.evaluationSessionId}`);
      
      // 检查是否已存在
      const existing = await prisma.nodeExecution.findUnique({
        where: {
          evaluationSessionId_workflowNodeId: {
            evaluationSessionId: this.config.evaluationSessionId,
            workflowNodeId: node.id,
          },
        },
        select: {
          id: true,
          startedAt: true,
          status: true,
        },
      });
      
      console.log(`[createNodeExecutionRecord] 查询结果: existing=${existing ? '存在' : '不存在'}, id=${existing?.id || 'null'}, startedAt=${existing?.startedAt || 'null'}, status=${existing?.status || 'null'}`);
      
      if (existing) {
        // 已存在，更新状态为 running，确保 startedAt 被设置
        const updateData: any = {
          status: 'running',
          updatedAt: now,
          modelConfigId: modelConfig.id,
          modelName: modelConfig.name,
        };
        
        // 如果 startedAt 未设置，现在设置
        if (!existing.startedAt) {
          updateData.startedAt = now;
          console.log(`[createNodeExecutionRecord] 补充设置 startedAt: ${node.label}`);
        }
        
        await prisma.nodeExecution.update({
          where: { id: existing.id },
          data: updateData,
        });
        console.log(`[createNodeExecutionRecord] 更新节点记录: ${node.label}, startedAt=${existing.startedAt || '已补充'}`);
      } else {
        // 创建新记录
        await prisma.nodeExecution.create({
          data: {
            id: `node-exec-${this.config.evaluationSessionId}-${nodeIndex}`,
            evaluationSessionId: this.config.evaluationSessionId,
            workflowNodeId: node.id,
            nodeLabel: node.label,
            nodeType: node.fsmPhase ? 'fsm_phase' : (node.type || 'custom'),
            status: 'running',
            startedAt: now,  // 确保设置启动时间
            updatedAt: now,
            order: nodeIndex,
            modelConfigId: modelConfig.id,
            modelName: modelConfig.name,
            roleId: node.roleId ?? undefined,
            inputTokens: 0,
            outputTokens: 0,
          },
        });
        console.log(`[createNodeExecutionRecord] 创建节点记录: ${node.label}, id=node-exec-${this.config.evaluationSessionId}-${nodeIndex}, startedAt=已设置`);
      }
    } catch (error) {
      console.error(`[createNodeExecutionRecord] 创建失败:`, error);
      // 不阻塞执行
    }
  }

  /**
   * 实时更新 NodeExecution 表的 Token 字段
   * 
   * 让前端轮询 nodes API 能获取到执行中的节点 token
   */
  private async updateNodeExecutionTokens(
    nodeId: string,
    inputTokens: number,
    outputTokens: number,
    modelName: string,
    modelConfigId: string
  ): Promise<void> {
    try {
      // 查找现有记录
      const existing = await prisma.nodeExecution.findUnique({
        where: {
          evaluationSessionId_workflowNodeId: {
            evaluationSessionId: this.config.evaluationSessionId,
            workflowNodeId: nodeId,
          },
        },
      });
      
      if (existing) {
        // 更新现有记录的 token 字段
        // 注意：modelConfigId 可能不存在于 ModelConfig 表中（外键约束）
        // 所以只更新 modelName，不更新 modelConfigId（除非它是有效的）
        const updateData: any = {
          inputTokens,
          outputTokens,
          modelName,  // modelName 是字符串，没有外键约束
          updatedAt: new Date(),
        };
        
        // 只有当 modelConfigId 存在于数据库中时才更新
        // 否则跳过这个字段（避免外键约束错误）
        if (modelConfigId && modelConfigId !== modelName) {
          try {
            const modelExists = await prisma.modelConfig.findUnique({
              where: { id: modelConfigId },
              select: { id: true },
            });
            if (modelExists) {
              updateData.modelConfigId = modelConfigId;
            }
          } catch {
            // 查询失败，跳过 modelConfigId 更新
          }
        }
        
        await prisma.nodeExecution.update({
          where: { id: existing.id },
          data: updateData,
        });
        console.log(`[updateNodeExecutionTokens] 更新 ${nodeId}: input=${inputTokens}, output=${outputTokens}, modelName=${modelName}`);
      }
      // 如果不存在，说明节点记录还没创建，等节点开始时创建
    } catch (error) {
      console.error(`[updateNodeExecutionTokens] 更新失败:`, error);
      // 不抛出错误，不阻塞执行
    }
}
}

/**
 * 创建统一执行引擎的工厂方法
 */
export function createUnifiedExecutionEngine(
  config: UnifiedExecutionConfig,
  callbacks: UnifiedExecutionCallbacks
): UnifiedWorkflowExecutionEngine {
  return new UnifiedWorkflowExecutionEngine(config, callbacks);
}