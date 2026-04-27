/**
 * 统一执行引擎类型定义
 * 
 * 用于 FSM 工作流和自定义工作流的统一执行引擎
 */

// ============ 节点定义类型 ============

/**
 * 统一节点定义
 * 用于描述工作流中的单个节点
 */
export interface UnifiedNodeDefinition {
  /** 节点唯一标识 */
  id: string;
  /** 工作流 ID */
  workflowId?: string;
  /** 节点显示名称 */
  label: string;
  /** 节点类型 (start, end, task, fsm_phase, etc.) */
  type?: string;
  /** 节点描述 */
  description?: string;
  /** 关联的角色 ID */
  roleId?: string | null;
  /** 节点位置 X */
  positionX?: number;
  /** 节点位置 Y */
  positionY?: number;
  /** 节点数据（解析后的 JSON） */
  data?: Record<string, unknown>;
  /** Skill 文件路径 */
  skillPath?: string | null;
  /** 手工指定的 Skill ID 列表 */
  skills?: string[] | null;
  /** 漏洞分类列表（用于漏洞扫描模式） */
  vulnerabilityCategories?: string[] | null;
  /** FSM 阶段编号 (1-4) */
  fsmPhase?: number | null;
  /** FSM 执行顺序 */
  fsmOrder?: number | null;
  /** 是否为固定节点（不可删除） */
  fsmFixed?: boolean | null;
  /** 节点配置 */
  config?: Record<string, unknown>;
  /** 是否跳过执行 */
  skip?: boolean;
  /** 跳过原因 */
  skipReason?: string;
}

// ============ 模型配置类型 ============

/**
 * 模型配置（用于执行）
 * 从数据库 ModelConfig 模型转换而来
 */
export interface ModelConfigForExecution {
  /** 模型配置 ID */
  id: string;
  /** 配置名称 */
  name: string;
  /** 提供商类型 (openai, anthropic, etc.) */
  providerType: string;
  /** API 密钥 */
  apiKey: string;
  /** API 基础 URL */
  apiBaseUrl?: string;
  /** 可用模型列表（JSON 字符串或数组） */
  models: string | string[];
  /** 模型的 context window 大小，用于 autoCompactWindow */
  contextWindow?: number;
}

// ============ 执行配置类型 ============

/**
 * MCP 服务器配置（用于执行）
 * 从数据库 McpServerConfig 模型转换而来
 */
export interface McpServerConfigForExecution {
  /** MCP 名称 */
  name: string;
  /** MCP 类型 */
  type: 'local' | 'remote';
  /** 本地命令 */
  command?: string;
  /** 命令参数 */
  args?: string[];
  /** 远程 URL */
  url?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否启用 */
  isEnabled?: boolean;
  /** 是否自动启动 */
  autoStart?: boolean;
}

/**
 * 统一执行配置
 * 用于初始化工作流执行引擎
 */
export interface UnifiedExecutionConfig {
  /** 评估会话 ID */
  evaluationSessionId: string;
  /** 项目 ID */
  projectId: string;
  /** 项目名称 */
  projectName: string;
  /** 工作流 ID */
  workflowId: string;
  /** 工作流类型 (fsm, custom, dag) */
  workflowType: 'fsm' | 'custom' | 'dag';
  /** 工作空间路径 */
  workspacePath: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 用户提示词 */
  userPrompt?: string;
  /** 角色模型配置映射 */
  roleModels?: Array<{
    roleId: string;
    modelId: string;
  }>;
  /** 默认模型配置 */
  defaultModelConfig: ModelConfigForExecution;
  /** 技术栈 ID 数组（用于 Skill 匹配） */
  techStackIds?: string[];
  /** MCP 服务器配置（传递给 Claude Agent SDK） */
  mcpServers?: McpServerConfigForExecution[];
  /** 每个节点最大迭代次数 */
  maxIterationsPerNode: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试间隔（毫秒） */
  retryDelayMs: number;
  /** 工作流配置（开始/结束节点描述等） */
  workflowConfig?: {
    startNodeLabel?: string;
    startNodeDescription?: string;
    endNodeLabel?: string;
    endNodeDescription?: string;
    fsmPhasePrompts?: Record<number, string>; // FSM Phase 1-6 的提示词
    fsmTemplateSkillPath?: string; // FSM Template 的 skillPath（用于拼接节点 skillPath）
  };
}

// ============ 执行回调类型 ============

/**
 * 节点执行状态
 */
export type NodeExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'retrying';

/**
 * 工作流执行状态
 */
export type WorkflowExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial' | 'cancelled';

/**
 * 统一执行回调
 * 用于实时推送执行状态和结果
 */
