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
  // Helper: 将 modelConfig.name/models 转成字符串
  private getModelNameStr(modelConfig: any): string {
    if (Array.isArray(modelConfig.name)) {
      return modelConfig.name[0] || '';
    }
    if (Array.isArray(modelConfig.models)) {
      try {
        const models = typeof modelConfig.models === 'string' 
          ? JSON.parse(modelConfig.models) 
          : modelConfig.models;
        if (Array.isArray(models) && models.length > 0) {
          return models[0];
        }
      } catch {}
    }
    return modelConfig.name || '';
  }

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
  
  /** 当前正在执行的 Skill 信息（用于关联 Agent 工具） */
  private currentExecutingSkills: Map<string, { executionId: string; skillId: string; skillName: string; toolUseId: string; startTime: number }> = new Map();
  
  /** Skill 名称到 executionId 的映射（用于 Agent 工具结果匹配） */
  private skillNameToExecutionId: Map<string, string> = new Map();

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
        totalTokens: this.cumulativeTokens.input + this.cumulativeTokens.output,
        totalCost: 0, // TODO: 计算实际成本
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
        totalTokens: this.cumulativeTokens.input + this.cumulativeTokens.output,
        totalCost: 0,
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
   * 
   * 多 Skill 串行执行：
   * - 当节点有 skills 数组且长度 > 1 时，为每个 skill 创建独立的 agent 执行循环
   * - 每个 skill 使用 skill.content 作为 system prompt
   * - 每个 skill 执行完成后更新 SkillExecution 状态
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

    // 清空本节点的 Skill 记录列表（每个节点独立记录）
    this.currentSkillExecutionIds = [];
    this.currentSkillIds = [];
    this.currentExecutingSkills.clear();
    this.skillNameToExecutionId.clear();
    console.log(`[executeNode] 已清空 Skill 记录列表，准备记录本节点的 Skills`);

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
    
    // 检查是否需要多 Skill 串行执行
    const nodeData = node.data as Record<string, unknown> | undefined;
    const mode = (nodeData?.skillLoadingMode as string) || 'description';
    
    // 获取节点配置的 Skills（用于判断是否需要串行执行）
    const skills = await this.getNodeSkills(node);
    
    // Skill 串行执行模式：当 skills.length >= 1 且是 vulnerability/manual 模式
    if (skills.length >= 1 && mode !== 'description') {
      console.log(`[executeNode] 检测到 Skill 节点 (${skills.length} 个)，启用串行执行模式，mode=${mode}`);
      return await this.executeMultiSkillNode(nodeIndex, node, modelConfig);
    }
    
    // 单 Skill 或 description 模式：保持原有执行逻辑
    // 注意：SkillExecution 记录在 Skill 工具调用时自动创建，不需要预先创建

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
          modelName: this.getModelNameStr(modelConfig),
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
              // 检测 Skill 工具调用，立即创建执行记录（startedAt = 精确时间）
              if (name === 'Skill') {
                // 获取 skill 名称（支持多种参数格式）
                const skillName = (args as any)?.skill || (args as any)?.skill_name || (args as any)?.name;
                if (skillName && typeof skillName === 'string') {
                  console.log(`[executeNode] 检测到 Skill 调用: ${skillName}, toolUseId=${toolUseId}`);
                  
                  // 立即创建 SkillExecution 记录（startedAt = 精确时间）
                  this.createSingleSkillExecution(skillName, toolUseId, nodeIndex, nodeName || 'unknown')
                    .catch((err: Error) => console.error(`[executeNode] 创建 Skill 执行记录失败:`, err));
                }
              }
              
              // 检测 Agent 工具调用（子 Agent 执行 Skill），记录关联
              if (name === 'Agent' || name === 'task') {
                const description = (args as any)?.description || '';
                // 从 description 中提取 skill 名称（格式：执行xxx安全检测）
                const skillMatch = description.match(/执行\s*([a-zA-Z0-9_-]+)\s*安全检测/);
                if (skillMatch && skillMatch[1]) {
                  const skillName = skillMatch[1];
                  console.log(`[executeNode] 检测到 Agent 执行 Skill: ${skillName}, toolUseId=${toolUseId}`);
                  
                  // 根据 skill 名称找到对应的 SkillExecution
                  const executionId = this.skillNameToExecutionId.get(skillName);
                  const skillInfo = executionId ? this.currentExecutingSkills.get(skillName) : null;
                  
                  if (executionId && skillInfo) {
                    // 记录 Agent toolUseId 和 SkillExecution 的关联
                    this.currentExecutingSkills.set(toolUseId, {
                      executionId,
                      skillId: skillInfo.skillId,
                      skillName,
                      toolUseId,
                      startTime: Date.now()
                    });
                  }
                }
                
                // 子Agent交互日志
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
              // 检测 Agent 工具结果（子 Agent 完成 = Skill 执行完成）
              const executingSkill = this.currentExecutingSkills.get(toolUseId);
              if (executingSkill) {
                const skillName = executingSkill.skillName;
                console.log(`[executeNode] Agent 工具返回，Skill ${skillName} 执行完成, toolUseId=${toolUseId}`);
                
                // 根据 skill 名称找到对应的 SkillExecution 并完成
                const executionId = this.skillNameToExecutionId.get(skillName);
                if (executionId) {
                  this.completeSingleSkillExecutionByAgent(executionId, toolUseId, content, isError || false)
                    .catch((err: Error) => console.error(`[executeNode] 完成 Skill 执行记录失败:`, err));
                }
                
                // 清除关联记录
                this.currentExecutingSkills.delete(toolUseId);
              }
              
              // 子Agent交互日志
              console.log('\n' + '='.repeat(80));
              console.log('[子Agent交互] 工具结果:', toolUseId, 'isError:', isError);
              const resultContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
              // 只输出前300个字符，避免日志过长
              const truncatedContent = resultContent.length > 300 
                ? resultContent.substring(0, 300) + '... (截断，总长度: ' + resultContent.length + ')'
                : resultContent;
              console.log(truncatedContent);
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
                modelName: this.getModelNameStr(modelConfig),
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
            modelName: this.getModelNameStr(modelConfig),
            modelConfigId: modelConfig.id,
            error: '用户中止',
            errorStack: '',
          };
        }

        // 成功完成 - 执行到这里说明节点没有被中止，写入输出
        console.log(`[executeNode] 节点执行完成: completionReason=${result.completionReason}, iterations=${result.iterations}`);

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
          modelName: this.getModelNameStr(modelConfig),
          modelConfigId: modelConfig.id,
        };

        // 调用节点完成回调
        await this.callbacks.onNodeComplete(nodeIndex, nodeResult);

        // 保存节点执行记录到数据库
        await this.saveNodeExecutionToDB(nodeIndex, node, nodeResult, modelConfig);
        
        // 完成 SkillExecution 记录（统计漏洞数量）
        await this.completeSkillExecutions(nodeIndex);

        return nodeResult;

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
      modelName: this.getModelNameStr(modelConfig),
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
   * 执行多 Skill 节点（串行执行）
   * 
   * 当节点有 skills 数组且长度 > 1 时，为每个 skill 创建独立的 agent 执行循环
   * 每个 skill 使用 skill.content 作为 system prompt
   * 每个 skill 执行完成后更新 SkillExecution 状态
   */
  private async executeMultiSkillNode(
    nodeIndex: number,
    node: UnifiedNodeDefinition,
    modelConfig: ModelConfigForExecution
  ): Promise<NodeExecutionResult> {
    const nodeStartTime = Date.now();
    const nodeName = node.label;
    const nodeId = node.id;
    
    // 查询该节点的所有 pending SkillExecution，按 order 排序
    const pendingExecutions = await prisma.skillExecution.findMany({
      where: {
        evaluationId: this.config.evaluationSessionId,
        nodeId: nodeId,
        status: 'pending',
      },
      select: {
        id: true,
        skillId: true,
        order: true,
        Skill: {
          select: {
            name: true,
            displayName: true,
            content: true,
          },
        },
      },
      orderBy: { order: 'asc' },
    });
    
    // 按 SkillExecution.order 顺序执行
    const skills = pendingExecutions.map(exec => ({
      executionId: exec.id,
      skillId: exec.skillId,
      order: exec.order,
      name: exec.Skill?.name || '',
      displayName: exec.Skill?.displayName || '',
      content: exec.Skill?.content || '',
    }));
    
    console.log(`[executeMultiSkillNode] 找到 ${skills.length} 个 pending SkillExecution，按 order 排序执行`);
    if (skills.length === 0) {
      console.log(`[executeMultiSkillNode] 无 pending SkillExecution，跳过`);
      return {
        nodeIndex,
        nodeId,
        nodeName,
        status: 'completed',
        iterations: 0,
        retryCount: 0,
        duration: Date.now() - nodeStartTime,
        inputTokens: 0,
        outputTokens: 0,
        modelName: this.getModelNameStr(modelConfig),
        modelConfigId: modelConfig.id,
      };
    }
    
    // 获取前序节点输出
    const previousOutputs = await this.getPreviousOutputs(nodeIndex);
    
    // 累计 token 使用量
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalIterations = 0;
    
    // 存储每个 skill 的执行结果
    const skillResults: Array<{
      skillName: string;
      skillId: string;
      executionId: string;
      status: 'completed' | 'failed';
      text: string;
      error?: string;
    }> = [];
    
    // ========================================
    // 10分钟无响应处理逻辑
    // ========================================
    
    /** 最后活动时间（用于检测无响应） */
    let lastActivityTime = Date.now();
    
    /** 10分钟无响应阈值（毫秒） */
    const NO_RESPONSE_THRESHOLD_MS = 10 * 60 * 1000; // 10分钟
    
    /** 检查间隔（毫秒） */
    const CHECK_INTERVAL_MS = 60 * 1000; // 60秒
    
    /** 是否已发送过询问消息（避免重复发送） */
    let inquirySent = false;
    
    /** 进度监控定时器 */
    let progressMonitorTimer: NodeJS.Timeout | null = null;
    
    /** 当前执行的 skill 名称（用于日志） */
    let currentExecutingSkillName = '';
    
    /**
     * 更新最后活动时间
     */
    const updateActivityTime = () => {
      lastActivityTime = Date.now();
      if (inquirySent) {
        // 收到响应后重置询问标志
        inquirySent = false;
        console.log(`[executeMultiSkillNode] 收到响应，重置询问标志`);
      }
    };
    
    /**
     * 发送询问消息到 agent
     * 通过写入 stream.jsonl 让前端可见
     */
    const sendInquiryMessage = async (skillName: string) => {
      const inquiryMessage = `【系统询问】请报告当前执行进度，是否遇到问题？当前正在执行 Skill: ${skillName}`;
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`[executeMultiSkillNode] ⚠️ 10分钟无响应，发送询问消息`);
      console.log(`[executeMultiSkillNode] Skill: ${skillName}`);
      console.log(`[executeMultiSkillNode] 消息: ${inquiryMessage}`);
      console.log(`${'='.repeat(80)}\n`);
      
      // 写入 stream.jsonl（让前端可见）
      await this.nodeStreamStore.appendToStream(nodeId, {
        event: 'system_inquiry',
        data: {
          text: inquiryMessage,
          skillName,
          skillIndex: skills.findIndex(s => s.name === skillName),
          timestamp: new Date().toISOString(),
          reason: '10分钟无响应',
        },
      });
      
      inquirySent = true;
    };
    
    /**
     * 启动进度监控定时器
     */
    const startProgressMonitor = () => {
      if (progressMonitorTimer) {
        return; // 已启动
      }
      
      progressMonitorTimer = setInterval(() => {
        const now = Date.now();
        const elapsedMs = now - lastActivityTime;
        const elapsedMinutes = Math.floor(elapsedMs / 60000);
        
        if (elapsedMs >= NO_RESPONSE_THRESHOLD_MS && !inquirySent && currentExecutingSkillName) {
          console.log(`[executeMultiSkillNode] 检测到 ${elapsedMinutes} 分钟无响应，准备发送询问`);
          sendInquiryMessage(currentExecutingSkillName).catch(err => 
            console.error(`[executeMultiSkillNode] 发送询问消息失败:`, err)
          );
        } else if (elapsedMinutes > 0 && elapsedMinutes < 10) {
          // 每60秒输出一次状态（仅当超过1分钟时）
          console.log(`[executeMultiSkillNode] 进度监控: ${elapsedMinutes} 分钟无新输出，Skill: ${currentExecutingSkillName}`);
        }
      }, CHECK_INTERVAL_MS);
      
      console.log(`[executeMultiSkillNode] 进度监控定时器已启动，检查间隔: ${CHECK_INTERVAL_MS / 1000}秒`);
    };
    
    /**
     * 停止进度监控定时器
     */
    const stopProgressMonitor = () => {
      if (progressMonitorTimer) {
        clearInterval(progressMonitorTimer);
        progressMonitorTimer = null;
        console.log(`[executeMultiSkillNode] 进度监控定时器已停止`);
      }
    };
    
    // 串行执行每个 skill
    for (let skillIndex = 0; skillIndex < skills.length; skillIndex++) {
      if (this.aborted) {
        console.log(`[executeMultiSkillNode] 检测到中止信号，停止执行`);
        // 停止进度监控定时器
        stopProgressMonitor();
        break;
      }
      
      const skill = skills[skillIndex];
      console.log(`[executeMultiSkillNode] ========== 执行 Skill ${skillIndex + 1}/${skills.length}: ${skill.displayName} (order=${skill.order}) ==========`);
      
      // skills 数组已包含所有信息，直接使用
      const executionId = skill.executionId;
      const skillOrder = skill.order;
      const skillStartTime = Date.now();
      
      // 更新 SkillExecution 为 running
      await prisma.skillExecution.update({
        where: { id: executionId },
        data: {
          status: 'running',
          startedAt: new Date(),
        },
      });
      
      console.log(`[executeMultiSkillNode] SkillExecution 更新为 running: ${skill.displayName}, executionId=${executionId}, order=${skillOrder}`);
      
      // 更新 Skill 的 execCount
      await prisma.skill.update({
        where: { id: skill.skillId },
        data: { execCount: { increment: 1 }, updatedAt: new Date() },
      });
      
      // 记录到当前追踪列表
      this.currentSkillExecutionIds.push(executionId);
      this.currentSkillIds.push(skill.skillId);
      this.skillNameToExecutionId.set(skill.name, executionId);
      
      // 构建用户提示词（让 agent 调用 skill）
      const skillUserPrompt = `
# 执行 Skill: ${skill.displayName}

## 项目信息
- 项目名称: ${this.config.projectName}
- 项目路径: ${this.config.workspacePath}

## 任务要求
请调用 /${skill.name} skill 执行安全检测。

## 重要：完成标志
完成任务后，必须在输出末尾明确声明：
- "任务完成" 或 "评估完成" 或 "检测完成"
- 或 "completed" 或 "done" 或 "finished"

${this.config.userPrompt ? `## 用户附加提示\n${this.config.userPrompt}` : ''}
`;
      
      // 创建 skill agent（不传 skillSystemPrompt，让 SDK 从 .claude/skills/ 加载）
      const skillAgent = await this.createSkillAgent(modelConfig, node, skill.name);
      this.currentAgent = skillAgent;
      
      // 设置当前执行的 skill 名称（用于进度监控日志）
      currentExecutingSkillName = skill.name;
      
      // 写入用户输入消息到 agent stream（第一条消息）
      await this.nodeStreamStore.appendToAgentStream(nodeId, executionId, {
        event: 'user',
        data: { text: skillUserPrompt, skillName: skill.name, skillIndex },
      });
      
      // 启动进度监控定时器
      startProgressMonitor();
      
      // 重置活动时间（开始新的 skill 执行）
      updateActivityTime();
      
      // 累积助手响应文本
      let accumulatedAssistantText = '';
      let skillInputTokens = 0;
      let skillOutputTokens = 0;
      let skillCompletedInCallback = false;  // 标记是否在回调中已完成
      
      try {
        // 执行 skill agent
        console.log(`[executeMultiSkillNode] 🚀 开始执行 skillAgent.loop(): ${skill.name}`);
        
        // 超时询问进展机制（基于无活动时间）
        const SKILL_TIMEOUT_MS = 30 * 60 * 1000;  // 30分钟无活动才触发
        const MAX_INQUIRIES = 10;  // 最大询问次数
        let inquiryCount = 0;
        let skillStartTime = Date.now();
        let skillLastActivityTime = Date.now();  // Skill 级别的活动时间
        let timeoutTimerId: NodeJS.Timeout | null = null;
        let forceAbort = false;  // 强制中止标志
        
        // 更新 Skill 活动时间（在回调中调用）
        const updateSkillActivityTime = () => {
          skillLastActivityTime = Date.now();
          updateActivityTime();  // 也更新全局活动时间
        };
        
        // 启动超时检查定时器（检查无活动时间）
        const startTimeoutTimer = () => {
          // 每1分钟检查一次是否有活动
          timeoutTimerId = setTimeout(() => {
            if (skillCompletedInCallback) {
              console.log(`[executeMultiSkillNode] ⏰ 超时检查但 Skill 已完成，忽略`);
              return;
            }
            
            // 计算无活动时间
            const idleTime = Date.now() - skillLastActivityTime;
            const idleMinutes = Math.round(idleTime / 60000);
            
            console.log(`[executeMultiSkillNode] ⏰ Skill ${skill.name} 超时检查: 无活动 ${idleMinutes} 分钟, 阈值 ${SKILL_TIMEOUT_MS / 60000} 分钟`);
            
            // 只有真正无活动超过阈值才触发询问
            if (idleTime >= SKILL_TIMEOUT_MS) {
              inquiryCount++;
              
              if (inquiryCount <= MAX_INQUIRIES) {
                console.log(`[executeMultiSkillNode] ⏰ Skill ${skill.name} 无活动超时，询问进展 (${inquiryCount}/${MAX_INQUIRIES})`);
                
                // 注入进展询问消息
                skillAgent.injectProgressInquiry(
                  `执行已超过 ${idleMinutes} 分钟无响应。\n` +
                  `请立即汇报当前进展：\n` +
                  `1) 已完成的工作内容\n` +
                  `2) 当前正在执行的操作\n` +
                  `3) 剩余工作及预计所需时间\n` +
                  `如果任务已完成，请明确说明"任务完成"或"检测完成"。`
                );
                
                // 发送 SSE 事件通知前端
                this.nodeStreamStore.appendToAgentStream(nodeId, executionId, {
                  event: 'progress_inquiry',
                  data: { 
                    skillName: skill.name, 
                    skillIndex, 
                    inquiryCount,
                    maxInquiries: MAX_INQUIRIES,
                    idleMinutes,
                    message: `无活动 ${idleMinutes} 分钟，系统正在询问进展 (${inquiryCount}/${MAX_INQUIRIES})`
                  },
                }).catch(err => console.error('[executeMultiSkillNode] 保存 progress_inquiry 失败:', err));
                
                // 重置活动时间（询问后等待响应）
                skillLastActivityTime = Date.now();
                
                // 继续检查
                startTimeoutTimer();
              } else {
                console.log(`[executeMultiSkillNode] ⏰ Skill ${skill.name} 已询问 ${MAX_INQUIRIES} 次，强制结束`);
                forceAbort = true;
                
                // 记录详细错误信息
                const totalDuration = Math.round((Date.now() - skillStartTime) / 60000);
                console.log(`[executeMultiSkillNode] 详细错误: 总执行 ${totalDuration} 分钟，输出 ${accumulatedAssistantText.length} 字符`);
                
                skillAgent.abort();
              }
            } else {
              // 未达到超时阈值，继续检查
              startTimeoutTimer();
            }
          }, 60 * 1000);  // 每1分钟检查一次
        };
        
        // 启动第一个超时定时器
        startTimeoutTimer();
        
        const result = await skillAgent.loop({
            evaluationId: this.config.evaluationSessionId,
            projectId: this.config.projectId,
            workflowNodeId: node.id,
            context: {
              projectName: this.config.projectName,
              taskDescription: skillUserPrompt,
              initialMessage: skillUserPrompt,
              files: [],
            },
            callbacks: {
            onChunk: (text) => {
              // 更新 Skill 活动时间（重置超时计时）
              updateSkillActivityTime();
              
              accumulatedAssistantText += text;
              
              // 写入 skill agent 专属的 stream（agents/{executionId}.jsonl）
              this.nodeStreamStore.appendToAgentStream(nodeId, executionId, {
                event: 'text',
                data: { text, skillName: skill.name, skillIndex, cumulativeLength: accumulatedAssistantText.length },
              }).catch(err => console.error('[executeMultiSkillNode] 保存文本失败:', err));
              
              // 调用外部回调
              this.callbacks.onNodeChunk(nodeIndex, text);
            },
            onThinking: (thinking) => {
              // 更新 Skill 活动时间（重置超时计时）
              updateSkillActivityTime();
              
              this.nodeStreamStore.appendToAgentStream(nodeId, executionId, {
                event: 'thinking',
                data: { text: thinking, skillName: skill.name, skillIndex },
              }).catch(err => console.error('[executeMultiSkillNode] 保存思考失败:', err));
            },
            onToolCall: (toolUseId, name, args) => {
              // 更新 Skill 活动时间（重置超时计时）
              updateSkillActivityTime();
              
              this.nodeStreamStore.appendToAgentStream(nodeId, executionId, {
                event: 'tool_use',
                data: { toolUseId, name, args, skillName: skill.name, skillIndex },
              }).catch(err => console.error('[executeMultiSkillNode] 保存工具调用失败:', err));
              
              this.callbacks.onNodeToolCall(nodeIndex, name, args);
            },
            onToolResult: (toolUseId, content, isError) => {
              // 更新 Skill 活动时间（重置超时计时）
              updateSkillActivityTime();
              const resultData = typeof content === 'string' ? (() => { try { return JSON.parse(content); } catch { return {}; } })() : content;
              
              this.nodeStreamStore.appendToAgentStream(nodeId, executionId, {
                event: 'tool_result',
                data: { toolUseId, content: resultData, isError, skillName: skill.name, skillIndex },
              }).catch(err => console.error('[executeMultiSkillNode] 保存工具结果失败:', err));
            },
            onComplete: async () => {
              console.log(`[executeMultiSkillNode] 🏁 onComplete 回调触发: ${skill.name}`);
              
              // 立即更新数据库状态为 completed
              if (!skillCompletedInCallback) {
                skillCompletedInCallback = true;
                console.log(`[executeMultiSkillNode] onComplete 中更新状态: executionId=${executionId}, status=completed`);
                await this.updateSkillExecutionStatus(executionId, skill.skillId, 'completed', skillStartTime, accumulatedAssistantText);
              }
              
              this.nodeStreamStore.appendToAgentStream(nodeId, executionId, {
                event: 'skill_complete',
                data: { skillName: skill.name, skillIndex, text: accumulatedAssistantText },
              }).catch(err => console.error('[executeMultiSkillNode] 保存 skill_complete 失败:', err));
            },
            onError: (error) => {
              console.error(`[executeMultiSkillNode] Skill ${skill.name} Agent 错误: ${error.message}`);
              this.nodeStreamStore.appendToStream(nodeId, {
                event: 'error',
                data: { message: error.message, stack: error.stack, skillName: skill.name, skillIndex },
              }).catch(err => console.error('[executeMultiSkillNode] 保存 error 失败:', err));
            },
            onUsage: (usage) => {
              // 更新 Skill 活动时间（token 使用也是活动，重置超时计时）
              updateSkillActivityTime();
              
              skillInputTokens = usage.inputTokens || 0;
              skillOutputTokens = usage.outputTokens || 0;
              
              // 累加到节点总 token
              totalInputTokens += skillInputTokens;
              totalOutputTokens += skillOutputTokens;
              
              // 更新 nodeTokens
              this.nodeTokens[nodeIndex] = {
                input: totalInputTokens,
                output: totalOutputTokens,
              };
              
              // 更新累计 token
              this.cumulativeTokens.input = Object.values(this.nodeTokens)
                .reduce((sum: number, t: any) => sum + (t.input || 0), 0);
              this.cumulativeTokens.output = Object.values(this.nodeTokens)
                .reduce((sum: number, t: any) => sum + (t.output || 0), 0);
              
              // 实时推送 Token 使用量
              this.callbacks.onTokenUsage({
                nodeIndex,
                nodeId,
                nodeName,
                modelName: this.getModelNameStr(modelConfig),
                modelConfigId: modelConfig.id,
                inputTokens: skillInputTokens,
                outputTokens: skillOutputTokens,
                totalTokens: skillInputTokens + skillOutputTokens,
                cumulativeInputTokens: this.cumulativeTokens.input,
                cumulativeOutputTokens: this.cumulativeTokens.output,
                cumulativeTotalTokens: this.cumulativeTokens.input + this.cumulativeTokens.output,
              });
            },
            onRalphComplete: async () => {},
          },
        });
        
        // 清除超时定时器（loop() 已返回）
        if (timeoutTimerId) {
          clearTimeout(timeoutTimerId);
          timeoutTimerId = null;
        }
        
        // 检查是否被强制中止
        if (forceAbort) {
          console.log(`[executeMultiSkillNode] ⏰ Skill ${skill.name} 被强制中止（超时询问次数已达上限）`);
          this.currentAgent = null;
          stopProgressMonitor();
          
          // 生成详细错误信息
          const totalDuration = Math.round((Date.now() - skillStartTime) / 60000);
          const detailedError = `Skill "${skill.name}" 执行超时中止:\n` +
            `• 超时阈值: ${SKILL_TIMEOUT_MS / 60000} 分钟/次\n` +
            `• 询问次数: ${MAX_INQUIRIES} 次（已全部无响应）\n` +
            `• 总执行时间: ${totalDuration} 分钟\n` +
            `• 输出长度: ${accumulatedAssistantText.length} 字符\n` +
            `• 输入Token: ${skillInputTokens}, 输出Token: ${skillOutputTokens}\n` +
            `• 可能原因: MCP工具响应慢、任务复杂、网络超时\n` +
            `• 建议: 检查MCP服务器状态，增加超时时间，简化任务`;
          
          await this.updateSkillExecutionStatus(executionId, skill.skillId, 'failed', skillStartTime, detailedError);
          skillResults.push({
            skillName: skill.name,
            skillId: skill.skillId,
            executionId,
            status: 'failed',
            text: accumulatedAssistantText,
            error: detailedError,
          });
          continue;
        }
        
        console.log(`[executeMultiSkillNode] ✅ skillAgent.loop() 返回: ${skill.name}, completionReason=${result.completionReason}, iterations=${result.iterations}, textLength=${result.text?.length || 0}`);
        
        this.currentAgent = null;
        
        // 停止进度监控定时器（skill 执行完成）
        stopProgressMonitor();
        
        // 检查执行结果
        if (result.completionReason === 'aborted') {
          console.log(`[executeMultiSkillNode] Skill ${skill.name} 被中止`);
          
          // 更新 SkillExecution 为失败
          await this.updateSkillExecutionStatus(executionId, skill.skillId, 'failed', skillStartTime, '用户中止');
          
          skillResults.push({
            skillName: skill.name,
            skillId: skill.skillId,
            executionId,
            status: 'failed',
            text: accumulatedAssistantText,
            error: '用户中止',
          });
          
          continue;
        }
        
        // Skill 执行成功
        console.log(`[executeMultiSkillNode] Skill ${skill.name} 执行完成: completionReason=${result.completionReason}, iterations=${result.iterations}, textLength=${accumulatedAssistantText.length}`);
        
        totalIterations += result.iterations;
        
        // 如果 onComplete 回调中已更新，跳过
        if (!skillCompletedInCallback) {
          console.log(`[executeMultiSkillNode] loop() 返回后更新状态: executionId=${executionId}, status=completed`);
          await this.updateSkillExecutionStatus(executionId, skill.skillId, 'completed', skillStartTime, accumulatedAssistantText);
        } else {
          console.log(`[executeMultiSkillNode] onComplete 已更新状态，跳过`);
        }
        
        skillResults.push({
          skillName: skill.name,
          skillId: skill.skillId,
          executionId,
          status: 'completed',
          text: accumulatedAssistantText,
        });
        
      } catch (skillError) {
        const err = skillError instanceof Error ? skillError : new Error(String(skillError));
        console.error(`[executeMultiSkillNode] Skill ${skill.name} 执行异常: ${err.message}`);
        
        this.currentAgent = null;
        
        // 停止进度监控定时器（skill 执行异常）
        stopProgressMonitor();
        
        // 更新 SkillExecution 为失败
        await this.updateSkillExecutionStatus(executionId, skill.skillId, 'failed', skillStartTime, err.message);
        
        skillResults.push({
          skillName: skill.name,
          skillId: skill.skillId,
          executionId,
          status: 'failed',
          text: accumulatedAssistantText,
          error: err.message,
        });
        
        // 继续执行下一个 skill（不中断整个节点）
        console.log(`[executeMultiSkillNode] Skill ${skill.name} 失败，继续执行下一个 Skill`);
      }
    }
    
    // 检查是否所有 skill 都执行完成
    const completedCount = skillResults.filter(r => r.status === 'completed').length;
    const failedCount = skillResults.filter(r => r.status === 'failed').length;
    
    // 停止进度监控定时器（所有 skill 执行完成）
    stopProgressMonitor();
    
    console.log(`[executeMultiSkillNode] 串行执行完成: ${completedCount} 成功, ${failedCount} 失败`);
    
    // 确定节点状态
    const nodeStatus: NodeExecutionStatus = this.aborted 
      ? 'failed' 
      : (failedCount > 0 && completedCount === 0) 
        ? 'failed' 
        : 'completed';
    
    // 合并所有 skill 的输出文本
    const combinedOutput = skillResults
      .map(r => `## ${r.skillName}\n\n${r.text}`)
      .join('\n\n---\n\n');
    
    // 写入 YAML 输出
    const outputYamlPath = await this.writeNodeOutput(nodeIndex, node, combinedOutput);
    
    const nodeResult: NodeExecutionResult = {
      nodeIndex,
      nodeId,
      nodeName,
      status: nodeStatus,
      outputYamlPath,
      iterations: totalIterations,
      retryCount: 0,
      duration: Date.now() - nodeStartTime,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      modelName: this.getModelNameStr(modelConfig),
      modelConfigId: modelConfig.id,
      error: failedCount > 0 ? `${failedCount} 个 Skill 执行失败` : undefined,
      errorStack: undefined,
    };
    
    // 调用节点完成回调
    await this.callbacks.onNodeComplete(nodeIndex, nodeResult);
    
    // 保存节点执行记录到数据库
    await this.saveNodeExecutionToDB(nodeIndex, node, nodeResult, modelConfig);
    
    // 清空当前追踪
    this.currentSkillExecutionIds = [];
    this.currentSkillIds = [];
    
    return nodeResult;
  }

  /**
   * 创建 Skill 专属的 Agent
   * 
   * 为每个 skill 创建独立的 agent，使用 skill.content 作为 system prompt
   */
  private async createSkillAgent(
    modelConfig: ModelConfigForExecution,
    node: UnifiedNodeDefinition,
    skillName: string
  ): Promise<RalphLoopAgent> {
    console.log(`[createSkillAgent] Creating agent for skill: ${skillName}`);
    console.log(`[createSkillAgent] Model: ${modelConfig.name}`);
    console.log(`[createSkillAgent] WorkflowNodeId: ${node.id}`);
    
    // 默认工具列表
    const defaultAllowedTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash', 'Skill'];
    
    // 添加 MCP 工具名称到 allowedTools（必须！否则 SDK 不注册 MCP 工具）
    const mcpToolNames: string[] = [];
    if (this.config.mcpServers && this.config.mcpServers.length > 0) {
      for (const mcp of this.config.mcpServers) {
        // 使用 mcp__{serverName}__* 格式授权所有 MCP 工具
        // 不依赖 mcp.tools 字段（可能为空）
        mcpToolNames.push(`mcp__${mcp.name}__*`);
        
        // 如果有具体的工具列表，也添加具体的工具名称
        if (mcp.tools && Array.isArray(mcp.tools)) {
          for (const tool of mcp.tools) {
            const toolName = typeof tool === 'string' ? tool : tool.name;
            const mcpToolName = `mcp__${mcp.name}__${toolName}`;
            mcpToolNames.push(mcpToolName);
          }
        }
      }
      console.log(`[createSkillAgent] MCP 工具名称: ${mcpToolNames.join(', ')}`);
    }
    
    // 减去被 deny 的工具
    const deniedTools = this.config.toolPermissions
      ? this.config.toolPermissions.filter(p => p.permission === 'deny').map(p => p.toolPattern)
      : [];
    
    // 合并默认工具 + MCP 工具，过滤 denied
    const allowedTools = [...defaultAllowedTools, ...mcpToolNames].filter(tool => !deniedTools.includes(tool));
    
    console.log(`[createSkillAgent] 默认工具: ${defaultAllowedTools.join(', ')}`);
    console.log(`[createSkillAgent] MCP 工具: ${mcpToolNames.join(', ')}`);
    console.log(`[createSkillAgent] 拒绝工具: ${deniedTools.join(', ')}`);
    console.log(`[createSkillAgent] 最终工具: ${allowedTools.join(', ')}`);
    
    const mcpServers = this.config.mcpServers;
    
    const systemPrompt = `你是安全检测专家。执行 ${skillName} 检测任务。

## 重要：工具使用规则
skill 内容中指定的 MCP 工具是**必须使用**的，禁止使用其他替代工具。

ai4java MCP 工具：
- mcp__ai4java__decompileProject：反编译项目
- mcp__ai4java__scanClassMethodSource：扫描方法源码
- mcp__ai4java__scanClassMethodAllPathSources：扫描调用链

禁止使用 Glob/Grep 等通用工具替代 MCP 工具。`;
    
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
        verifyCompletion: ({ result }: any) => {
          const text = result.text || '';
          const completionKeywords = ['任务完成', '评估完成', '检测完成', 'completed', 'done', 'finished'];
          const hasCompletionKeyword = completionKeywords.some(keyword => 
            text.toLowerCase().includes(keyword.toLowerCase())
          );
          if (hasCompletionKeyword) {
            return { complete: true, reason: '检测到完成关键词' };
          }
          return { complete: false };
        },
      },
      {
        systemPrompt,
        toolPermissions: this.config.toolPermissions,
        permissionMode: this.config.toolPermissions ? 'default' : 'bypassPermissions',
        allowDangerouslySkipPermissions: !this.config.toolPermissions,
        workflowNodeId: node.id,
        allowedTools,
        skills: [skillName],
        mcpServers,
        settingSources: ['project'],
      }
    );
  }

  /**
   * 更新 SkillExecution 状态
   * 
   * 将 SkillExecution 的状态更新为 completed 或 failed
   */
  private async updateSkillExecutionStatus(
    executionId: string,
    skillId: string,
    status: 'completed' | 'failed',
    startTime: number,
    outputOrError: string
  ): Promise<void> {
    const completedAt = new Date();
    const duration = completedAt.getTime() - startTime;
    
    console.log(`[updateSkillExecutionStatus] 开始更新: executionId=${executionId}, skillId=${skillId}, status=${status}, duration=${duration}ms`);
    
    try {
      const result = await prisma.skillExecution.update({
        where: { id: executionId },
        data: {
          status,
          completedAt,
          duration,
          output: status === 'completed' ? outputOrError.substring(0, 500) : undefined,
          error: status === 'failed' ? outputOrError : undefined,
        },
      });
      
      console.log(`[updateSkillExecutionStatus] ✅ 更新成功: executionId=${executionId}, status=${result.status}, completedAt=${result.completedAt}`);
      
    } catch (updateError) {
      console.error(`[updateSkillExecutionStatus] ❌ 更新失败: executionId=${executionId}`, updateError);
    }
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
    const baseTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash', 'Skill'];
    
// 添加 MCP 工具名称到 allowedTools（必须！否则 SDK 不注册 MCP 工具）
    const mcpToolNames: string[] = [];
    if (this.config.mcpServers && this.config.mcpServers.length > 0) {
      for (const mcp of this.config.mcpServers) {
        // 使用 mcp__{serverName}__* 格式授权所有 MCP 工具
        mcpToolNames.push(`mcp__${mcp.name}__*`);
        
        // 如果有具体的工具列表，也添加具体的工具名称
        if (mcp.tools && Array.isArray(mcp.tools)) {
          for (const tool of mcp.tools) {
            const toolName = typeof tool === 'string' ? tool : tool.name;
            const mcpToolName = `mcp__${mcp.name}__${toolName}`;
            mcpToolNames.push(mcpToolName);
          }
        }
      }
    }
    
    // 合并基础工具 + MCP 工具
    const allowedTools = [...baseTools, ...mcpToolNames];
    
    console.log(`[createNodeAgent] MCP 工具名称: ${mcpToolNames.join(', ')}`);
    console.log(`[createNodeAgent] allowedTools: ${allowedTools.join(', ')}`);
    
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
        // 使用 toolPermissions 配置权限，而不是强制 bypass
        toolPermissions: this.config.toolPermissions,
        permissionMode: this.config.toolPermissions ? 'default' : 'bypassPermissions',
        allowDangerouslySkipPermissions: !this.config.toolPermissions,  // 只有未配置权限时才跳过
        workflowNodeId: node.id,  // 传递 workflowNodeId，用于保存 session_id
        allowedTools,  // 父 Agent 工具权限
        skills: skillNames.length > 0 ? skillNames : undefined,  // 父 Agent 注册 Skills
        mcpServers,  // 父 Agent MCP 服务器配置
        agents,  // 子 Agent 定义（总是传递，让子 Agent 继承所有父配置）
        settingSources: ['project'],  // 加载项目级 CLAUDE.md，子 Agent 自动继承
      }
    );
    
    console.log(`[createNodeAgent] systemPrompt 传递完成: length=${this.config.systemPrompt?.length || 0}, preview=${(this.config.systemPrompt || '').substring(0, 100)}...`);
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
        // 过滤条件：isActive + isLatest + 技术栈匹配
        const whereClause: any = {
          isActive: true,
          isLatest: true,  // 必须是最新的版本
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
        
        console.log(`[getNodeSkills] 查询到 ${skills.length} 个匹配漏洞分类的 Skills (isActive + isLatest + 技术栈)`);
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
        node.description ||  '开始执行';
    } else if (nodeType === 'end') {
      // 结束节点：使用 workflowConfig.endNodeDescription
      nodeDescription = this.config.workflowConfig?.endNodeDescription || 
        node.description || '结束工作流执行，汇总所有结果';
    } else if (nodeType === 'fsm_phase' && node.fsmPhase) {
      // FSM Phase 节点：优先读取 Skill 文件内容
      // 如果 skillPath 为 null（如渗透测试节点），使用 description
      if (node.skillPath) {
        try {
          nodeDescription = await this.loadFSMPhaseSkillContent(node);
        } catch (error) {
          // Skill 文件读取失败，使用 description 作为 fallback
          const err = error instanceof Error ? error : new Error(String(error));
          console.warn(`[buildNodePrompt] FSM Phase ${node.label} Skill 文件读取失败，使用 description:`, err.message);
          nodeDescription = node.description || '执行节点任务';
        }
      } else {
        // skillPath 为 null（如渗透测试节点），使用 description
        console.log(`[buildNodePrompt] FSM Phase ${node.label} 无 skillPath，使用 description: ${node.description || '无描述'}`);
        nodeDescription = node.description || '执行节点任务';
      }
    } else {
      // 其他节点：使用 node.description 或 node.data
      nodeDescription = node.description || 
        (node.data?.description as string) || 
        (node.data?.taskDescription as string) || 
        '执行节点任务';
    }

    // FSM Phase：Skill 文件已经包含完整的执行指令，直接使用
    // Skill 文件内容格式: "# Phase 1: Project Understanding..."
    // 
    // 特殊情况：skillPath 为 null 的节点（如渗透测试）需要走自定义流程逻辑
    // - 查询 skills/vulnerabilityCategories 配置
    // - 根据 Skills 生成第一条消息
    if (nodeType === 'fsm_phase') {
      // skillPath 为 null 的节点（如渗透测试）走自定义流程逻辑
      if (!node.skillPath) {
        console.log(`[buildNodePrompt] FSM Phase ${node.label} 无 skillPath，走自定义流程逻辑`);
        
        // 获取节点配置的 Skills（用户编排）
        const skills = await this.getNodeSkills(node);
        const nodeData = node.data as Record<string, unknown> | undefined;
        const mode = (nodeData?.skillLoadingMode as string) || 'description';
        
        let prompt = '';
        
        if (mode === 'description' || skills.length === 0) {
          // description 模式或无 Skills：直接用用户写的描述 + 项目上下文
          prompt = `
${nodeDescription}

---

## 项目上下文

### 项目信息
- 项目名称: ${this.config.projectName}
- 项目路径: ${this.config.workspacePath}

### 前序节点输出
${previousOutputs || '(首个节点，无前序输出)'}
`;
          console.log(`[buildNodePrompt] FSM Phase description 模式，提示词: ${prompt.slice(0, 100)}...`);
        } else {
		throw new Error(`废弃代码2222`);
          // manual 或 vulnerability 模式：根据 Skills 生成提示词（和自定义流程一样）
          prompt = `请执行以下安全检查任务，必须执行下面指定的所有 Skills：

${skills.map((s, i) => `${i + 1}. ${s.displayName}`).join('\n')}

---

## 项目上下文

### 项目信息
- 项目名称: ${this.config.projectName}
- 项目路径: ${this.config.workspacePath}

### 前序节点输出
${previousOutputs || '(首个节点，无前序输出)'}
`;
          console.log(`[buildNodePrompt] FSM Phase ${mode} 模式，生成 Skills 提示词，共 ${skills.length} 个 Skills`);
        }
        
        return prompt;
      }
      
      // skillPath 有值：读取 Skill 文件内容
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
	throw new Error(`废弃代码1111`);
      // manual 或 vulnerability 模式：根据 Skills 生成提示词
      prompt = `请执行以下安全检查任务，必须执行下面指定的所有 Skills：

${skills.map((s, i) => `${i + 1}. ${s.displayName}`).join('\n')}

请确保以上所有 Skills 都被执行，不要遗漏。

### 重要要求 ，必须严格按下面的要求执行。
请将任务分解成TODO列表，每个TODO用子代理（Subagent）执行，每个Subagent要独立运行，你的任务只有创建Subagent与监督Subagent进展，你禁止与项目经理干不相关的事，Subagent没有达到的你设定的目标，必须让Subagent重新执行。
`;
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

      // 检查 modelConfigId 是否存在（避免外键约束失败）
      let safeModelConfigId: string | null = null;
      if (modelConfig.id) {
        try {
          const modelExists = await prisma.modelConfig.findUnique({
            where: { id: modelConfig.id },
            select: { id: true },
          });
          if (modelExists) {
            safeModelConfigId = modelConfig.id;
          } else {
            console.warn(`[saveNodeExecutionToDB] modelConfigId ${modelConfig.id} 不存在于数据库，跳过外键更新`);
          }
        } catch (e) {
          console.warn(`[saveNodeExecutionToDB] 检查 modelConfigId 失败:`, e);
        }
      }

      const data = {
        evaluationSessionId: this.config.evaluationSessionId,
        workflowNodeId: node.id,
        nodeLabel: node.label,
        nodeType: node.fsmPhase ? 'fsm_phase' : (node.type || 'custom'),
        status: result.status,
        // startedAt 应由 createNodeExecutionRecord 设置，这里用 startTime 作为默认值（仅用于创建新记录）
        // 注意：如果 existing 存在，不会覆盖 startedAt
        startedAt: this.startTime,  // 使用工作流开始时间作为基准
        completedAt: new Date(),
        updatedAt: new Date(),
        order: nodeIndex,
        modelConfigId: safeModelConfigId,  // 使用安全的 modelConfigId
        modelName: this.getModelNameStr(modelConfig),
        roleId: node.roleId ?? undefined,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
      };

      if (existing) {
        // 更新现有记录
        const updateData: any = {
          status: result.status,
          completedAt: new Date(),
          updatedAt: new Date(),
          modelName: this.getModelNameStr(modelConfig),  // modelName 无外键约束，安全写入
          inputTokens: result.inputTokens || 0,
          outputTokens: result.outputTokens || 0,
        };
        
        // 只有 modelConfigId 存在时才写入（避免外键约束）
        if (safeModelConfigId) {
          updateData.modelConfigId = safeModelConfigId;
        }
        
        // ⚠️ 不覆盖 startedAt - 它由 createNodeExecutionRecord 设置（节点实际开始时间）
        // 如果 startedAt 为空（异常情况），用当前时间作为 fallback
        if (!existing.startedAt) {
          updateData.startedAt = new Date(Date.now() - result.duration);  // 从完成时间倒推开始时间
          console.log(`[saveNodeExecutionToDB] startedAt 为空，倒推设置: ${node.label}`);
        }
        
        await prisma.nodeExecution.update({
          where: { id: existing.id },
          data: updateData,
        });
        console.log(`[saveNodeExecutionToDB] 更新节点执行记录成功: ${node.label}, status=${result.status}`);
      } else {
        // 创建新记录
        await prisma.nodeExecution.create({
          data: {
            id: `node-exec-${this.config.evaluationSessionId}-${nodeIndex}`,
            ...data,
          },
        });
        console.log(`[saveNodeExecutionToDB] 创建节点执行记录成功: ${node.label}, status=${result.status}`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[saveNodeExecutionToDB] 保存失败:`, err.message, err.stack);
      // 记录错误到会话（但不阻塞执行）
      await this.recordDatabaseError('saveNodeExecutionToDB', err, node.label);
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
    
    console.log(`[createSkillExecutions] 节点 ${node.label} 的 skills: ${JSON.stringify(skills)}`);
    
    for (const skillIdOrName of skills) {
      try {
        // 尝试多种查找方式：skillId（精确匹配）或 skillName（模糊匹配）
        let skill = await prisma.skill.findUnique({
          where: { id: skillIdOrName },
          select: { id: true, name: true, displayName: true },
        });
        
        // 如果用 ID 找不到，尝试用 name 查找
        if (!skill) {
          skill = await prisma.skill.findFirst({
            where: { name: skillIdOrName, isLatest: true },
            select: { id: true, name: true, displayName: true },
          });
        }
        
        if (!skill) {
          console.warn(`[createSkillExecutions] Skill 未找到: ${skillIdOrName}`);
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
        
        console.log(`[createSkillExecutions] Skill 执行记录已创建: ${skill.name} (${skill.displayName}), executionId=${executionId}`);
      } catch (error) {
        console.error(`[createSkillExecutions] 创建 Skill 执行记录失败: ${skillIdOrName}`, error);
      }
    }
    
    console.log(`[createSkillExecutions] 共创建 ${this.currentSkillExecutionIds.length} 条 SkillExecution 记录`);
  }

  /**
   * 创建单个 Skill 执行记录（Skill 工具调用时立即创建，精确时间）
   */
  private async createSingleSkillExecution(
    skillName: string,
    toolUseId: string,
    nodeIndex: number,
    nodeName: string
  ): Promise<void> {
    try {
      // 查找 Skill
      let skill = await prisma.skill.findFirst({
        where: { name: skillName, isLatest: true },
        select: { id: true, name: true, displayName: true },
      });
      
      if (!skill) {
        // 尝试用 displayName 查找
        skill = await prisma.skill.findFirst({
          where: { displayName: skillName, isLatest: true },
          select: { id: true, name: true, displayName: true },
        });
      }
      
      if (!skill) {
        console.warn(`[createSingleSkillExecution] Skill 未找到: ${skillName}`);
        return;
      }
      
      // 创建 SkillExecution 记录
      const executionId = `sklexec-${this.config.evaluationSessionId}-${nodeIndex}-${toolUseId}`;
      await prisma.skillExecution.create({
        data: {
          id: executionId,
          skillId: skill.id,
          projectId: this.config.projectId,
          evaluationId: this.config.evaluationSessionId,
          input: JSON.stringify({ nodeName, nodeIndex, skillName }),
          status: 'running',
          startedAt: new Date(),
        },
      });
      
      // 更新 Skill 的 execCount
      await prisma.skill.update({
        where: { id: skill.id },
        data: { execCount: { increment: 1 }, updatedAt: new Date() },
      });
      
      // 记录 Skill 名称到 executionId 的映射（用于 Agent 工具结果匹配）
      this.skillNameToExecutionId.set(skill.name, executionId);
      this.currentExecutingSkills.set(skill.name, {
        executionId,
        skillId: skill.id,
        skillName: skill.name,
        toolUseId,
        startTime: Date.now()
      });
      
      // 同时加入列表（节点完成时统计）
      this.currentSkillExecutionIds.push(executionId);
      this.currentSkillIds.push(skill.id);
      
      console.log(`[createSingleSkillExecution] Skill 执行记录已创建: ${skill.name}, executionId=${executionId}, startedAt=${new Date().toISOString()}`);
    } catch (error) {
      console.error(`[createSingleSkillExecution] 创建失败: ${skillName}`, error);
    }
  }

  /**
   * Agent 工具返回时完成对应的 SkillExecution（精确时间）
   * 
   * 当 Agent 工具结果返回时，根据 toolUseId 找到对应的 SkillExecution 并完成
   * completedAt = Agent 工具结果返回时间（子 Agent 完成时间）
   */
  private async completeSingleSkillExecutionByAgent(
    executionId: string,
    toolUseId: string,
    content: any,
    isError: boolean
  ): Promise<void> {
    try {
      const completedAt = new Date();
      
      // 获取 startedAt 计算 duration
      const existing = await prisma.skillExecution.findUnique({
        where: { id: executionId },
        select: { startedAt: true, skillId: true },
      });
      
      if (!existing) {
        console.warn(`[completeSingleSkillExecutionByAgent] SkillExecution 不存在: ${executionId}`);
        return;
      }
      
      const duration = existing.startedAt
        ? completedAt.getTime() - new Date(existing.startedAt).getTime()
        : 0;
      
      // 解析结果中的漏洞数量
      const resultStr = typeof content === 'string' ? content : JSON.stringify(content);
      const findingsMatch = resultStr.match(/发现\s*(\d+)\s*个|found\s*(\d+)\s*vulnerabilit/i);
      const findingsCount = findingsMatch ? (parseInt(findingsMatch[1]) || parseInt(findingsMatch[2]) || 0) : 0;
      
      // 更新 SkillExecution
      await prisma.skillExecution.update({
        where: { id: executionId },
        data: {
          status: isError ? 'failed' : 'completed',
          completedAt,
          duration,
          output: resultStr.substring(0, 500),
          findingsCount,
          updatedAt: completedAt,
        },
      });
      
      // 更新 Skill 的 vulnerabilityCount
      if (findingsCount > 0 && existing.skillId) {
        await prisma.skill.update({
          where: { id: existing.skillId },
          data: { vulnerabilityCount: { increment: findingsCount }, updatedAt: completedAt },
        });
      }
      
      console.log(`[completeSingleSkillExecutionByAgent] Skill 执行完成: executionId=${executionId}, findings=${findingsCount}, duration=${duration}ms, completedAt=${completedAt.toISOString()}`);
      
      // 从列表中移除（避免节点完成时重复处理）
      const index = this.currentSkillExecutionIds.indexOf(executionId);
      if (index > -1) {
        this.currentSkillExecutionIds.splice(index, 1);
        this.currentSkillIds.splice(index, 1);
      }
    } catch (error) {
      console.error(`[completeSingleSkillExecutionByAgent] 完成失败:`, error);
    }
  }

  /**
   * 完成 SkillExecution 记录（节点完成时统一完成所有记录）
   * 
   * 统计该节点发现的漏洞数量，更新 findingsCount
   * completedAt = 节点完成时间（Skill 实际执行结束时间）
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
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[updateSessionStatus] 更新失败:`, err.message, err.stack);
      // 会话状态更新失败是严重问题，记录错误
      await this.recordDatabaseError('updateSessionStatus', err, `status=${status}`);
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

    // 添加数据库操作错误汇总
    if (this.databaseErrors.length > 0) {
      message += `\n⚠️ 数据库状态更新错误 (${this.databaseErrors.length} 个):\n`;
      for (const err of this.databaseErrors.slice(0, 5)) {
        message += `- ${err}\n`;
      }
      if (this.databaseErrors.length > 5) {
        message += `- ...还有 ${this.databaseErrors.length - 5} 个错误\n`;
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
      modelName: this.getModelNameStr(modelConfig),
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
      
      // 检查 modelConfigId 是否存在（避免外键约束失败）
      let safeModelConfigId: string | null = null;
      if (modelConfig.id) {
        try {
          const modelExists = await prisma.modelConfig.findUnique({
            where: { id: modelConfig.id },
            select: { id: true },
          });
          if (modelExists) {
            safeModelConfigId = modelConfig.id;
          } else {
            console.warn(`[createNodeExecutionRecord] modelConfigId ${modelConfig.id} 不存在于数据库，跳过外键更新`);
          }
        } catch (e) {
          console.warn(`[createNodeExecutionRecord] 检查 modelConfigId 失败:`, e);
        }
      }
      
      if (existing) {
        // 已存在，更新状态为 running，确保 startedAt 被设置
        const updateData: any = {
          status: 'running',
          updatedAt: now,
          modelName: this.getModelNameStr(modelConfig),  // modelName 无外键约束，安全写入
        };
        
        // 只有 modelConfigId 存在时才写入（避免外键约束）
        if (safeModelConfigId) {
          updateData.modelConfigId = safeModelConfigId;
        }
        
        // 如果 startedAt 未设置，现在设置（强制设置）
        updateData.startedAt = now;
        console.log(`[createNodeExecutionRecord] 设置 startedAt: ${node.label}`);
        
        await prisma.nodeExecution.update({
          where: { id: existing.id },
          data: updateData,
        });
        console.log(`[createNodeExecutionRecord] 更新节点记录成功: ${node.label}, status=running, startedAt=${now.toISOString()}`);
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
            modelConfigId: safeModelConfigId,  // 使用安全的 modelConfigId
            modelName: this.getModelNameStr(modelConfig),
            roleId: node.roleId ?? undefined,
            inputTokens: 0,
            outputTokens: 0,
          },
        });
        console.log(`[createNodeExecutionRecord] 创建节点记录成功: ${node.label}, status=running, startedAt=${now.toISOString()}`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[createNodeExecutionRecord] 创建失败:`, err.message, err.stack);
      // 记录错误到会话（但不阻塞执行）
      await this.recordDatabaseError('createNodeExecutionRecord', err, node.label);
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
      // Token 更新失败不记录到会话，因为这是次要操作
    }
  }

  /**
   * 记录数据库操作失败到会话 endMessage
   * 
   * 不抛出错误，不阻塞执行，但会在最终 endMessage 中标记"状态更新部分失败"
   */
  private databaseErrors: string[] = [];
  
  private async recordDatabaseError(operation: string, error: Error, nodeInfo?: string): Promise<void> {
    const errorMsg = `${operation}${nodeInfo ? ` (${nodeInfo})` : ''}: ${error.message}`;
    this.databaseErrors.push(errorMsg);
    
    // 记录数量，超过阈值时更新会话 endMessage
    if (this.databaseErrors.length >= 3) {
      try {
        const warningMsg = `⚠️ 状态更新部分失败 (${this.databaseErrors.length} 个操作): ${this.databaseErrors.slice(0, 3).join('; ')}...`;
        await prisma.evaluationSession.update({
          where: { id: this.config.evaluationSessionId },
          data: {
            endMessage: warningMsg,
            updatedAt: new Date(),
          },
        });
        console.warn(`[recordDatabaseError] 已记录 ${this.databaseErrors.length} 个数据库错误到会话 endMessage`);
      } catch (updateErr) {
        console.error(`[recordDatabaseError] 更新会话 endMessage 失败:`, updateErr);
      }
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