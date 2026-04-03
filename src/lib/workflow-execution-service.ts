// src/lib/workflow-execution-service.ts

import { prisma } from '@/lib/prisma';
import { executeWorkflow, WorkflowExecutionOptions } from './workflow-executor';
import type { FlowNode, FlowEdge, StepResult } from '@/types/workflow';

/**
 * 执行状态
 */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * 执行进度
 */
export interface ExecutionProgress {
  executionId: string;
  workflowId: string;
  status: ExecutionStatus;
  currentNodeId: string | null;
  currentNodeName: string | null;
  totalNodes: number;
  completedNodes: number;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  steps: StepProgress[];
}

/**
 * 步骤进度
 */
export interface StepProgress {
  stepId: string;
  nodeId: string;
  nodeName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: Date | null;
  completedAt: Date | null;
  output: unknown;
  error: string | null;
}

/**
 * 执行选项
 */
export interface ExecutionServiceOptions extends WorkflowExecutionOptions {
  executionId: string;
  workflowId: string;
  userId: string;
}

/**
 * 活跃执行追踪
 */
const activeExecutions = new Map<string, {
  controller: AbortController;
  progress: ExecutionProgress;
}>();

/**
 * 工作流执行服务
 */
export class WorkflowExecutionService {
  private executionId: string;
  private workflowId: string;
  private userId: string;
  private controller: AbortController;
  private progress: ExecutionProgress;
  private nodeMap: Map<string, FlowNode>;

  constructor(options: ExecutionServiceOptions) {
    this.executionId = options.executionId;
    this.workflowId = options.workflowId;
    this.userId = options.userId;
    this.controller = new AbortController();
    this.nodeMap = new Map();
    this.progress = {
      executionId: this.executionId,
      workflowId: this.workflowId,
      status: 'pending',
      currentNodeId: null,
      currentNodeName: null,
      totalNodes: 0,
      completedNodes: 0,
      startedAt: null,
      completedAt: null,
      error: null,
      steps: [],
    };
  }

  /**
   * 执行工作流
   */
  async execute(nodes: FlowNode[], edges: FlowEdge[]): Promise<ExecutionProgress> {
    // 初始化节点映射
    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
    }

    this.progress.totalNodes = nodes.length;
    this.progress.status = 'running';
    this.progress.startedAt = new Date();

    // 注册活跃执行
    activeExecutions.set(this.executionId, {
      controller: this.controller,
      progress: this.progress,
    });

    // 更新数据库状态
    await this.updateExecutionStatus('running');

    // 初始化步骤进度
    await this.initializeSteps(nodes);

    try {
      // 执行工作流
      const options: WorkflowExecutionOptions = {
        variables: {},
        onStepStart: (nodeId, nodeName) => {
          this.handleStepStart(nodeId, nodeName);
        },
        onStepComplete: (result) => {
          this.handleStepComplete(result);
        },
        onStepError: (nodeId, error) => {
          this.handleStepError(nodeId, error);
        },
      };

      // 检查是否被取消
      if (this.controller.signal.aborted) {
        throw new Error('Execution cancelled');
      }

      // 执行
      await executeWorkflow(nodes, edges, options);

      // 完成
      this.progress.status = 'completed';
      this.progress.completedAt = new Date();
      await this.updateExecutionStatus('completed');

    } catch (error) {
      if (this.controller.signal.aborted) {
        this.progress.status = 'cancelled';
        await this.updateExecutionStatus('cancelled');
      } else {
        this.progress.status = 'failed';
        this.progress.error = error instanceof Error ? error.message : 'Unknown error';
        await this.updateExecutionStatus('failed', this.progress.error);
      }
    } finally {
      activeExecutions.delete(this.executionId);
    }