export interface UnifiedExecutionCallbacks {
  /** 节点开始执行 */
  onNodeStart: (nodeIndex: number, nodeId: string, nodeName: string) => void | Promise<void>;
  /** 节点输出流（实时文本） */
  onNodeChunk: (nodeIndex: number, text: string) => void;
  /** 节点工具调用 */
  onNodeToolCall: (nodeIndex: number, tool: string, args: Record<string, unknown>) => void;
  /** Token 使用量更新 */
  onTokenUsage: (data: {
    nodeIndex: number;
    nodeId: string;
    nodeName: string;
    modelName: string;
    modelConfigId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cumulativeInputTokens: number;
    cumulativeOutputTokens: number;
    cumulativeTotalTokens: number;
  }) => void;
  /** 节点重试 */
  onNodeRetry: (nodeIndex: number, nodeId: string, nodeName: string, retryCount: number, maxRetries: number, error: Error) => void;
  /** 节点执行完成 */
  onNodeComplete: (nodeIndex: number, result: NodeExecutionResult) => void | Promise<void>;
  /** 节点执行错误 */
  onNodeError: (nodeIndex: number, nodeId: string, nodeName: string, error: Error) => void;
  /** 工作流执行完成 */
  onWorkflowComplete: (result: WorkflowExecutionResult) => void | Promise<void>;
  /** 工作流执行错误 */
  onWorkflowError: (error: Error) => void;
}

// ============ 执行结果类型 ============

/**
 * 节点执行结果
 */
export interface NodeExecutionResult {
  /** 节点索引 */
  nodeIndex: number;
  /** 节点 ID */
  nodeId: string;
  /** 节点名称 */
  nodeName: string;
  /** 执行状态 */
  status: NodeExecutionStatus;
  /** 输出 YAML 文件路径 */
  outputYamlPath?: string;
  /** 迭代次数 */
  iterations: number;
  /** 重试次数 */
  retryCount: number;
  /** 执行时长（毫秒） */
  duration: number;
  /** 输入 Token 数 */
  inputTokens: number;
  /** 输出 Token 数 */
  outputTokens: number;
  /** 使用的模型名称 */
  modelName: string;
  /** 使用的模型配置 ID */
  modelConfigId: string;
  /** 错误信息 */
  error?: string;
  /** 错误堆栈 */
  errorStack?: string;
}

/**
 * 工作流执行结果
 */
export interface WorkflowExecutionResult {
  /** 会话 ID */
  sessionId: string;
  /** 项目 ID */
  projectId: string;
  /** 项目名称 */
  projectName: string;
  /** 工作流 ID */
  workflowId: string;
  /** 工作流类型 */
  workflowType: 'fsm' | 'custom' | 'dag';
  /** 执行状态 */
  status: WorkflowExecutionStatus;
  /** 各节点执行结果 */
  nodeResults: NodeExecutionResult[];
  /** 总执行时长（毫秒） */
  totalDuration: number;
  /** 总输入 Token 数 */
  totalInputTokens: number;
  /** 总输出 Token 数 */
  totalOutputTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 总成本 */
  totalCost: number;
  /** 开始原因 */
  startReason?: string;
  /** 结束原因 */
  endReason?: string;
  /** 结束消息 */
  endMessage?: string;
  /** 开始时间 */
  startedAt: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 错误信息 */
  error?: string;
  /** 错误堆栈 */
  errorStack?: string;
}

// ============ YAML 输出类型 ============

/**
 * YAML 输出格式
 * 用于节点执行结果的标准化输出
 */
export interface UnifiedYamlOutput {
  /** 执行状态 */
  status: 'success' | 'failure' | 'partial';
  /** 执行摘要 */
  summary: string;
  /** 发现列表 */
  findings?: Array<{
    id: string;
    title: string;
    description: string;
    severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
    category?: string;
    details?: Record<string, unknown>;
  }>;
  /** 生成的文件列表 */
  files?: Array<{
    path: string;
    description?: string;
    size?: number;
  }>;
  /** 建议列表 */
  recommendations?: Array<{
    id: string;
    title: string;
    description: string;
    priority?: 'critical' | 'high' | 'medium' | 'low';
  }>;
  /** 错误列表 */
  errors?: Array<{
    code?: string;
    message: string;
    stack?: string;
    timestamp?: string;
  }>;
  /** 元数据 */
  metadata?: {
    nodeName?: string;
    nodeId?: string;
    executedAt?: string;
    duration?: number;
    modelName?: string;
    iterations?: number;
  };
}

// ============ 辅助类型 ============

/**
 * 角色模型映射
 */
export interface RoleModelMapping {
  roleId: string;
  modelId: string;
  modelName?: string;
}

/**
 * 执行上下文
 * 在节点执行过程中传递的上下文信息
 */
export interface ExecutionContext {
  /** 当前节点索引 */
  currentNodeIndex: number;
  /** 当前节点定义 */
  currentNode: UnifiedNodeDefinition;
  /** 所有节点定义 */
  allNodes: UnifiedNodeDefinition[];
  /** 执行配置 */
  config: UnifiedExecutionConfig;
  /** 累计 Token 使用量 */
  cumulativeTokens: {
    input: number;
    output: number;
  };
  /** 前序节点结果 */
  previousResults: NodeExecutionResult[];
  /** 工作空间路径 */
  workspacePath: string;
}

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试间隔（毫秒） */
  retryDelayMs: number;
  /** 指数退避倍数 */
  backoffMultiplier?: number;
  /** 最大重试间隔（毫秒） */
  maxRetryDelayMs?: number;
  /** 可重试的错误类型 */
  retryableErrors?: string[];
}