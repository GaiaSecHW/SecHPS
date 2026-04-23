/**
 * Unified Workflow Execution Engine
 *
 * 统一执行引擎，用于 FSM 工作流和自定义 DAG 工作流的执行
 * 支持串行节点执行、角色模型配置、重试机制、完整错误堆栈记录
 */

import { prisma } from '@/lib/prisma';
import { createRalphLoopAgent, RalphLoopAgent } from '@/services/evaluation';
import { generateId } from '@/lib/id-generator';
import { EvaluationMessageStore, createEvaluationMessageStore } from '@/services/evaluation-message-store';
import { parseAndSaveVulnerabilities } from '@/lib/vulnerability/parser';
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
  
  /** JSONL 消息存储（双写过渡） */
  private messageStore: EvaluationMessageStore | null = null;

  constructor(config: UnifiedExecutionConfig, callbacks: UnifiedExecutionCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    
    // 初始化 JSONL 消息存储（双写过渡）
    this.messageStore = createEvaluationMessageStore(config.projectId, config.evaluationSessionId);
  }

  /**
   * 设置节点列表
   * @param nodes 节点定义数组（已排序）
   */
setNodes(nodes: UnifiedNodeDefinition[]): void {
      // 过滤节点：如果 start/end 节点没有配置描述，则不加入编排
      const filteredNodes = nodes.filter(node => {
        const nodeType = node.type || 'task';
        
        // start 节点：如果没有 startNodeDescription 则跳过
        if (nodeType === 'start') {
          const hasDescription = this.config.workflowConfig?.startNodeDescription || node.description;
          if (!hasDescription) {
            console.log(`[UnifiedEngine] 跳过 start 节点: ${node.label} (未配置 startNodeDescription)`);
            return false;
          }
        }
        
        // end 节点：如果没有 endNodeDescription 则跳过
        if (nodeType === 'end') {
          const hasDescription = this.config.workflowConfig?.endNodeDescription || node.description;
          if (!hasDescription) {
            console.log(`[UnifiedEngine] 跳过 end 节点: ${node.label} (未配置 endNodeDescription)`);
            return false;
          }
        }
        
        return true;
      });
      
      this.nodes = filteredNodes;
      console.log(`[UnifiedEngine] 设置节点列表: 原始 ${nodes.length} 个 -> 过滤后 ${filteredNodes.length} 个节点`);
      for (const node of filteredNodes) {
        console.log(`[UnifiedEngine] - Node ${node.id}: ${node.label} (type: ${node.type || 'task'}, roleId: ${node.roleId || 'default'})`);
      }
      
      // 记录被过滤的节点
      if (nodes.length !== filteredNodes.length) {
        console.log(`[UnifiedEngine] 已跳过 ${nodes.length - filteredNodes.length} 个无效节点 (start/end 无配置)`);
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
    
    // 初始化 JSONL 消息存储
    if (this.messageStore) {
      try {
        await this.messageStore.initialize();
        console.log(`[UnifiedEngine] JSONL 消息存储初始化成功`);
      } catch (error) {
        console.error(`[UnifiedEngine] JSONL 消息存储初始化失败:`, error);
        // 不阻塞主流程
      }
    }

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

      // 5.5. 解析并保存漏洞（如果工作流成功完成）
      if (status === 'completed') {
        await this.parseAndSaveVulnerabilitiesFromProject();
      }

      // 6. 调用完成回调
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

    // 调用节点开始回调
    await this.callbacks.onNodeStart(nodeIndex, nodeId, nodeName);

    // 获取模型配置
    const modelConfig = await this.getModelConfigForRole(node.roleId ?? undefined);
    console.log(`[executeNode] 使用模型: ${modelConfig.name} (${modelConfig.providerType})`);

    // 创建节点执行记录（status='running'）- 让 token 更新能找到记录
    await this.createNodeExecutionRecord(node, nodeIndex, modelConfig);

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

        // 保存用户消息（提示词）到数据库
        await this.saveNodeMessage(nodeId, 'user', prompt);

        // 累积助手响应文本（用于最终保存）
        let accumulatedAssistantText = '';
        let lastSavedLength = 0;  // 记录上次保存的长度

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
              // 日志：打印 onChunk 被调用
              console.log(`[executeNode] 📝 onChunk 被调用, 文本长度: ${text.length}, 累计: ${accumulatedAssistantText.length + text.length}`);
              
              // 累积助手响应文本
              accumulatedAssistantText += text;
              
              // 实时保存每条消息（不再等待 500 字符）
              this.saveNodeMessage(
                nodeId, 
                'assistant_chunk', 
                text,
                JSON.stringify({ nodeIndex, timestamp: Date.now(), cumulativeLength: accumulatedAssistantText.length })
              ).catch(err => console.error('[executeNode] 保存助手消息片段失败:', err));
              
              // 调用外部回调
              this.callbacks.onNodeChunk(nodeIndex, text);
            },
            onThinking: (thinking) => {
              // 保存思考消息到数据库
              console.log(`[executeNode] 🧠 onThinking 被调用, 长度: ${thinking?.length || 0}`);
              this.saveNodeMessage(
                nodeId,
                'thinking',
                thinking,
                JSON.stringify({ nodeIndex, timestamp: Date.now() })
              ).catch(err => console.error('[executeNode] 保存思考消息失败:', err));
            },
            onToolCall: (toolUseId, name, args) => {
              // ========================================
              // 子Agent交互日志 - 工具调用
              // ========================================
              if (name === 'Agent' || name === 'task') {
                console.log('\n' + '='.repeat(80));
                console.log('[子Agent交互] 工具调用');
                console.log('[子Agent交互] toolUseId:', toolUseId);
                console.log('[子Agent交互] 工具名称:', name);
                console.log('[子Agent交互] 参数(args):');
                console.log(JSON.stringify(args, null, 2));
                console.log('='.repeat(80) + '\n');
              }
              
              // 保存工具调用消息到数据库（包含 toolUseId 用于匹配 tool_result）
              this.saveNodeMessage(
                nodeId,
                'tool_call',
                JSON.stringify({ toolUseId, name, args }),
                JSON.stringify({ nodeIndex, timestamp: Date.now() })
              ).catch(err => console.error('[executeNode] 保存工具调用消息失败:', err));
              // 调用外部回调
              this.callbacks.onNodeToolCall(nodeIndex, name, args);
            },
            onToolResult: (toolUseId, content, isError) => {
              // ========================================
              // 子Agent交互日志 - 工具结果
              // ========================================
              console.log('\n' + '='.repeat(80));
              console.log('[子Agent交互] 工具结果');
              console.log('[子Agent交互] toolUseId:', toolUseId);
              console.log('[子Agent交互] isError:', isError);
              console.log('[子Agent交互] 结果内容:');
              const resultContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
              // 打印完整内容，不截断
              console.log(resultContent);
              console.log('='.repeat(80) + '\n');
              
              // 保存工具结果消息到数据库（包含 toolUseId 和 isError）
              this.saveNodeMessage(
                nodeId,
                'tool_result',
                typeof content === 'string' ? content : JSON.stringify(content),
                JSON.stringify({ toolUseId, isError, nodeIndex, timestamp: Date.now() })
              ).catch(err => console.error('[executeNode] 保存工具结果消息失败:', err));
            },
            onComplete: () => {},
            onError: (error) => {
              console.error(`[executeNode] Agent 错误: ${error.message}`);
            },
            onUsage: (usage) => {
              // SDK 返回的是当前节点的累计值
              // 记录每个节点的累计值（避免重复累加）
              this.nodeTokens[nodeIndex] = {
                input: usage.inputTokens || 0,
                output: usage.outputTokens || 0,
              };
              
              // 计算所有节点的总累计值
              this.cumulativeTokens.input = Object.values(this.nodeTokens)
                .reduce((sum: number, t: any) => sum + (t.input || 0), 0);
              this.cumulativeTokens.output = Object.values(this.nodeTokens)
                .reduce((sum: number, t: any) => sum + (t.output || 0), 0);
              
              // 实时更新 NodeExecution 表的 Token（前端轮询 nodes API 获取）
              this.updateNodeExecutionTokensDebounced(nodeId, usage.inputTokens || 0, usage.outputTokens || 0, modelConfig);
              
              // 实时推送 Token 使用量
              this.callbacks.onTokenUsage({
                nodeIndex,
                nodeId,
                nodeName,
                modelName: modelConfig.name,
                modelConfigId: modelConfig.id,
                // 当前节点的值（用于节点内显示）
                inputTokens: usage.inputTokens || 0,
                outputTokens: usage.outputTokens || 0,
                totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
                // 所有节点的累计值（用于顶部统计）
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

          // 保存助手消息到数据库（使用累积的文本或最终结果）
          const assistantText = accumulatedAssistantText || result.text;
          await this.saveNodeMessage(nodeId, 'assistant', assistantText);

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
   * 动态查询节点配置的 Skills，注册到 allowedTools 中
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
    
    // 构建 allowedTools（包含 Skill 注册）
    const baseTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash', 'Skill'];
    const skillTools = skills.map(s => `Skill(${s.name})`);
    const allowedTools = [...baseTools, ...skillTools];
    
    console.log(`[createNodeAgent] allowedTools: ${allowedTools.length} tools`);
    if (skills.length > 0) {
      console.log(`[createNodeAgent] 注册 Skills: ${skills.map(s => s.displayName || s.name).join(', ')}`);
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
        allowedTools,  // 注册 Skills
      }
    );
  }

  /**
   * 获取节点配置的 Skills
   * 
   * 根据节点的 Skill 加载模式动态查询匹配的 Skills
   * 
   * 模式：
   * - manual: 从 node.data.skills (skill ID 数组) 查询
   * - vulnerability: 从 node.data.vulnerabilityCategories 匹配（考虑技术栈）
   * - description: 不需要 Skills
   */
  private async getNodeSkills(node: UnifiedNodeDefinition): Promise<Array<{ name: string; displayName: string }>> {
    const nodeData = node.data as Record<string, unknown> | undefined;
    if (!nodeData) return [];

    // 获取 Skill 加载模式
    const mode = (nodeData.skillLoadingMode as string) || 'description';
    
    // description 模式不需要 Skills
    if (mode === 'description') {
      return [];
    }

    // manual 模式：从 node.data.skills 获取 skill IDs
    if (mode === 'manual') {
      let skillIds: string[] = [];
      const skillsField = nodeData.skills;
      
      if (typeof skillsField === 'string') {
        try {
          skillIds = JSON.parse(skillsField);
        } catch {
          return [];
        }
      } else if (Array.isArray(skillsField)) {
        skillIds = skillsField as string[];
      }
      
      if (skillIds.length === 0) return [];
      
      console.log(`[getNodeSkills] manual 模式, skillIds: ${skillIds.join(', ')}`);
      
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

    // vulnerability 模式：从漏洞分类匹配 Skills
    if (mode === 'vulnerability') {
      const categories = (nodeData.vulnerabilityCategories as string[]) || [];
      if (categories.length === 0) return [];
      
      console.log(`[getNodeSkills] vulnerability 模式, categories: ${categories.join(', ')}`);
      
      // 从数据库查询匹配漏洞分类的 Skills
      // 同时考虑技术栈匹配（如果有配置）
      const techStackIds = this.config.techStackIds || [];
      
      try {
        const whereClause: any = {
          isActive: true,
          vulnerabilityPatternCategory: { in: categories },
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

    // 非 FSM Phase：使用通用模板
    const prompt = `
# 工作流节点执行: ${node.label}

## 项目信息
- 项目名称: ${this.config.projectName}
- 工作流类型: ${this.config.workflowType}

## 当前节点
- 节点名称: ${node.label}
- 节点类型: ${nodeType}
- 节点描述: ${nodeDescription}
- FSM 阶段: ${node.fsmPhase ? `Phase ${node.fsmPhase}` : '无'}

## 前序节点输出
${previousOutputs}

## 任务要求
请执行当前节点的任务，并将结果写入 YAML 文件。

## 输出要求
- 输出格式: YAML
- 输出路径: outputs/phases/${nodeIndex + 1}-${node.label}/output.yaml
- 必须包含完整的分析结果

## 用户提示词
${this.config.userPrompt || '请完成当前节点的任务。'}
`;

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
      });

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
        await prisma.nodeExecution.update({
          where: { id: existing.id },
          data: {
            status: result.status,
            completedAt: new Date(),
            updatedAt: new Date(),
            modelConfigId: modelConfig.id,
            modelName: modelConfig.name,
            inputTokens: result.inputTokens || 0,
            outputTokens: result.outputTokens || 0,
          },
        });
        console.log(`[saveNodeExecutionToDB] 更新节点执行记录: ${node.label}`);
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
   * 保存单条节点消息到数据库
   * 支持实时保存各类消息（user, assistant, assistant_chunk, tool_call, tool_result）
   * 
   * FSM 模式特殊处理：workflowNodeId 不保存到数据库，因为 FSM 节点 ID 来自 JSON 配置，
   * 不存在于 WorkflowNode 表中，会导致外键约束失败。
   * 
   * @param nodeId 工作流节点 ID
   * @param role 消息角色 (user, assistant, assistant_chunk, tool_call, tool_result)
   * @param content 消息内容
   * @param metadata 可选的元数据（JSON 字符串）
   */
  async saveNodeMessage(
    nodeId: string,
    role: string,  // 支持任意角色类型
    content: string,
    metadata?: string
  ): Promise<void> {
    try {
      const data: {
        id: string;
        evaluationSessionId: string;
        workflowNodeId?: string | null;
        role: string;
        content: string;
        metadata?: string;
      } = {
        id: generateId('msg'),
        evaluationSessionId: this.config.evaluationSessionId,
        role,
        content,
      };
      
      // 解析 metadata
      const nodeMetadata = metadata ? JSON.parse(metadata) : {};
      
      // 所有模式：将 nodeId 保存到 metadata 中，不使用外键
      // 原因：用户画布创建的节点不存在于 WorkflowNode 表
      nodeMetadata.nodeId = nodeId;
      
      data.metadata = JSON.stringify(nodeMetadata);
      
      // 注意：不再设置 workflowNodeId 外键
      // 避免外键约束失败（节点可能不存在于 WorkflowNode 表）
      
      // ========================================
      // 双写机制：同时写入 Prisma 和 JSONL
      // ========================================
      
      // 1. 写入 JSONL（先写，确保数据持久化）
      if (this.messageStore) {
        try {
          // 提取 nodeIndex 和 agentCallMsgId
          const nodeIndex = nodeMetadata.nodeIndex ?? 0;
          const agentCallMsgId = nodeMetadata.agentCallMsgId ?? null;
          
          // 映射 role 到 EvaluationMessage 支持的类型
          const mappedRole = this.mapRoleToJsonlRole(role);
          
          await this.messageStore.appendMessage({
            role: mappedRole,
            nodeId: nodeId,  // 字符串，无外键依赖
            nodeIndex: nodeIndex,
            content: content,
            agentCallMsgId: agentCallMsgId,
            // 工具相关字段（从 metadata 提取）
            toolName: nodeMetadata.name,
            toolInput: nodeMetadata.args,
            toolResult: role === 'tool_result' ? content : undefined,
            toolUseId: nodeMetadata.toolUseId,
          });
        } catch (jsonlError) {
          console.error(`[saveNodeMessage] JSONL 写入失败:`, jsonlError);
          // 不阻塞主流程
        }
      }
      
      // 2. 写入 Prisma（双写过渡期保留）
      await prisma.sessionMessage.create({ data });
      console.log(`[saveNodeMessage] 保存消息成功: nodeId=${nodeId}, role=${role}, workflowType=${this.config.workflowType}, workflowNodeId=${data.workflowNodeId || 'null'}`);
    } catch (error) {
      console.error(`[saveNodeMessage] 保存失败:`, error);
      // 不抛出错误，允许执行继续进行
    }
  }
  
  /**
   * 映射 role 到 EvaluationMessage 支持的类型
   */
  private mapRoleToJsonlRole(role: string): 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result' {
    const roleMap: Record<string, 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result'> = {
      'user': 'user',
      'assistant': 'assistant',
      'assistant_chunk': 'assistant',
      'thinking': 'assistant',
      'system': 'system',
      'tool_call': 'tool_use',
      'tool_result': 'tool_result',
    };
    return roleMap[role] || 'assistant';
  }

  /**
   * 保存节点消息到数据库
   * 支持按节点过滤显示
   * 
   * 注意：此方法在节点完成后调用，保存最终结果
   * 实时消息通过 saveNodeMessage 方法在执行过程中保存
   */
  private async saveNodeMessagesToDB(
    nodeId: string,
    responseText: string,
    promptText: string
  ): Promise<void> {
    try {
      // 检查是否已存在用户消息（可能在节点开始时已保存）
      const existingUserMessage = await prisma.sessionMessage.findFirst({
        where: {
          evaluationSessionId: this.config.evaluationSessionId,
          workflowNodeId: nodeId,
          role: 'user',
        },
      });

      // 如果不存在用户消息，保存用户消息（提示词）
      if (!existingUserMessage) {
        await prisma.sessionMessage.create({
          data: {
            id: generateId('msg'),
            evaluationSessionId: this.config.evaluationSessionId,
            workflowNodeId: nodeId,
            role: 'user',
            content: promptText,
          },
        });
      }

      // 检查是否已存在助手消息（可能在节点完成时已保存）
      const existingAssistantMessage = await prisma.sessionMessage.findFirst({
        where: {
          evaluationSessionId: this.config.evaluationSessionId,
          workflowNodeId: nodeId,
          role: 'assistant',
        },
      });

      // 如果不存在助手消息，保存助手消息（响应）
      if (!existingAssistantMessage) {
        await prisma.sessionMessage.create({
          data: {
            id: generateId('msg'),
            evaluationSessionId: this.config.evaluationSessionId,
            workflowNodeId: nodeId,
            role: 'assistant',
            content: responseText,
          },
        });
      }

      console.log(`[saveNodeMessagesToDB] 保存节点消息: nodeId=${nodeId}`);
    } catch (error) {
      console.error(`[saveNodeMessagesToDB] 保存失败:`, error);
    }
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

      console.log(`[updateSessionStatus] 更新状态: ${status}, reason: ${reason}`);
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
      // 检查是否已存在
      const existing = await prisma.nodeExecution.findUnique({
        where: {
          evaluationSessionId_workflowNodeId: {
            evaluationSessionId: this.config.evaluationSessionId,
            workflowNodeId: node.id,
          },
        },
      });
      
      if (existing) {
        // 已存在，更新状态为 running
        await prisma.nodeExecution.update({
          where: { id: existing.id },
          data: {
            status: 'running',
            startedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        console.log(`[createNodeExecutionRecord] 更新节点记录: ${node.label}`);
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
            startedAt: new Date(),
            updatedAt: new Date(),
            order: nodeIndex,
            modelConfigId: modelConfig.id,
            modelName: modelConfig.name,
            roleId: node.roleId ?? undefined,
            inputTokens: 0,
            outputTokens: 0,
          },
        });
        console.log(`[createNodeExecutionRecord] 创建节点记录: ${node.label}`);
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
        await prisma.nodeExecution.update({
          where: { id: existing.id },
          data: {
            inputTokens,
            outputTokens,
            modelName,
            modelConfigId,
            updatedAt: new Date(),
          },
        });
        console.log(`[updateNodeExecutionTokens] 更新 ${nodeId}: input=${inputTokens}, output=${outputTokens}`);
      }
      // 如果不存在，说明节点记录还没创建，等节点开始时创建
    } catch (error) {
      console.error(`[updateNodeExecutionTokens] 更新失败:`, error);
      // 不抛出错误，不阻塞执行
    }
  }

  /**
   * 解析项目根目录下的 vulnerabilities.json 并保存到数据库
   * 
   * DAG/FSM 模式下，漏洞由 AI Skill 执行后写入 vulnerabilities.json 文件
   * 工作流完成后需要解析并入库
   */
  private async parseAndSaveVulnerabilitiesFromProject(): Promise<void> {
    const vulnerabilitiesPath = `${this.config.workspacePath}/vulnerabilities.json`;
    
    console.log(`[UnifiedEngine] 检查漏洞文件: ${vulnerabilitiesPath}`);
    
    try {
      const result = await parseAndSaveVulnerabilities(
        vulnerabilitiesPath,
        this.config.projectId,
        this.config.evaluationSessionId
      );
      
      console.log(`[UnifiedEngine] 漏洞解析完成: 保存 ${result.saved} 个, 跳过 ${result.skipped} 个`);
      
      if (result.errors.length > 0) {
        console.warn(`[UnifiedEngine] 漏洞解析错误:`, result.errors);
      }
    } catch (error) {
      // vulnerabilities.json 不存在或解析失败 - 不阻塞流程
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`[UnifiedEngine] 漏洞解析跳过: ${errorMsg}`);
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