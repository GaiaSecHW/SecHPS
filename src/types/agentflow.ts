import { Node, Edge } from '@xyflow/react';

export interface AgentFlowNodeData extends Node {
  data: {
    name: string;
    description?: string;
    agentType: 'planner' | 'executor' | 'evaluator';
    config?: Record<string, any>;
    inputs?: Array<{ name: string; type: string; description?: string }>;
    outputs?: Array<{ name: string; type: string; description?: string }>;
  };
}

export type AgentFlowNode = Node<AgentFlowNodeData['data']>;
export type AgentFlowEdge = Edge;

export interface AgentFlowNodeType {
  type: string;
  name: string;
  description: string;
  agentType: 'planner' | 'executor' | 'evaluator';
  config?: Record<string, any>;
  inputs?: Array<{ name: string; type: string; description?: string }>;
  outputs?: Array<{ name: string; type: string; description?: string }>;
}

export const AGENTFLOW_NODE_TYPES: AgentFlowNodeType[] = [
  {
    type: 'planner',
    name: '规划节点',
    description: '负责任务规划和分解',
    agentType: 'planner',
    inputs: [{ name: 'goal', type: 'string', description: '任务目标' }],
    outputs: [{ name: 'plan', type: 'array', description: '执行计划' }],
  },
  {
    type: 'executor',
    name: '执行节点',
    description: '负责执行具体任务',
    agentType: 'executor',
    inputs: [{ name: 'task', type: 'object', description: '待执行任务' }],
    outputs: [{ name: 'result', type: 'object', description: '执行结果' }],
  },
  {
    type: 'evaluator',
    name: '评估节点',
    description: '负责评估执行结果',
    agentType: 'evaluator',
    inputs: [{ name: 'result', type: 'object', description: '待评估结果' }],
    outputs: [{ name: 'score', type: 'number', description: '评估分数' }],
  },
];
