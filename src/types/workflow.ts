// 工作流相关类型定义

// ============ 数据库模型类型（从 Prisma 生成） ============

export type WorkflowStatus = 'draft' | 'published' | 'archived';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type SharePermission = 'read' | 'execute' | 'edit';

// ============ FSM 工作流类型 ============

export type WorkflowType = 'dag' | 'fsm';
export type FSMPhaseStatus = 'pending' | 'validated' | 'failed';

// FSM 模板节点定义
export interface FSMTemplateNode {
  id: string;
  label: string;
  phases: string[];         // ["P1", "P2"]
  skillPath?: string;       // 阶段对应的 Skill 文件路径
  fsmPhase: number;         // 1-4
  fsmFixed: boolean;        // 固定节点
  fsmOrder: number;         // 执行顺序
  config?: Record<string, any>;
  description?: string;
}

// FSM Agent 区配置
export interface FSMAgentZoneConfig {
  position: number;         // 在哪个节点之后 (3 = Node 3 之后)
  allowAdd: boolean;
  allowDelete: boolean;
  allowReorder: boolean;
  parallel: boolean;
  defaultAgents?: string[];
}

// FSM 模板定义
export interface FSMTemplateDefinition {
  id: string;
  name: string;             // "threat-modeling"
  displayName: string;
  description?: string;
  nodeCount: number;        // 4
  nodes: FSMTemplateNode[];
  agentZone?: FSMAgentZoneConfig;
  skillPath?: string;
  version: string;
  isActive: boolean;
  isBuiltin: boolean;
}

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
  | 'task'       // Agent节点（串行）
  | 'subtask'    // 子Agent节点（并行）
  | 'fsm_phase'  // FSM 阶段节点
  | 'agent-zone'; // Agent 区容器节点

export interface NodeData {
  label: string;
  description?: string;
  config?: Record<string, any>;
  inputs?: NodePort[];
  outputs?: NodePort[];
  type?: WorkflowNodeType;
  skillLoadingMode?: 'description' | 'manual' | 'vulnerability';  // Skill 加载模式
  vulnerabilityCategories?: string[];  // 漏洞分类列表（模式 3，category value 数组）
  skills?: string;  // 手工指定的 Skills（模式 2，JSON 数组）
  
  // FSM 节点扩展字段
  fsmPhase?: number;       // FSM 阶段编号 (1-4)
  fsmFixed?: boolean;      // 是否固定节点
  fsmOrder?: number;       // 强制执行顺序
  phases?: string[];       // 包含的阶段 ["P1", "P2"]
  skillPath?: string;      // 阶段对应的 Skill 文件路径
  
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
import type { 
  Workflow, 
  WorkflowNode, 
  WorkflowEdge, 
  WorkflowExecution, 
  WorkflowExecutionStep, 
  WorkflowShare,
  FSMTemplate,
  PhaseOutput,
  Report,
  ReportSection,
  IntegratedReport
} from '@prisma/client';

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
    label: 'Agent',
    category: 'action',
    icon: 'Cog',
    description: '',
    color: '#3B82F6',
    inputs: [{ id: 'in', label: '输入', type: 'object', required: true }],
    outputs: [
      { id: 'out', label: '输出', type: 'object', required: true },
      { id: 'subtask', label: '子Agent', type: 'object', required: false },
    ],
    config: [
      { id: 'name', label: 'Agent名称', type: 'text', required: true },
      { id: 'description', label: 'Agent描述', type: 'textarea', required: false },
    ],
    editable: true, // Agent节点可编辑
  },
  {
    type: 'subtask',
    label: '子Agent',
    category: 'action',
    icon: 'Cog',
    description: '挂在Agent下的子Agent（并行执行）',
    color: '#8B5CF6',
    inputs: [{ id: 'in', label: '输入', type: 'object', required: true }],
    outputs: [{ id: 'out', label: '输出', type: 'object', required: true }],
    config: [
      { id: 'name', label: '子Agent名称', type: 'text', required: true },
      { id: 'description', label: '子Agent描述', type: 'textarea', required: false },
    ],
    editable: true, // 子Agent节点可编辑
  },
  // FSM 节点类型
  {
    type: 'fsm_phase',
    label: 'FSM阶段',
    category: 'control',
    icon: 'GitBranch',
    description: 'FSM工作流的固定阶段节点',
    color: '#F59E0B',
    inputs: [{ id: 'in', label: '输入', type: 'object', required: true }],
    outputs: [{ id: 'out', label: '输出', type: 'object', required: true }],
    config: [
      { id: 'fsmPhase', label: '阶段编号', type: 'number', required: true, description: 'FSM阶段编号 (1-4)' },
      { id: 'phases', label: '包含阶段', type: 'json', required: true, description: '阶段列表，如 ["P1", "P2"]' },
      { id: 'skillPath', label: 'Skill路径', type: 'text', required: false, description: '阶段对应的Skill文件路径' },
    ],
    defaultLabel: 'FSM阶段',
    defaultDescription: 'FSM工作流阶段节点',
    editable: false, // FSM节点不可编辑（固定节点）
  },
  {
    type: 'agent-zone',
    label: 'Agent区',
    category: 'control',
    icon: 'Layers',
    description: '用户可自由添加Agent的区域（并行执行）',
    color: '#06B6D4',
    inputs: [{ id: 'in', label: '输入', type: 'object', required: true }],
    outputs: [{ id: 'out', label: '输出', type: 'object', required: true }],
    config: [
      { id: 'allowAdd', label: '允许添加', type: 'checkbox', required: false, defaultValue: true },
      { id: 'allowDelete', label: '允许删除', type: 'checkbox', required: false, defaultValue: true },
      { id: 'parallel', label: '并行执行', type: 'checkbox', required: false, defaultValue: true },
    ],
    defaultLabel: 'Agent区',
    defaultDescription: '用户可自由添加Agent的区域',
    editable: false,
  },
];

