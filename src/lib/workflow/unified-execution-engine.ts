/**
 * Unified Workflow Execution Engine
 *
 * 统一执行引擎，用于 FSM 工作流和自定义 DAG 工作流的执行
 * 支持串行节点执行、角色模型配置、重试机制、完整错误堆栈记录
 */

import { prisma } from '@/lib/prisma';
import { createRalphLoopAgent, RalphLoopAgent } from '@/services/evaluation';
import { generateId } from '@/lib/id-generator';
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
  
  /** 执行开始时间 */
  private startTime: Date = new Date();

  constructor(config: UnifiedExecutionConfig, callbacks: UnifiedExecutionCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * 设置节点列表
   * @param nodes 节点定义数组（已排序）
   */
  setNodes(nodes: UnifiedNodeDefinition[]): void {
    this.nodes = nodes;
    console.log(`[UnifiedEngine] 设置节点列表: ${nodes.length} 个节点`);
    for (const node of nodes) {
      console.log(`[UnifiedEngine] - Node ${node.id}: ${node.label} (roleId: ${node.roleId || 'default'})`);
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
        console.log(`[UnifiedEngine] ========== 开始执行节点 ${i + 1}/${this.nodes.length}: ${node.label} ==========`);
        
        const result = await this.executeNode(i, node);
        nodeResults.push(result);

        // 3. 节点失败时停止
        if (result.status === 'failed') {
          console.log(`[UnifiedEngine] 节点 ${node.label} 执行失败，停止工作流`);
          break;
        }

        // 更新累计 Token
        this.cumulativeTokens.input += result.inputTokens;
        this.cumulativeTokens.output += result.outputTokens;
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
        // 创建 RalphLoopAgent
        const agent = this.createNodeAgent(nodeIndex, modelConfig, node);
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
            onToolCall: (name, args) => {
              // 保存工具调用消息到数据库
              this.saveNodeMessage(
                nodeId,
                'tool_call',
                JSON.stringify({ name, args }),
                JSON.stringify({ nodeIndex, timestamp: Date.now() })
              ).catch(err => console.error('[executeNode] 保存工具调用消息失败:', err));
              // 调用外部回调
              this.callbacks.onNodeToolCall(nodeIndex, name, args);
            },
            onToolResult: (name, result) => {
              // 保存工具结果消息到数据库
              this.saveNodeMessage(
                nodeId,
                'tool_result',
                typeof result === 'string' ? result : JSON.stringify(result),
                JSON.stringify({ toolName: name, nodeIndex, timestamp: Date.now() })
              ).catch(err => console.error('[executeNode] 保存工具结果消息失败:', err));
            },
            onComplete: () => {},
            onError: (error) => {
              console.error(`[executeNode] Agent 错误: ${error.message}`);
            },
            onUsage: (usage) => {
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
                cumulativeInputTokens: this.cumulativeTokens.input + (usage.inputTokens || 0),
                cumulativeOutputTokens: this.cumulativeTokens.output + (usage.outputTokens || 0),
                cumulativeTotalTokens: this.cumulativeTokens.input + this.cumulativeTokens.output + (usage.inputTokens || 0) + (usage.outputTokens || 0),
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
   */
  private createNodeAgent(
    nodeIndex: number,
    modelConfig: ModelConfigForExecution,
    node: UnifiedNodeDefinition
  ): RalphLoopAgent {
    console.log(`[createNodeAgent] Creating agent for node ${nodeIndex}: ${node.label}`);
    console.log(`[createNodeAgent] Model: ${modelConfig.name}`);
    console.log(`[createNodeAgent] WorkflowNodeId: ${node.id}`);

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
      }
    );
  }

  /**
   * FSM Phase 默认内容
   * 当 workflowConfig.fsmPhasePrompts 未配置时使用
   */
  private getFSMPhaseDefaultPrompt(phase: number): string {
    const phasePrompts: Record<number, string> = {
      1: '威胁建模 - 识别系统威胁和攻击面，分析潜在的安全风险',
      2: '代码审计 - 深入分析源代码漏洞，检查代码质量和安全问题',
      3: '漏洞分析 - 验证和分类发现的漏洞，评估漏洞严重程度',
      4: '报告生成 - 汇总分析结果，生成完整的安全评估报告',
      5: '修复建议 - 为发现的漏洞提供修复建议和最佳实践',
      6: '验证修复 - 验证修复方案的有效性，确保漏洞已正确修复',
    };
    return phasePrompts[phase] || `Phase ${phase} - 执行阶段 ${phase} 的任务`;
  }

  /**
   * 构建节点提示词
   * 根据节点类型使用不同的内容来源：
   * - start 节点：使用 workflowConfig.startNodeDescription
   * - end 节点：使用 workflowConfig.endNodeDescription
   * - fsm_phase 节点：使用 workflowConfig.fsmPhasePrompts[fsmPhase] 或默认内容
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
      // FSM Phase 节点：使用 workflowConfig.fsmPhasePrompts 或默认内容
      const phasePrompt = this.config.workflowConfig?.fsmPhasePrompts?.[node.fsmPhase];
      nodeDescription = phasePrompt || 
        this.getFSMPhaseDefaultPrompt(node.fsmPhase) ||
        node.description || 
        `执行 FSM Phase ${node.fsmPhase}`;
    } else {
      // 其他节点：使用 node.description 或 node.data
      nodeDescription = node.description || 
        (node.data?.description as string) || 
        (node.data?.taskDescription as string) || 
        '执行节点任务';
    }

    // 构建提示词
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
- 输出路径: .claude/phases/${nodeIndex + 1}-${node.label}/output.yaml
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
      // 尝试读取前序节点的 YAML 输出
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const outputPath = path.join(
          this.config.workspacePath,
          '.claude',
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

    // 创建输出目录
    const phaseDir = path.join(
      this.config.workspacePath,
      '.claude',
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
      // FSM 模式：不保存 workflowNodeId，避免外键约束失败
      // DAG 模式：保存 workflowNodeId，用于节点消息过滤
      const isFSM = this.config.workflowType === 'fsm';
      
      const data: {
        id: string;
        evaluationSessionId: string;
        workflowNodeId?: string;
        role: string;
        content: string;
        metadata?: string;
      } = {
        id: generateId('msg'),
        evaluationSessionId: this.config.evaluationSessionId,
        role,
        content,
      };
      
      // DAG 模式才保存 workflowNodeId
      if (!isFSM) {
        data.workflowNodeId = nodeId;
      }
      
      if (metadata) {
        data.metadata = metadata;
      }
      
      await prisma.sessionMessage.create({ data });
      console.log(`[saveNodeMessage] 保存消息成功: nodeId=${nodeId}, role=${role}, workflowType=${this.config.workflowType}`);
    } catch (error) {
      console.error(`[saveNodeMessage] 保存失败:`, error);
      // 不抛出错误，允许执行继续进行
    }
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