    return this.progress;
  }

  /**
   * 取消执行
   */
  cancel(): void {
    this.controller.abort();
  }

  /**
   * 获取进度
   */
  getProgress(): ExecutionProgress {
    return { ...this.progress };
  }

  /**
   * 处理步骤开始
   */
  private async handleStepStart(nodeId: string, nodeName: string): Promise<void> {
    this.progress.currentNodeId = nodeId;
    this.progress.currentNodeName = nodeName;

    // 更新步骤状态
    const step = this.progress.steps.find(s => s.nodeId === nodeId);
    if (step) {
      step.status = 'running';
      step.startedAt = new Date();
    }

    // 更新数据库
    await prisma.workflowExecutionStep.updateMany({
      where: { executionId: this.executionId, nodeId },
      data: { status: 'running', startedAt: new Date() },
    });

    // 更新执行记录
    await prisma.workflowExecution.update({
      where: { id: this.executionId },
      data: { currentNodeId: nodeId },
    });
  }

  /**
   * 处理步骤完成
   */
  private async handleStepComplete(result: StepResult): Promise<void> {
    this.progress.completedNodes++;

    // 更新步骤状态
    const step = this.progress.steps.find(s => s.nodeId === result.nodeId);
    if (step) {
      step.status = result.status === 'completed' ? 'completed' : 'failed';
      step.completedAt = new Date();
      step.output = result.output;
      step.error = result.error;
    }

    // 更新数据库
    await prisma.workflowExecutionStep.updateMany({
      where: { executionId: this.executionId, nodeId: result.nodeId },
      data: {
        status: result.status,
        completedAt: new Date(),
        output: result.output ? JSON.stringify(result.output) : null,
        error: result.error,
      },
    });
  }

  /**
   * 处理步骤错误
   */
  private async handleStepError(nodeId: string, error: string): Promise<void> {
    const step = this.progress.steps.find(s => s.nodeId === nodeId);
    if (step) {
      step.status = 'failed';
      step.error = error;
      step.completedAt = new Date();
    }

    await prisma.workflowExecutionStep.updateMany({
      where: { executionId: this.executionId, nodeId },
      data: { status: 'failed', error, completedAt: new Date() },
    });
  }

  /**
   * 初始化步骤
   */
  private async initializeSteps(nodes: FlowNode[]): Promise<void> {
    for (const node of nodes) {
      this.progress.steps.push({
        stepId: `${this.executionId}-${node.id}`,
        nodeId: node.id,
        nodeName: node.data.label || node.type,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        output: null,
        error: null,
      });
    }
  }

  /**
   * 更新执行状态
   */
  private async updateExecutionStatus(status: ExecutionStatus, error?: string): Promise<void> {
    await prisma.workflowExecution.update({
      where: { id: this.executionId },
      data: {
        status,
        error,
        completedAt: status === 'completed' || status === 'failed' || status === 'cancelled'
          ? new Date()
          : undefined,
      },
    });
  }
}

/**
 * 获取活跃执行
 */
export function getActiveExecution(executionId: string): {
  controller: AbortController;
  progress: ExecutionProgress;
} | undefined {
  return activeExecutions.get(executionId);
}

/**
 * 取消活跃执行
 */
export function cancelExecution(executionId: string): boolean {
  const execution = activeExecutions.get(executionId);
  if (execution) {
    execution.controller.abort();
    return true;
  }
  return false;
}

/**
 * 获取执行进度
 */
export async function getExecutionProgress(executionId: string): Promise<ExecutionProgress | null> {
  // 先检查活跃执行
  const active = activeExecutions.get(executionId);
  if (active) {
    return active.progress;
  }

  // 从数据库获取
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    include: {
      steps: true,
    },
  });

  if (!execution) {
    return null;
  }

  // 获取工作流节点信息
  const workflow = await prisma.workflow.findUnique({
    where: { id: execution.workflowId },
    include: { nodes: true },
  });

  const nodeMap = new Map<string, string>();
  if (workflow) {
    for (const node of workflow.nodes) {
      const nodeData = node.data as { label?: string };
      nodeMap.set(node.id, nodeData.label || node.type);
    }
  }

  return {
    executionId: execution.id,
    workflowId: execution.workflowId,
    status: execution.status as ExecutionStatus,
    currentNodeId: null,
    currentNodeName: null,
    totalNodes: execution.steps.length,
    completedNodes: execution.steps.filter(s => s.status === 'completed').length,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    error: execution.error,
    steps: execution.steps.map(step => ({
      stepId: step.id,
      nodeId: step.nodeId,
      nodeName: nodeMap.get(step.nodeId) || step.nodeId,
      status: step.status as StepProgress['status'],
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      output: step.output ? JSON.parse(step.output as string) : null,
      error: step.error,
    })),
  };
}
