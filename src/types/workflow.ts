// 工作流相关类型定义

// ============ 数据库模型类型（从 Prisma 生成） ============

export type WorkflowStatus = 'draft' | 'published' | 'archived';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type SharePermission = 'read' | 'execute' | 'edit';

// ============ React Flow 类型 ============

export interface FlowNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  data: NodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  data?: EdgeData;
  type?: 'default' | 'straight' | 'step' | 'smoothstep' | 'bezier';
  animated?: boolean;
  style?: { stroke?: string; strokeWidth?: number };
}

// ============ 节点类型定义 ============

export type WorkflowNodeType = 
  | 'start'      // 开始节点
  | 'end'        // 结束节点
  | 'task'       // 任务节点（串行）
  | 'subtask';   // 子任务节点（并行）

export interface NodeData {
  label: string;
  description?: string;
  config?: Record<string, any>;
  inputs?: NodePort[];
  outputs?: NodePort[];
  type?: WorkflowNodeType;
  [key: string]: any; // React Flow Node 类型要求索引签名
}

export interface NodePort {
  id: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  defaultValue?: any;
}

export interface NodeConfigField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'json' | 'code';
  defaultValue?: any;
  options?: { label: string; value: any }[];
  required: boolean;
  placeholder?: string;
  description?: string;
}

export interface NodeTypeDefinition {
  type: WorkflowNodeType;
  label: string;
  category: 'control' | 'action' | 'data' | 'trigger';
  icon: string;
  description: string;
  color: string;
  inputs: NodePort[];
  outputs: NodePort[];
  config: NodeConfigField[];
  defaultLabel?: string;        // 默认节点名称
  defaultDescription?: string;  // 默认节点描述
  editable?: boolean;            // 是否可编辑（名称和描述）
}

// ============ 边数据 ============

export interface EdgeData {
  condition?: string;      // 条件表达式
  delay?: number;          // 延迟时间（毫秒）
  label?: string;
  [key: string]: any; // React Flow Edge 类型要求索引签名
}

// ============ 工作流数据结构 ============

export interface WorkflowData {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport?: { x: number; y: number; zoom: number };
  thumbnail?: string; // Base64 编码的缩略图
}

// 从 Prisma 导入类型
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowExecution, WorkflowExecutionStep, WorkflowShare } from '@prisma/client';

export interface WorkflowWithNodes extends Workflow {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowExecutionWithSteps extends WorkflowExecution {
  steps: WorkflowExecutionStep[];
}

// ============ API 请求/响应类型 ============

export interface CreateWorkflowRequest {
  name: string;
  description?: string;
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  status?: WorkflowStatus;
  thumbnail?: string;
}

export interface SaveWorkflowDataRequest {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface ExecuteWorkflowRequest {
  variables?: Record<string, any>;
}

export interface ShareWorkflowRequest {
  sharedWith: string;   // 用户ID
  permission: SharePermission;
  expiresAt?: Date;
}

export interface WorkflowListResponse {
  workflows: WorkflowWithNodes[];
  total: number;
  page: number;
  pageSize: number;
}

// ============ 执行器类型 ============

export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  variables: Record<string, any>;
  steps: Map<string, StepResult>;
}

export interface StepResult {
  nodeId: string;
  status: StepStatus;
  input: any;
  output: any;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface NodeExecutor {
  type: WorkflowNodeType;
  execute(context: ExecutionContext, node: FlowNode): Promise<StepResult>;
  validate(node: FlowNode): boolean;
}

// ============ 预定义节点类型 ============

export const NODE_TYPES: NodeTypeDefinition[] = [
  {
    type: 'start',
    label: '开始',
    category: 'trigger',
    icon: 'Play',
    description: '工作流的起始点',
    color: '#10B981',
    inputs: [],
    outputs: [{ id: 'out', label: '输出', type: 'object', required: true }],
    config: [],
    defaultLabel: '开始',
    defaultDescription: '工作流的起始点',
    editable: false, // 开始节点不可编辑
  },
  {
    type: 'end',
    label: '结束',
    category: 'trigger',
    icon: 'Square',
    description: '工作流的结束点',
    color: '#EF4444',
    inputs: [{ id: 'in', label: '输入', type: 'object', required: true }],
    outputs: [],
    config: [],
    defaultLabel: '结束',
    defaultDescription: '工作流的结束点',
    editable: false, // 结束节点不可编辑
  },
  {
    type: 'task',
    label: '任务',
    category: 'action',
    icon: 'Cog',
    description: '执行一个任务（串行执行）',
    color: '#3B82F6',
    inputs: [{ id: 'in', label: '输入', type: 'object', required: true }],
    outputs: [
      { id: 'out', label: '输出', type: 'object', required: true },
      { id: 'subtask', label: '子任务', type: 'object', required: false },
    ],
    config: [
      { id: 'name', label: '任务名称', type: 'text', required: true },
      { id: 'description', label: '任务描述', type: 'textarea', required: false },
    ],
    editable: true, // 任务节点可编辑
  },
  {
    type: 'subtask',
    label: '子任务',
    category: 'action',
    icon: 'Cog',
    description: '挂在任务下的子任务（并行执行）',
    color: '#8B5CF6',
    inputs: [{ id: 'in', label: '输入', type: 'object', required: true }],
    outputs: [{ id: 'out', label: '输出', type: 'object', required: true }],
    config: [
      { id: 'name', label: '子任务名称', type: 'text', required: true },
      { id: 'description', label: '子任务描述', type: 'textarea', required: false },
    ],
    editable: true, // 子任务节点可编辑
  },
];

// 导出节点类型映射
export const NODE_TYPE_MAP: Record<WorkflowNodeType, NodeTypeDefinition> = 
  NODE_TYPES.reduce((acc, node) => ({ ...acc, [node.type]: node }), {} as Record<WorkflowNodeType, NodeTypeDefinition>);
