/**
 * FSM Workflow Execution Service
 * 
 * Orchestrates FSM workflow execution using UnifiedWorkflowExecutionEngine.
 * Preserves FSM-specific features: Agent Zone, FSM Template loading, Report generation.
 */

import { prisma } from '@/lib/prisma';
import { RalphLoopAgent, createRalphLoopAgent } from '@/services/evaluation';
import { 
  UnifiedWorkflowExecutionEngine, 
  createUnifiedExecutionEngine 
} from '@/lib/workflow/unified-execution-engine';
import type {
  UnifiedNodeDefinition,
  UnifiedExecutionConfig,
  UnifiedExecutionCallbacks,
  NodeExecutionResult,
  WorkflowExecutionResult,
  ModelConfigForExecution,
  McpServerConfigForExecution,
} from '@/lib/workflow/types';
import { loadFSMSkill } from './fsm-skill-loader';
import { loadMcpServersForProject } from '@/lib/mcp-loader';
import { generateIndexedId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';
import type { FSMTemplate } from '@prisma/client';

// FSM 验证结果
export interface FSMPhaseVerificationResult {
  complete: boolean;
  reason: string;
  outputYaml?: string;
  errors?: string[];
}

// FSM 执行配置
export interface FSMExecutionConfig {
  evaluationSessionId: string;
  projectId: string;
  workflowId: string;
  fsmTemplateId: string;
  workspacePath: string;
  maxIterationsPerPhase: number;
  maxCostPerPhase: number;
  modelConfig: {
    providerType: string;
    apiKey: string;
    apiBaseUrl: string;
    models: string;
  };
  systemPrompt?: string;  // 系统提示词
  roleModels?: { roleId: string; modelId: string }[];  // 角色模型配置
  userId?: string;  // 用户 ID（用于加载 MCP 配置）
  mcpServers?: McpServerConfigForExecution[];  // MCP 服务器配置（可选，若传入则使用）
}

// FSM 执行回调
export interface FSMExecutionCallbacks {
  onPhaseStart: (phase: number, phaseName: string) => void | Promise<void>;
  onPhaseChunk: (phase: number, text: string) => void;
  onPhaseToolCall: (phase: number, tool: string, args: Record<string, unknown>) => void;
  onPhaseComplete: (phase: number, result: FSMPhaseResult) => void | Promise<void>;
  onPhaseError: (phase: number, error: Error) => void;
  onAgentZoneStart: (agents: string[]) => void | Promise<void>;
  onAgentZoneProgress: (agent: string, status: 'running' | 'completed' | 'failed') => void;
  onAgentZoneComplete: (results: AgentZoneResult[]) => void | Promise<void>;
  onWorkflowComplete: (result: FSMWorkflowResult) => void | Promise<void>;
  onWorkflowError: (error: Error) => void;
  // 实时 token 使用量和模型信息推送
  onTokenUsage?: (data: {
    phase: number;
    phaseName: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cumulativeInputTokens: number;
    cumulativeOutputTokens: number;
    cumulativeTotalTokens: number;
  }) => void;
}

// FSM 阶段执行结果
export interface FSMPhaseResult {
  phaseNumber: number;
  phaseName: string;
  status: 'completed' | 'failed' | 'skipped';
  outputYaml: string;
  outputPath: string;
  iterations: number;
  duration: number;
  inputTokens: number;   // 输入 token 数
  outputTokens: number;  // 输出 token 数
  totalTokens: number;   // 总 token 数（input + output）
  cost: number;
}

// Agent Zone 执行结果
export interface AgentZoneResult {
  agentName: string;
  agentType: string;
  status: 'completed' | 'failed';
  vulnerabilitiesFound: number;
  outputPath: string;
  duration: number;
}

// FSM 工作流执行结果
export interface FSMWorkflowResult {
  sessionId: string;
  projectId: string;
  workflowId: string;
  status: 'completed' | 'failed' | 'partial';
  phaseResults: FSMPhaseResult[];
  agentZoneResults: AgentZoneResult[];
  totalDuration: number;
  totalCost: number;
  totalInputTokens: number;   // 总输入 token 数
  totalOutputTokens: number;  // 总输出 token 数
  totalTokens: number;        // 总 token 数（input + output）
  generatedReports: string[];
}

// FSM 阶段定义（从 FSMTemplate.nodes JSON 解析）
interface FSMPhaseDefinition {
  id: string;
  label: string;
  phases?: string[] | string;  // 可能是数组或单个字符串
  phase?: string;  // 单个阶段标识，如 "P1"
  fsmPhase: number;
  description?: string;
  skillPath?: string;  // 节点特定的 Skill 路径
  roleId?: string;
}

// Agent Zone 配置
interface AgentZoneConfig {
  position: number;
  allowAdd: boolean;
  parallel: boolean;
  defaultAgents: Array<{
    name: string;
    type: string;
    skillPath?: string;
  }>;
}

/**
 * FSM Workflow Execution Service
 * 
 * 使用 UnifiedWorkflowExecutionEngine 执行 FSM Phase 1-4，
 * 保留 FSM 特有的 Agent Zone 功能。
 */
export class FSMWorkflowExecutionService {
  private config: FSMExecutionConfig;
  private callbacks: FSMExecutionCallbacks;
  private fsmTemplate: FSMTemplate | null = null;
  private phaseOutputs: Map<number, FSMPhaseResult> = new Map();
  private aborted: boolean = false;
  private unifiedEngine: UnifiedWorkflowExecutionEngine | null = null;
  private currentAgentZoneAgent: RalphLoopAgent | null = null;

  constructor(config: FSMExecutionConfig, callbacks: FSMExecutionCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * 执行 FSM 工作流
   */
  async execute(): Promise<FSMWorkflowResult> {
    const startTime = Date.now();

    try {
      // 1. 加载 FSM 模板
      this.fsmTemplate = await this.loadFSMTemplate();
      if (!this.fsmTemplate) {
        throw new Error('FSM Template not found');
      }

      const nodes = JSON.parse(this.fsmTemplate.nodes) as FSMPhaseDefinition[];
      const agentZone = this.fsmTemplate.agentZone 
        ? JSON.parse(this.fsmTemplate.agentZone) as AgentZoneConfig 
        : null;

      // 2. 加载 Skill 内容到 workspace
      if (this.fsmTemplate.skillPath) {
        console.log(`[execute] Loading FSM Skill, template name: ${this.fsmTemplate.name}`);
        console.log(`[execute] Session ID: ${this.config.evaluationSessionId}`);
        console.log(`[execute] Workspace: ${this.config.workspacePath}`);
        
        const loadResult = await loadFSMSkill(
          this.fsmTemplate.name,
          this.config.evaluationSessionId,
          this.config.workspacePath
        );
        
        console.log(`[execute] loadFSMSkill result:`, loadResult);
        
        if (!loadResult.success) {
          logger.error(LOG_MODULES.FSM, `Failed to load FSM Skill: ${loadResult.error}`);
        }
      }

      // 3. 转换 FSM 节点为 UnifiedNodeDefinition
      const unifiedNodes = this.convertFSMNodesToUnified(nodes);

      // 4. 创建统一执行引擎配置（异步加载 MCP）
      const engineConfig = await this.createUnifiedEngineConfig();

      // 5. 创建回调适配器
      const engineCallbacks = this.createEngineCallbacks();

      // 6. 创建并初始化统一执行引擎
      this.unifiedEngine = createUnifiedExecutionEngine(engineConfig, engineCallbacks);
      this.unifiedEngine.setNodes(unifiedNodes);

      // 7. 执行 Phase 1-4
      const engineResult = await this.unifiedEngine.execute();

      // 8. 转换引擎结果为 FSM Phase 结果
      const phaseResults = this.convertEngineResultsToPhaseResults(engineResult.nodeResults, nodes);
      
      // 保存 phase outputs
      for (const result of phaseResults) {
        this.phaseOutputs.set(result.phaseNumber, result);
      }

      // 9. 执行 Agent Zone（如果配置了且未中止）
      let agentZoneResults: AgentZoneResult[] = [];
      if (agentZone && !this.aborted && phaseResults.every(r => r.status === 'completed')) {
        agentZoneResults = await this.executeAgentZone(agentZone, phaseResults);
      }

      // 10. 生成最终结果
      const duration = Date.now() - startTime;
      const status = this.determineStatus(phaseResults, agentZoneResults);
      const totalCost = this.calculateTotalCost(phaseResults);
      // 从 engineResult 获取分离的 tokens（更准确）
      const totalInputTokens = engineResult.totalInputTokens || phaseResults.reduce((sum, r) => sum + r.inputTokens, 0);
      const totalOutputTokens = engineResult.totalOutputTokens || phaseResults.reduce((sum, r) => sum + r.outputTokens, 0);
      const totalTokens = totalInputTokens + totalOutputTokens;

      const result: FSMWorkflowResult = {
        sessionId: this.config.evaluationSessionId,
        projectId: this.config.projectId,
        workflowId: this.config.workflowId,
        status,
        phaseResults,
        agentZoneResults,
        totalDuration: duration,
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        totalTokens,
        generatedReports: [],
      };

      // 11. 生成报告（Phase 4 完成时）
      if (phaseResults.find(r => r.phaseNumber === 4 && r.status === 'completed')) {
        result.generatedReports = await this.generateReports(result);
      }

      await this.callbacks.onWorkflowComplete(result);
      return result;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.callbacks.onWorkflowError(err);
      
      return {
        sessionId: this.config.evaluationSessionId,
        projectId: this.config.projectId,
        workflowId: this.config.workflowId,
        status: 'failed',
        phaseResults: Array.from(this.phaseOutputs.values()),
        agentZoneResults: [],
        totalDuration: Date.now() - startTime,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        generatedReports: [],
      };
    }
  }

  /**
   * 加载 FSM 模板
   */
  private async loadFSMTemplate(): Promise<FSMTemplate | null> {
    return prisma.fSMTemplate.findUnique({
      where: { id: this.config.fsmTemplateId },
    });
  }

  /**
   * 转换 FSM 节点为 UnifiedNodeDefinition
   */
  private convertFSMNodesToUnified(nodes: FSMPhaseDefinition[]): UnifiedNodeDefinition[] {
    return nodes.map(node => ({
      id: node.id,
      label: node.label,
      roleId: node.roleId,
      skillPath: node.skillPath,
      fsmPhase: node.fsmPhase,
      fsmOrder: node.fsmPhase, // FSM 使用 phase 作为顺序
      description: node.description,
      type: 'fsm_phase',
      // 保留 phases 信息用于提示词构建
      data: {
        phases: node.phases,
        phase: node.phase,
      },
    }));
  }

/**
   * 创建统一执行引擎配置
   */
  private async createUnifiedEngineConfig(): Promise<UnifiedExecutionConfig> {
    // FSM 使用父模型配置，所有节点共享同一模型
    // modelConfig 只包含基础字段，需要从 models 解析模型名
    const defaultModelConfig: ModelConfigForExecution = {
      id: 'fsm-default',
      name: this.config.modelConfig.models || 'FSM Model',
      providerType: this.config.modelConfig.providerType,
      apiKey: this.config.modelConfig.apiKey,
      apiBaseUrl: this.config.modelConfig.apiBaseUrl,
      models: this.config.modelConfig.models,
    };

    // 加载 MCP 配置：优先使用传入的配置，否则从数据库加载
    let mcpServers = this.config.mcpServers;
    if (!mcpServers && this.config.userId) {
      mcpServers = await loadMcpServersForProject(this.config.projectId, this.config.userId);
      console.log(`[FSM] 从数据库加载 MCP 配置: ${mcpServers?.length || 0} 个`);
    }

    return {
      evaluationSessionId: this.config.evaluationSessionId,
      projectId: this.config.projectId,
      projectName: this.fsmTemplate?.displayName || 'FSM Workflow',
      workflowId: this.config.workflowId,
      workflowType: 'fsm',
      workspacePath: this.config.workspacePath,
      systemPrompt: this.config.systemPrompt,
      userPrompt: this.fsmTemplate?.description || '',
      roleModels: undefined,  // FSM 不使用角色模型映射，所有节点使用同一父模型
      defaultModelConfig,
      mcpServers,  // MCP 服务器配置
      maxIterationsPerNode: this.config.maxIterationsPerPhase,
      maxRetries: 15, // FSM 默认重试次数
      retryDelayMs: 60000, // 1 分钟重试间隔
      workflowConfig: {
        fsmTemplateSkillPath: this.fsmTemplate?.skillPath || undefined, // 传递 FSM Template skillPath 用于拼接节点 skillPath
      },
    };
  }

  /**
   * 创建回调适配器
   * 将 FSM 回调适配为统一引擎回调
   */
  private createEngineCallbacks(): UnifiedExecutionCallbacks {
    return {
      onNodeStart: async (nodeIndex, nodeId, nodeName) => {
        const phase = nodeIndex + 1;
        await this.callbacks.onPhaseStart(phase, nodeName);
      },
      
      onNodeChunk: (nodeIndex, text) => {
        const phase = nodeIndex + 1;
        this.callbacks.onPhaseChunk(phase, text);
      },
      
      onNodeToolCall: (nodeIndex, tool, args) => {
        const phase = nodeIndex + 1;
        this.callbacks.onPhaseToolCall(phase, tool, args);
      },
      
      onTokenUsage: (data) => {
        const phase = data.nodeIndex + 1;
        if (this.callbacks.onTokenUsage) {
          this.callbacks.onTokenUsage({
            phase,
            phaseName: data.nodeName,
            modelName: data.modelName,
            inputTokens: data.inputTokens,
            outputTokens: data.outputTokens,
            totalTokens: data.totalTokens,
            cumulativeInputTokens: data.cumulativeInputTokens,
            cumulativeOutputTokens: data.cumulativeOutputTokens,
            cumulativeTotalTokens: data.cumulativeTotalTokens,
          });
        }
      },
      
      onNodeRetry: (nodeIndex, nodeId, nodeName, retryCount, maxRetries, error) => {
        const phase = nodeIndex + 1;
        console.log(`[FSM Phase ${phase}] 重试 (${retryCount}/${maxRetries}): ${error.message}`);
      },
      
      onNodeComplete: async (nodeIndex, result) => {
        const phase = nodeIndex + 1;
        // 转换为 FSMPhaseResult
        const phaseResult: FSMPhaseResult = {
          phaseNumber: phase,
          phaseName: result.nodeName,
          status: result.status === 'completed' ? 'completed' : 'failed',
          outputYaml: '', // 从文件读取
          outputPath: result.outputYamlPath || '',
          iterations: result.iterations,
          duration: result.duration,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalTokens: result.inputTokens + result.outputTokens,
          cost: this.calculatePhaseCost({ inputTokens: result.inputTokens, outputTokens: result.outputTokens }),
        };
        
        // 尝试读取 YAML 输出
        if (result.outputYamlPath) {
          try {
            const fs = await import('fs/promises');
            phaseResult.outputYaml = await fs.readFile(result.outputYamlPath, 'utf-8');
          } catch {
            phaseResult.outputYaml = '';
          }
        }
        
        await this.callbacks.onPhaseComplete(phase, phaseResult);
      },
      
      onNodeError: (nodeIndex, nodeId, nodeName, error) => {
        const phase = nodeIndex + 1;
        this.callbacks.onPhaseError(phase, error);
      },
      
      onWorkflowComplete: async (result) => {
        // 不在这里调用 FSM 的 onWorkflowComplete，因为还需要执行 Agent Zone
        console.log(`[FSM] Phase 1-4 执行完成: ${result.status}`);
      },
      
      onWorkflowError: (error) => {
        console.error(`[FSM] Phase 1-4 执行错误: ${error.message}`);
      },
    };
  }

  /**
   * 转换引擎结果为 FSM Phase 结果
   * 正确提取分离的 input/output tokens
   */
  private convertEngineResultsToPhaseResults(
    nodeResults: NodeExecutionResult[],
    nodes: FSMPhaseDefinition[]
  ): FSMPhaseResult[] {
    return nodeResults.map((result, index) => {
      const node = nodes[index];
      const inputTokens = result.inputTokens || 0;
      const outputTokens = result.outputTokens || 0;
      return {
        phaseNumber: node?.fsmPhase || index + 1,
        phaseName: result.nodeName,
        status: result.status === 'completed' ? 'completed' : 'failed',
        outputYaml: '', // 从文件读取
        outputPath: result.outputYamlPath || '',
        iterations: result.iterations,
        duration: result.duration,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cost: this.calculatePhaseCost({ inputTokens, outputTokens }),
      };
    });
  }

  /**
   * 执行 Agent Zone
   * FSM 特有功能：在 Phase 4 完成后执行额外的安全扫描 Agent
   */
  private async executeAgentZone(
    config: AgentZoneConfig,
    phaseResults: FSMPhaseResult[]
  ): Promise<AgentZoneResult[]> {
    await this.callbacks.onAgentZoneStart(config.defaultAgents.map(a => a.name));

    // 构建 Agent Zone 提示词（告知已完成的工作）
    const contextPrompt = this.buildAgentZoneContext(phaseResults);

    const results: AgentZoneResult[] = [];

    // 并行执行所有 Agent
    if (config.parallel) {
      const promises = config.defaultAgents.map(agent => 
        this.executeSingleAgentZoneAgent(agent, contextPrompt)
      );
      
      const settled = await Promise.allSettled(promises);
      
      for (let i = 0; i < settled.length; i++) {
        const agent = config.defaultAgents[i];
        const settledResult = settled[i];
        
        if (settledResult.status === 'fulfilled') {
          results.push(settledResult.value);
          this.callbacks.onAgentZoneProgress(agent.name, 'completed');
        } else {
          results.push({
            agentName: agent.name,
            agentType: agent.type,
            status: 'failed',
            vulnerabilitiesFound: 0,
            outputPath: '',
            duration: 0,
          });
          this.callbacks.onAgentZoneProgress(agent.name, 'failed');
        }
      }
    } else {
      // 顺序执行
      for (const agent of config.defaultAgents) {
        if (this.aborted) break;
        
        this.callbacks.onAgentZoneProgress(agent.name, 'running');
        
        try {
          const result = await this.executeSingleAgentZoneAgent(agent, contextPrompt);
          results.push(result);
          this.callbacks.onAgentZoneProgress(agent.name, 'completed');
        } catch (error) {
          results.push({
            agentName: agent.name,
            agentType: agent.type,
            status: 'failed',
            vulnerabilitiesFound: 0,
            outputPath: '',
            duration: 0,
          });
          this.callbacks.onAgentZoneProgress(agent.name, 'failed');
        }
      }
    }

    await this.callbacks.onAgentZoneComplete(results);
    return results;
  }

  /**
   * 执行单个 Agent Zone Agent
   */
  private async executeSingleAgentZoneAgent(
    agent: { name: string; type: string; skillPath?: string },
    contextPrompt: string
  ): Promise<AgentZoneResult> {
    const startTime = Date.now();

    // 创建专用 Agent
    this.currentAgentZoneAgent = createRalphLoopAgent(
      this.config.modelConfig,
      this.config.workspacePath,
      {
        maxIterations: 5,
        maxCost: 1.0,
      }
    );

    // 执行 Agent
    const result = await this.currentAgentZoneAgent.loop({
      evaluationId: `${this.config.evaluationSessionId}-agentzone-${agent.name}`,
      projectId: this.config.projectId,
      context: {
        projectName: `Agent Zone: ${agent.name}`,
        taskDescription: contextPrompt,
        initialMessage: contextPrompt,
        files: [],
      },
      callbacks: {
        onChunk: () => {},
        onToolCall: () => {},
        onToolResult: () => {},
        onComplete: () => {},
        onError: () => {},
        onRalphComplete: async () => {},
      },
    });

    this.currentAgentZoneAgent = null;

    // 解析漏洞数量
    const vulnCount = this.countVulnerabilitiesInResult(result.text);

    // 写入输出到 vulnerabilities/ 目录
    const outputPath = await this.writeAgentZoneOutput(agent.name, result.text);

    return {
      agentName: agent.name,
      agentType: agent.type,
      status: result.completionReason === 'verified' ? 'completed' : 'failed',
      vulnerabilitiesFound: vulnCount,
      outputPath,
      duration: Date.now() - startTime,
    };
  }

  /**
   * 构建 Agent Zone 上下文提示词
   */
  private buildAgentZoneContext(phaseResults: FSMPhaseResult[]): string {
    const completedWork = phaseResults
      .filter(r => r.status === 'completed')
      .map(r => `- ${r.phaseName}: 已完成，输出位于 ${r.outputPath}`)
      .join('\n');

    return `
# Agent Zone 执行上下文

## 已完成的工作
${completedWork}

## 你的任务
作为 ${this.fsmTemplate?.displayName || 'Threat Modeling'} 工作流的 Agent Zone 成员，
请执行安全扫描/分析任务，并将发现的漏洞写入 vulnerabilities/ 目录。

## 输出要求
- 漏洞报告使用 Markdown 格式
- 每个漏洞包含: 标题、描述、严重程度、影响范围、修复建议
- 输出路径: vulnerabilities/{agent-name}-findings.md
`;
  }

  /**
   * 统计结果中的漏洞数量
   */
  private countVulnerabilitiesInResult(text: string): number {
    const patterns = [
      /严重程度:\s*critical/gi,
      /严重程度:\s*high/gi,
      /severity:\s*critical/gi,
      /severity:\s*high/gi,
      /\[Critical\]/gi,
      /\[High\]/gi,
      /漏洞[:\s]/g,
    ];

    let count = 0;
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        count += matches.length;
      }
    }

    // 使用最大值避免重复计数
    return Math.min(count, 100);
  }

  /**
   * 写入 Agent Zone 输出
   */
  private async writeAgentZoneOutput(agentName: string, content: string): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');

    const vulnDir = path.join(this.config.workspacePath, 'vulnerabilities');
    await fs.mkdir(vulnDir, { recursive: true });

    const outputPath = path.join(vulnDir, `${agentName}-findings.md`);
    await fs.writeFile(outputPath, content, 'utf-8');

    return outputPath;
  }

  /**
   * 计算阶段成本
   */
  private calculatePhaseCost(usage: { inputTokens: number; outputTokens: number }): number {
    const inputCost = (usage.inputTokens / 1_000_000) * 6; // 6 元/百万 token
    const outputCost = (usage.outputTokens / 1_000_000) * 22; // 22 元/百万 token
    return inputCost + outputCost;
  }

  /**
   * 计算总成本
   */
  private calculateTotalCost(phaseResults: FSMPhaseResult[]): number {
    return phaseResults.reduce((sum, r) => sum + r.cost, 0);
  }

  /**
   * 确定工作流状态
   */
  private determineStatus(
    phaseResults: FSMPhaseResult[],
    agentZoneResults: AgentZoneResult[]
  ): 'completed' | 'failed' | 'partial' {
    const allPhasesComplete = phaseResults.every(r => r.status === 'completed');
    const anyPhaseFailed = phaseResults.some(r => r.status === 'failed');
    const allAgentsComplete = agentZoneResults.every(r => r.status === 'completed');

    if (allPhasesComplete && allAgentsComplete) {
      return 'completed';
    }
    if (anyPhaseFailed) {
      return 'failed';
    }
    return 'partial';
  }

  /**
   * 生成报告
   */
  private async generateReports(result: FSMWorkflowResult): Promise<string[]> {
    const { FSMReportGenerator } = await import('@/lib/reports/fsm-report-generator');
    
    const generator = new FSMReportGenerator(
      result.sessionId,
      result.projectId,
      this.config.workspacePath
    );

    const reports = await generator.generateAllReports(
      result.phaseResults,
      result.agentZoneResults
    );

    return reports;
  }

  /**
   * 中止执行
   */
  abort(): void {
    this.aborted = true;
    // 中止统一引擎
    if (this.unifiedEngine) {
      this.unifiedEngine.abort();
    }
    // 中止 Agent Zone Agent
    if (this.currentAgentZoneAgent) {
      this.currentAgentZoneAgent.abort();
    }
  }

  /**
   * 检查是否已中止
   */
  isAborted(): boolean {
    return this.aborted;
  }
}

/**
 * 创建 FSM Workflow Execution Service
 */
export function createFSMWorkflowExecutionService(
  config: FSMExecutionConfig,
  callbacks: FSMExecutionCallbacks
): FSMWorkflowExecutionService {
  return new FSMWorkflowExecutionService(config, callbacks);
}