// 导出节点类型映射
export const NODE_TYPE_MAP: Record<WorkflowNodeType, NodeTypeDefinition> = 
  NODE_TYPES.reduce((acc, node) => ({ ...acc, [node.type]: node }), {} as Record<WorkflowNodeType, NodeTypeDefinition>);

// ============ FSM 预定义模板 ============

export const FSM_TEMPLATES: FSMTemplateDefinition[] = [
  {
    id: 'threat-modeling',
    name: 'threat-modeling',
    displayName: '威胁建模分析',
    description: '8阶段FSM威胁建模工作流',
    nodeCount: 4,
    nodes: [
      {
        id: 'fsm-node-1',
        label: '系统理解',
        phases: ['P1', 'P2'],
        fsmPhase: 1,
        fsmFixed: true,
        fsmOrder: 1,
        skillPath: 'threat-modeling/phases/P1-P2',
        description: '项目理解 + DFD分析',
      },
      {
        id: 'fsm-node-2',
        label: '安全评估',
        phases: ['P3', 'P4'],
        fsmPhase: 2,
        fsmFixed: true,
        fsmOrder: 2,
        skillPath: 'threat-modeling/phases/P3-P4',
        description: '信任边界 + 安全设计评审',
      },
      {
        id: 'fsm-node-3',
        label: '威胁分析',
        phases: ['P5', 'P6'],
        fsmPhase: 3,
        fsmFixed: true,
        fsmOrder: 3,
        skillPath: 'threat-modeling/phases/P5-P6',
        description: 'STRIDE分析 + 风险验证',
      },
      {
        id: 'fsm-node-4',
        label: '报告生成',
        phases: ['P7', 'P8'],
        fsmPhase: 4,
        fsmFixed: true,
        fsmOrder: 4,
        skillPath: 'threat-modeling/phases/P7-P8',
        description: '缓解规划 + 报告生成',
      },
    ],
    agentZone: {
      position: 3,
      allowAdd: true,
      allowDelete: true,
      allowReorder: true,
      parallel: true,
      defaultAgents: ['SAST Agent', 'Secret Scanner', 'Dependency Scanner'],
    },
    skillPath: 'skills/threat-modeling',
    version: '1.0.0',
    isActive: true,
    isBuiltin: true,
  },
];

// ============ 阶段输出类型 ============

export interface PhaseOutputData {
  id: string;
  sessionId: string;
  executionId?: string;
  nodeId?: string;
  phaseNumber: number;
  phaseName: string;
  phases?: string[];
  outputYaml: string;
  outputPath: string;
  status: FSMPhaseStatus;
  validatedAt?: Date;
  errorMessage?: string;
  findingsCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============ 报告类型 ============

export type ReportType = 'dag' | 'fsm' | 'analysis' | 'scan';
export type ReportStatus = 'generating' | 'generated' | 'failed';

export interface ReportData {
  id: string;
  sessionId: string;
  projectId: string;
  reportType: ReportType;
  workflowType?: WorkflowType;
  fsmTemplate?: string;
  title: string;
  description?: string;
  mainReportPath?: string;
  mainReportContent?: string;
  subReports?: string;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  dataSources?: string;
  integratedReports?: string;
  rawContent?: string;
  skillsUsed?: string;
  status: ReportStatus;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportSectionData {
  id: string;
  reportId: string;
  sectionId: string;
  title: string;
  order: number;
  contentPath?: string;
  content?: string;
  metadata?: string;
  createdAt: Date;
}

export interface IntegratedReportData {
  id: string;
  reportId: string;
  sourcePath: string;
  sourceType: string;
  format: string;
  title?: string;
  summary?: string;
  findingsCount: number;
  findings?: string;
  rawContent?: string;
  createdAt: Date;
}

// ============ 报告响应类型 ============

export interface ReportResponse {
  id: string;
  sessionId: string;
  reportType: ReportType;
  workflowType?: WorkflowType;
  title: string;
  mainReport: {
    path: string;
    content: string;
    sections: string[];
  };
  subReports: {
    filename: string;
    title: string;
    path: string;
    content?: string;
  }[];
  sections: {
    id: string;
    title: string;
    order: number;
    content: string;
  }[];
  phaseOutputs?: {
    phaseNumber: number;
    phaseName: string;
    outputPath: string;
    status: FSMPhaseStatus;
    findingsCount: number;
  }[];
  integratedReports: {
    sourcePath: string;
    sourceType: string;
    title?: string;
    summary?: string;
    findingsCount: number;
    findings: any[];
  }[];
  statistics: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  generatedAt: Date;
  dataSources: string[];
}

// ============ FSM API 请求类型 ============

export interface CreateFSMWorkflowRequest {
  name: string;
  description?: string;
  fsmTemplateName: string;
  techStack?: string[];
  isPublic?: boolean;
}

export interface FSMTemplateListResponse {
  templates: FSMTemplateDefinition[];
  total: number;
}
