/**
 * 工作流执行引擎
 * 负责执行工作流中的各个节点，处理数据流转和错误
 */

import type { FlowNode, FlowEdge, NodeData, ExecutionContext, StepResult, NodeExecutor, WorkflowNodeType } from '@/types/workflow';

// 重新定义节点类型以匹配简化后的类型
type SimplifiedNodeType = 'start' | 'end' | 'task' | 'subtask';

// ============ 内置节点执行器 ============

/**
 * 开始节点执行器
 */
const startExecutor: NodeExecutor = {
  type: 'start' as SimplifiedNodeType,
  validate: () => true,
  execute: async (context: ExecutionContext, node: FlowNode): Promise<StepResult> => {
    return {
      nodeId: node.id,
      status: 'completed',
      input: null,
      output: { started: true, timestamp: new Date().toISOString() },
      error: null,
      startedAt: new Date(),
      completedAt: new Date(),
    };
  },
};

/**
 * 结束节点执行器
 */
const endExecutor: NodeExecutor = {
  type: 'end' as SimplifiedNodeType,
  validate: () => true,
  execute: async (context: ExecutionContext, node: FlowNode): Promise<StepResult> => {
    const input = context.steps.size > 0 
      ? Array.from(context.steps.values()).pop()?.output 
      : null;
    
    return {
      nodeId: node.id,
      status: 'completed',
      input,
      output: { ended: true, timestamp: new Date().toISOString() },
      error: null,
      startedAt: new Date(),
      completedAt: new Date(),
    };
  },
};

/**
 * 任务节点执行器
 */
const taskExecutor: NodeExecutor = {
  type: 'task' as SimplifiedNodeType,
  validate: (node: FlowNode) => {
    const config = node.data.config || {};
    return !!(config.name);
  },
  execute: async (context: ExecutionContext, node: FlowNode): Promise<StepResult> => {
    const config = node.data.config || {};
    const startedAt = new Date();
    
    try {
      const previousStep = getPreviousStepOutput(context, node.id);
      
      // 任务执行逻辑（串行）
      let output: any;
      if (config.action === 'api_call') {
        output = { apiCall: true, url: config.url, response: previousStep };
      } else if (config.action === 'script') {
        output = { scriptExecuted: true, result: previousStep };
      } else {
        output = { taskExecuted: true, input: previousStep, config };
      }
      
      return {
        nodeId: node.id,
        status: 'completed',
        input: previousStep,
        output,
        error: null,
        startedAt,
        completedAt: new Date(),
      };
    } catch (error) {
      return {
        nodeId: node.id,
        status: 'failed',
        input: null,
        output: null,
        error: error instanceof Error ? error.message : '任务执行失败',
        startedAt,
        completedAt: new Date(),
      };
    }
  },
};

/**
 * 子任务节点执行器
 */
const subtaskExecutor: NodeExecutor = {
  type: 'subtask' as SimplifiedNodeType,
  validate: (node: FlowNode) => {
    const config = node.data.config || {};
    return !!(config.name);
  },
  execute: async (context: ExecutionContext, node: FlowNode): Promise<StepResult> => {
    const config = node.data.config || {};
    const startedAt = new Date();
    
    try {
      const previousStep = getPreviousStepOutput(context, node.id);
      
      // 子任务执行逻辑（并行）
      const output = { 
        subtaskExecuted: true, 
        input: previousStep, 
        config,
        parallel: true,
      };
      
      return {
        nodeId: node.id,
        status: 'completed',
        input: previousStep,
        output,
        error: null,
        startedAt,
        completedAt: new Date(),
      };
    } catch (error) {
      return {
        nodeId: node.id,
        status: 'failed',
        input: null,
        output: null,
        error: error instanceof Error ? error.message : '子任务执行失败',
        startedAt,
        completedAt: new Date(),
      };
    }
  },
};

// ============ 执行器注册表 ============

const executors: Map<SimplifiedNodeType, NodeExecutor> = new Map([
  ['start', startExecutor],
  ['end', endExecutor],
  ['task', taskExecutor],
  ['subtask', subtaskExecutor],
]);

/**
 * 获取节点执行器
 */
export function getNodeExecutor(type: string): NodeExecutor | undefined {
  return executors.get(type as SimplifiedNodeType);
}

/**
 * 注册自定义节点执行器
 */
export function registerNodeExecutor(executor: NodeExecutor): void {
  executors.set(executor.type as SimplifiedNodeType, executor);
}

// ============ 工作流执行器 ============

export interface WorkflowExecutionOptions {
  variables?: Record<string, any>;
  onStepStart?: (nodeId: string, nodeName: string) => void;
  onStepComplete?: (result: StepResult) => void;
  onStepError?: (nodeId: string, error: string) => void;
}

/**
 * 执行工作流
 */
