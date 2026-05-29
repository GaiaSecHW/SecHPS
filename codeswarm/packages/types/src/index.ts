import { z } from 'zod';

// ============================================================================
// Task State Enum
// ============================================================================

export const TaskStateEnum = z.enum([
  'queued',
  'dispatched',
  'building',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export type TaskState = z.infer<typeof TaskStateEnum>;

// ============================================================================
// MCP Service Types
// ============================================================================

export const MCPServiceLocalSchema = z.object({
  type: z.literal('local'),
  command: z.array(z.string()),
  environment: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
  timeout: z.number().optional(),
});

export const MCPServiceRemoteSchema = z.object({
  type: z.literal('remote'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
  timeout: z.number().optional(),
});

export const MCPServiceSchema = z.discriminatedUnion('type', [
  MCPServiceLocalSchema,
  MCPServiceRemoteSchema,
]);

export type MCPServiceLocal = z.infer<typeof MCPServiceLocalSchema>;
export type MCPServiceRemote = z.infer<typeof MCPServiceRemoteSchema>;
export type MCPService = z.infer<typeof MCPServiceSchema>;

// ============================================================================
// Skill Definition
// ============================================================================

export const SkillDefSchema = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string(),
  description: z.string().optional(),
  requiresMcp: z.array(z.string()).optional(),
});

export type SkillDef = z.infer<typeof SkillDefSchema>;

// ============================================================================
// Task Request (User submission)
// ============================================================================

export const TaskRequestSchema = z.object({
  instruction: z.string(),
  projectId: z.string().optional(),
  skills: z.array(z.string()).optional(),
  mcps: z.array(z.string()).optional(),
  model: z.string().optional(),
  timeoutSec: z.number().optional(),
  apiKey: z.string().optional(),
});

export type TaskRequest = z.infer<typeof TaskRequestSchema>;

// ============================================================================
// Task (Full task with state)
// ============================================================================

export const TaskSchema = z.object({
  taskId: z.string(),
  state: TaskStateEnum,
  request: TaskRequestSchema,
  assignedNode: z.string().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
  startedAt: z.string().or(z.date()).optional(),
  completedAt: z.string().or(z.date()).optional(),
});

export type Task = z.infer<typeof TaskSchema>;

// ============================================================================
// Task Payload (Orchestrator → Worker)
// ============================================================================

export const TaskPayloadSchema = z.object({
  taskId: z.string(),
  instruction: z.string().nullable().optional(),
  projectPath: z.string().optional().default(''),
  skills: z.array(z.string()).optional().default([]),
  scripts: z.array(z.string()).optional().default([]),
  mcps: z.array(z.union([MCPServiceSchema, z.string()])).optional().default([]),
  model: z.string().optional(),
  timeoutSec: z.number().optional(),
  apiKey: z.string().optional(),
  // API base URL for custom endpoints (e.g. private model router)
  apiBaseUrl: z.string().optional(),
  // Workspace path (legacy, prefer workspaceStorageKey)
  workspacePath: z.string().optional(),
  // MinIO workspace object key
  workspaceStorageKey: z.string().optional(),
  // Override callback URL (orchestrator backend address)
  callbackUrl: z.string().optional(),
  // Extra environment variables to pass to the OpenCode process
  env: z.record(z.string(), z.string()).optional(),
  // Execution engine (opencode, claudecode)
  engine: z.enum(['opencode', 'claudecode']).optional(),
  // Agent name (e.g. nazhua-audit)
  agent: z.string().optional(),
  // Preferred worker nodeId for manual scheduling (空则自动分配)
  preferredWorkerNodeId: z.string().optional(),
  // Target product name, used as codedmap db filename ({targetProduct}.db)
  targetProduct: z.string().optional(),
});

export type TaskPayload = z.infer<typeof TaskPayloadSchema>;

// ============================================================================
// Worker Event Types
// ============================================================================

export const WorkerEventTypeEnum = z.enum([
  'agent_message_chunk',
  'tool_call',
  'tool_call_update',
  'error',
  'phase_error',         // 非致命阶段级错误（如标题生成失败、rate limit）
  'log_chunk',           // Worker层日志块
  'agent_log_chunk',     // Agent层日志块（替代ACP，直接捕获stdout）
  'agent_output',        // Agent结构化输出
  'tool_result',         // 工具执行结果
  'progress',            // 进度节点（如 "正在克隆仓库"）
  'tool_duration',       // tool 执行耗时
  'heartbeat',           // Worker 心跳日志
  'cancel_confirmed',    // 取消确认
  'continuation_attempt',    // 续推尝试
  'continuation_success',   // 续推成功恢复（同 session）
  'continuation_fallback',  // 续推降级（destroy 新 session）
  'task_started',        // 任务开始
  'task_completed',      // 任务完成
]);

export type WorkerEventType = z.infer<typeof WorkerEventTypeEnum>;

export const WorkerEventSchema = z.object({
  type: WorkerEventTypeEnum,
  timestamp: z.string().or(z.date()),
  data: z.unknown().optional(),
});

export type WorkerEvent = z.infer<typeof WorkerEventSchema>;

// ============================================================================
// Worker Events (Worker → Orchestrator)
// ============================================================================

export const WorkerEventsSchema = z.object({
  taskId: z.string(),
  nodeId: z.string(),
  events: z.array(WorkerEventSchema),
});

export type WorkerEvents = z.infer<typeof WorkerEventsSchema>;

// ============================================================================
// Task Result (Worker → Orchestrator)
// ============================================================================

export const TaskResultStatusEnum = z.enum([
  'running',
  'completed',
  'failed',
]);

export type TaskResultStatus = z.infer<typeof TaskResultStatusEnum>;

export const TaskResultSchema = z.object({
  taskId: z.string(),
  nodeId: z.string(),
  status: TaskResultStatusEnum,
  result: z.string().optional(),
  error: z.string().optional(),
  // Security report content (reports.jsonl raw text)
  reportContent: z.string().optional(),
  // MinIO results object key (uploaded by Worker after execution)
  resultStorageKey: z.string().optional(),
});

export type TaskResult = z.infer<typeof TaskResultSchema>;

// ============================================================================
// Agent Node (Worker registration)
// ============================================================================

export const AgentNodeStatusEnum = z.enum([
  'online',
  'offline',
  'busy',
  'draining',
]);

export type AgentNodeStatus = z.infer<typeof AgentNodeStatusEnum>;

export const AgentNodeSchema = z.object({
  nodeId: z.string(),
  address: z.string(),
  status: AgentNodeStatusEnum,
  maxConcurrent: z.number(),
  currentTasks: z.number().default(0),
  capabilities: z.array(z.string()).optional(),
  lastHeartbeat: z.string().or(z.date()),
});

export type AgentNode = z.infer<typeof AgentNodeSchema>;

