// 工作流验证工具函数

import { FlowNode, FlowEdge, WorkflowNodeType } from '@/types/workflow';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 验证工作流数据
 * @param nodes 节点数组
 * @param edges 边数组
 * @param strict 是否严格模式（启用工作流时使用）
 * @returns 验证结果
 */
export function validateWorkflow(nodes: FlowNode[], edges: FlowEdge[], strict: boolean = false): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. 检查是否有开始节点
  const startNodes = nodes.filter(n => n.type === 'start');
  if (startNodes.length === 0) {
    errors.push('工作流必须有一个开始节点');
  } else if (startNodes.length > 1) {
    errors.push('工作流只能有一个开始节点');
  }

  // 2. 检查是否有结束节点
  const endNodes = nodes.filter(n => n.type === 'end');
  if (endNodes.length === 0) {
    errors.push('工作流必须有一个结束节点');
  } else if (endNodes.length > 1) {
    errors.push('工作流只能有一个结束节点');
  }

  // 3. 检查所有节点是否都有连接（除了开始和结束节点）
  const nodeIds = new Set(nodes.map(n => n.id));
  const connectedNodeIds = new Set<string>();

  edges.forEach(edge => {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  });

  // 开始节点不需要输入连接
  startNodes.forEach(node => {
    connectedNodeIds.add(node.id);
  });

  // 结束节点不需要输出连接
  endNodes.forEach(node => {
    connectedNodeIds.add(node.id);
  });

  // 检查未连接的节点
  nodes.forEach(node => {
    if (!connectedNodeIds.has(node.id)) {
      if (strict) {
        // 严格模式：未连接的节点是错误
        errors.push(`节点 "${node.data.label}" 没有任何连接，所有节点必须连接`);
      } else {
        // 普通模式：未连接的节点是警告
        warnings.push(`节点 "${node.data.label}" 没有任何连接`);
      }
    }
  });

  // 4. 检查连接规则
  for (const edge of edges) {
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);

    if (!sourceNode || !targetNode) {
      errors.push(`连接 ${edge.id} 引用了不存在的节点`);
      continue;
    }

    const sourceType = sourceNode.type;
    const targetType = targetNode.type;

    // 验证开始节点连接
    if (sourceType === 'start' && targetType !== 'task') {
      errors.push(`开始节点只能连接到任务节点，当前连接到 "${targetType}"`);
    }

    // 验证结束节点连接
    if (targetType === 'end' && sourceType !== 'task') {
      errors.push(`结束节点只能被任务节点连接，当前被 "${sourceType}" 连接`);
    }

    // 验证任务节点连接
    if (sourceType === 'task') {
      if (targetType !== 'task' && targetType !== 'end' && targetType !== 'subtask') {
        errors.push(`任务节点只能连接到任务、结束或子任务节点，当前连接到 "${targetType}"`);
      }
    }

    // 验证子任务节点连接
    if (sourceType === 'subtask' && targetType !== 'subtask') {
      errors.push(`子任务节点只能连接到子任务节点，当前连接到 "${targetType}"`);
    }
  }

  // 5. 检查是否有循环依赖
  const hasCycle = detectCycle(nodes, edges);
  if (hasCycle) {
    errors.push('工作流中存在循环依赖，请检查连接关系');
  }

  // 6. 检查从开始节点到结束节点的路径
  if (startNodes.length > 0 && endNodes.length > 0) {
    const hasPath = checkPathExists(startNodes[0].id, endNodes[0].id, edges);
    if (!hasPath) {
      errors.push('工作流中不存在从开始节点到结束节点的路径');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 检测图中是否存在循环（使用 DFS）
 */
function detectCycle(nodes: FlowNode[], edges: FlowEdge[]): boolean {
  const adjacency = new Map<string, string[]>();

  // 构建邻接表
  nodes.forEach(node => {
    adjacency.set(node.id, []);
  });

  edges.forEach(edge => {
    const neighbors = adjacency.get(edge.source) || [];
    neighbors.push(edge.target);
    adjacency.set(edge.source, neighbors);
  });

  // DFS 检测循环
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (recursionStack.has(nodeId)) {
      return true; // 发现循环
    }

    if (visited.has(nodeId)) {
      return false; // 已访问过，无循环
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (dfs(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  // 从每个节点开始 DFS
  for (const node of nodes) {
    if (dfs(node.id)) {
      return true;
    }
  }

  return false;
}

/**
 * 检查从开始节点到结束节点的路径是否存在（使用 BFS）
 */
function checkPathExists(startId: string, endId: string, edges: FlowEdge[]): boolean {
  const adjacency = new Map<string, string[]>();

  // 构建邻接表
  edges.forEach(edge => {
    const neighbors = adjacency.get(edge.source) || [];
    neighbors.push(edge.target);
    adjacency.set(edge.source, neighbors);
  });

  // BFS 搜索路径
  const queue = [startId];
  const visited = new Set<string>();
  visited.add(startId);

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    if (currentId === endId) {
      return true; // 找到路径
    }

    const neighbors = adjacency.get(currentId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return false; // 未找到路径
}