export async function executeWorkflow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options: WorkflowExecutionOptions = {}
): Promise<Map<string, StepResult>> {
  const context: ExecutionContext = {
    workflowId: '',
    executionId: '',
    variables: options.variables || {},
    steps: new Map(),
  };
  
  // 构建邻接表
  const adjacencyList = buildAdjacencyList(nodes, edges);
  
  // 找到开始节点
  const startNode = nodes.find(n => n.type === 'start');
  if (!startNode) {
    throw new Error('工作流必须包含开始节点');
  }
  
  // 拓扑排序
  const sortedNodes = topologicalSort(nodes, adjacencyList);
  
  // 按顺序执行节点
  for (const node of sortedNodes) {
    const executor = getNodeExecutor(node.type);
    if (!executor) {
      throw new Error(`未找到节点执行器: ${node.type}`);
    }
    
    // 验证节点
    if (!executor.validate(node)) {
      const result: StepResult = {
        nodeId: node.id,
        status: 'failed',
        input: null,
        output: null,
        error: '节点配置验证失败',
        startedAt: new Date(),
        completedAt: new Date(),
      };
      context.steps.set(node.id, result);
      options.onStepError?.(node.id, result.error || '节点配置验证失败');
      break;
    }
    
    // 执行节点
    options.onStepStart?.(node.id, node.data.label);
    
    try {
      const result = await executor.execute(context, node);
      context.steps.set(node.id, result);
      options.onStepComplete?.(result);
      
      if (result.status === 'failed') {
        options.onStepError?.(node.id, result.error || '执行失败');
        break;
      }
    } catch (error) {
      const result: StepResult = {
        nodeId: node.id,
        status: 'failed',
        input: null,
        output: null,
        error: error instanceof Error ? error.message : '执行失败',
        startedAt: new Date(),
        completedAt: new Date(),
      };
      context.steps.set(node.id, result);
      options.onStepError?.(node.id, result.error || '执行失败');
      break;
    }
  }
  
  return context.steps;
}

// ============ 辅助函数 ============

/**
 * 构建邻接表
 */
function buildAdjacencyList(
  nodes: FlowNode[],
  edges: FlowEdge[]
): Map<string, string[]> {
  const adjacencyList = new Map<string, string[]>();
  
  for (const node of nodes) {
    adjacencyList.set(node.id, []);
  }
  
  for (const edge of edges) {
    const targets = adjacencyList.get(edge.source) || [];
    targets.push(edge.target);
    adjacencyList.set(edge.source, targets);
  }
  
  return adjacencyList;
}

/**
 * 拓扑排序（基于 Kahn 算法）
 */
function topologicalSort(
  nodes: FlowNode[],
  adjacencyList: Map<string, string[]>
): FlowNode[] {
  const inDegree = new Map<string, number>();
  const nodeMap = new Map<string, FlowNode>();
  
  // 初始化入度
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    nodeMap.set(node.id, node);
  }
  
  // 计算入度
  for (const [, targets] of adjacencyList) {
    for (const target of targets) {
      inDegree.set(target, (inDegree.get(target) || 0) + 1);
    }
  }
  
  // 找到所有入度为 0 的节点
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }
  
  const sorted: FlowNode[] = [];
  
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId);
    if (node) {
      sorted.push(node);
    }
    
    const targets = adjacencyList.get(nodeId) || [];
    for (const target of targets) {
      const newDegree = (inDegree.get(target) || 0) - 1;
      inDegree.set(target, newDegree);
      if (newDegree === 0) {
        queue.push(target);
      }
    }
  }
  
  return sorted;
}

/**
 * 获取上一个节点的输出
 */
function getPreviousStepOutput(context: ExecutionContext, nodeId: string): any {
  // 从 steps 中获取最后一个完成的步骤的输出
  const steps = Array.from(context.steps.values());
  if (steps.length === 0) {
    return null;
  }
  
  // 返回最后一个成功的步骤的输出
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === 'completed') {
      return steps[i].output;
    }
  }
  
  return null;
}

/**
 * 收集所有前驱节点的输出
 */
function collectAllPreviousOutputs(context: ExecutionContext, nodeId: string): any[] {
  return Array.from(context.steps.values())
    .filter(step => step.status === 'completed')
    .map(step => step.output);
}

/**
 * 执行 API 调用
 */
async function executeApiCall(config: any, input: any): Promise<any> {
  // TODO: 实现实际的 API 调用逻辑
  return {
    apiCall: true,
    url: config.url,
    method: config.method || 'GET',
    response: { success: true, data: input },
  };
}

/**
 * 执行脚本
 */
async function executeScript(config: any, input: any, variables: Record<string, any>): Promise<any> {
  // TODO: 实现安全的脚本执行环境
  // 注意：实际生产环境需要使用沙箱环境执行脚本
  return {
    scriptExecuted: true,
    result: input,
  };
}

/**
 * 执行 AI 处理
 */
async function executeAiProcess(config: any, input: any): Promise<any> {
  // TODO: 实现 AI 处理逻辑
  return {
    aiProcessed: true,
    input,
    output: { processed: true },
  };
}

/**
 * 执行文件操作
 */
async function executeFileOperation(config: any, input: any): Promise<any> {
  // TODO: 实现文件操作逻辑
  return {
    fileOperation: true,
    operation: config.operation,
    path: config.path,
    result: input,
  };
}

/**
 * 评估条件表达式
 */
function evaluateCondition(condition: string, input: any, variables: Record<string, any>): boolean {
  // TODO: 实现安全的条件表达式评估
  // 注意：实际生产环境需要使用安全的表达式解析器
  try {
    // 简单模拟：检查条件是否包含 'true' 或 'false'
    if (condition.toLowerCase().includes('true')) {
      return true;
    }
    if (condition.toLowerCase().includes('false')) {
      return false;
    }
    // 默认返回 true
    return true;
  } catch {
    return false;
  }
}

/**
 * 执行数据转换
 */
async function executeTransform(transform: string, input: any, variables: Record<string, any>): Promise<any> {
  // TODO: 实现安全的数据转换逻辑
  // 注意：实际生产环境需要使用沙箱环境执行转换脚本
  try {
    return input;
  } catch {
    return input;
  }
}
