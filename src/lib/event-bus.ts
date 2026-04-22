// src/lib/event-bus.ts
/**
 * 全局事件总线
 * 用于在评估进程和前端之间广播事件
 */

import { EventEmitter } from 'events';

// 全局事件发射器实例
const eventBus = new EventEmitter();

// 增加最大监听器数量，避免内存泄漏警告
eventBus.setMaxListeners(100);

// 事件类型
export enum EventType {
  TODO_UPDATE = 'todo_update',
  NODE_COMPLETE = 'node_complete',
  EVALUATION_COMPLETE = 'evaluation_complete',
  EVALUATION_PROGRESS = 'evaluation_progress',
  MESSAGE_CHUNK = 'message_chunk',
  PHASE_TOKEN_USAGE = 'phase_token_usage',
  PHASE_START = 'phase_start',
  PREPARING_PROGRESS = 'preparing_progress',  // MCP/准备阶段进度
  EVALUATION_STARTED = 'evaluation_started',   // 评估正式开始
}

// 事件数据类型
export interface TodoUpdateEvent {
  evaluationId: string;
  nodeId?: string;  // 节点 ID（用于按节点过滤显示）
  nodeIndex?: number;  // 节点序号（用于节点卡片显示）
  todos: Array<{
    activeForm?: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
  timestamp: number;
}

export interface NodeCompleteEvent {
  evaluationId: string;
  nodeId: string;
  timestamp: number;
}

export interface EvaluationCompleteEvent {
  evaluationId: string;
  result: any;
  timestamp: number;
}

export interface MessageChunkEvent {
  evaluationId: string;
  content: string;
  timestamp: number;
}

export interface PhaseTokenUsageEvent {
  evaluationId: string;
  nodeIndex: number;
  nodeName?: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  timestamp: number;
}

export interface PhaseStartEvent {
  evaluationId: string;
  nodeIndex: number;
  nodeId: string;
  nodeName: string;
  modelName: string;
  totalNodes: number;
  timestamp: number;
}

// 准备阶段进度事件（MCP 执行等）
export interface PreparingProgressEvent {
  evaluationId: string;
  stage: 'mcp_start' | 'mcp_complete' | 'mcp_error' | 'skills_sync' | 'topology_sort' | 'evaluation_start' | 'error';
  message: string;
  error?: string;
  duration?: number;
  timestamp: number;
}

// 评估正式开始事件
export interface EvaluationStartedEvent {
  evaluationId: string;
  workflowType: 'fsm' | 'dag';
  message: string;
  timestamp: number;
}

/**
 * 发送 TODO 更新事件
 */
export function emitTodoUpdate(evaluationId: string, todos: TodoUpdateEvent['todos']) {
  const event: TodoUpdateEvent = {
    evaluationId,
    todos,
    timestamp: Date.now(),
  };
  eventBus.emit(EventType.TODO_UPDATE, event);
  console.log(`[EventBus] TODO update emitted for evaluation ${evaluationId}:`, todos.length, 'items');
}

/**
 * 发送节点完成事件
 */
export function emitNodeComplete(evaluationId: string, nodeId: string) {
  const event: NodeCompleteEvent = {
    evaluationId,
    nodeId,
    timestamp: Date.now(),
  };
  eventBus.emit(EventType.NODE_COMPLETE, event);
}

/**
 * 发送评估完成事件
 */
export function emitEvaluationComplete(evaluationId: string, result: any) {
  const event: EvaluationCompleteEvent = {
    evaluationId,
    result,
    timestamp: Date.now(),
  };
  eventBus.emit(EventType.EVALUATION_COMPLETE, event);
}

/**
 * 发送消息块事件
 */
export function emitMessageChunk(evaluationId: string, content: string) {
  const event: MessageChunkEvent = {
    evaluationId,
    content,
    timestamp: Date.now(),
  };
  eventBus.emit(EventType.MESSAGE_CHUNK, event);
}

/**
 * 发送 Token 使用量事件
 */
export function emitPhaseTokenUsage(evaluationId: string, data: {
  nodeIndex: number;
  nodeName?: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
}) {
  const event: PhaseTokenUsageEvent = {
    evaluationId,
    nodeIndex: data.nodeIndex,
    nodeName: data.nodeName,
    modelName: data.modelName,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    cumulativeInputTokens: data.cumulativeInputTokens,
    cumulativeOutputTokens: data.cumulativeOutputTokens,
    timestamp: Date.now(),
  };
  eventBus.emit(EventType.PHASE_TOKEN_USAGE, event);
  console.log(`[EventBus] Token usage emitted for evaluation ${evaluationId}:`, data.nodeIndex, data.modelName, 'input:', data.inputTokens, 'output:', data.outputTokens);
}

/**
 * 发送节点开始事件
 */
export function emitPhaseStart(evaluationId: string, data: {
  nodeIndex: number;
  nodeId: string;
  nodeName: string;
  modelName: string;
  totalNodes: number;
}) {
  const event: PhaseStartEvent = {
    evaluationId,
    nodeIndex: data.nodeIndex,
    nodeId: data.nodeId,
    nodeName: data.nodeName,
    modelName: data.modelName,
    totalNodes: data.totalNodes,
    timestamp: Date.now(),
  };
  eventBus.emit(EventType.PHASE_START, event);
  console.log(`[EventBus] Phase start emitted for evaluation ${evaluationId}:`, data.nodeIndex, data.nodeName);
}

/**
 * 发送准备阶段进度事件
 */
export function emitPreparingProgress(evaluationId: string, data: {
  stage: 'mcp_start' | 'mcp_complete' | 'mcp_error' | 'skills_sync' | 'topology_sort' | 'evaluation_start' | 'error';
  message: string;
  error?: string;
  duration?: number;
}) {
  const event: PreparingProgressEvent = {
    evaluationId,
    stage: data.stage,
    message: data.message,
    error: data.error,
    duration: data.duration,
    timestamp: Date.now(),
  };
  eventBus.emit(EventType.PREPARING_PROGRESS, event);
  console.log(`[EventBus] Preparing progress emitted for evaluation ${evaluationId}:`, data.stage, data.message);
}

/**
 * 发送评估正式开始事件
 */
export function emitEvaluationStarted(evaluationId: string, data: {
  workflowType: 'fsm' | 'dag';
  message: string;
}) {
  const event: EvaluationStartedEvent = {
    evaluationId,
    workflowType: data.workflowType,
    message: data.message,
    timestamp: Date.now(),
  };
  eventBus.emit(EventType.EVALUATION_STARTED, event);
  console.log(`[EventBus] Evaluation started emitted for evaluation ${evaluationId}:`, data.workflowType);
}

/**
 * 订阅 TODO 更新事件
 */
export function onTodoUpdate(callback: (event: TodoUpdateEvent) => void) {
  eventBus.on(EventType.TODO_UPDATE, callback);
  return () => eventBus.off(EventType.TODO_UPDATE, callback);
}

/**
 * 订阅节点完成事件
 */
export function onNodeComplete(callback: (event: NodeCompleteEvent) => void) {
  eventBus.on(EventType.NODE_COMPLETE, callback);
  return () => eventBus.off(EventType.NODE_COMPLETE, callback);
}

/**
 * 订阅评估完成事件
 */
export function onEvaluationComplete(callback: (event: EvaluationCompleteEvent) => void) {
  eventBus.on(EventType.EVALUATION_COMPLETE, callback);
  return () => eventBus.off(EventType.EVALUATION_COMPLETE, callback);
}

/**
 * 订阅消息块事件
 */
export function onMessageChunk(callback: (event: MessageChunkEvent) => void) {
  eventBus.on(EventType.MESSAGE_CHUNK, callback);
  return () => eventBus.off(EventType.MESSAGE_CHUNK, callback);
}

/**
 * 订阅 Token 使用量事件
 */
export function onPhaseTokenUsage(callback: (event: PhaseTokenUsageEvent) => void) {
  eventBus.on(EventType.PHASE_TOKEN_USAGE, callback);
  return () => eventBus.off(EventType.PHASE_TOKEN_USAGE, callback);
}

/**
 * 订阅节点开始事件
 */
export function onPhaseStart(callback: (event: PhaseStartEvent) => void) {
  eventBus.on(EventType.PHASE_START, callback);
  return () => eventBus.off(EventType.PHASE_START, callback);
}

/**
 * 订阅特定评估的所有事件
 */
export function subscribeToEvaluation(
  evaluationId: string,
  callbacks: {
    onTodoUpdate?: (event: TodoUpdateEvent) => void;
    onNodeComplete?: (event: NodeCompleteEvent) => void;
    onEvaluationComplete?: (event: EvaluationCompleteEvent) => void;
    onMessageChunk?: (event: MessageChunkEvent) => void;
    onPhaseTokenUsage?: (event: PhaseTokenUsageEvent) => void;
    onPhaseStart?: (event: PhaseStartEvent) => void;
  }
) {
  const unsubscribers: (() => void)[] = [];

  if (callbacks.onTodoUpdate) {
    const handler = (event: TodoUpdateEvent) => {
      if (event.evaluationId === evaluationId) {
        callbacks.onTodoUpdate!(event);
      }
    };
    eventBus.on(EventType.TODO_UPDATE, handler);
    unsubscribers.push(() => eventBus.off(EventType.TODO_UPDATE, handler));
  }

  if (callbacks.onNodeComplete) {
    const handler = (event: NodeCompleteEvent) => {
      if (event.evaluationId === evaluationId) {
        callbacks.onNodeComplete!(event);
      }
    };
    eventBus.on(EventType.NODE_COMPLETE, handler);
    unsubscribers.push(() => eventBus.off(EventType.NODE_COMPLETE, handler));
  }

  if (callbacks.onEvaluationComplete) {
    const handler = (event: EvaluationCompleteEvent) => {
      if (event.evaluationId === evaluationId) {
        callbacks.onEvaluationComplete!(event);
      }
    };
    eventBus.on(EventType.EVALUATION_COMPLETE, handler);
    unsubscribers.push(() => eventBus.off(EventType.EVALUATION_COMPLETE, handler));
  }

  if (callbacks.onMessageChunk) {
    const handler = (event: MessageChunkEvent) => {
      if (event.evaluationId === evaluationId) {
        callbacks.onMessageChunk!(event);
      }
    };
    eventBus.on(EventType.MESSAGE_CHUNK, handler);
    unsubscribers.push(() => eventBus.off(EventType.MESSAGE_CHUNK, handler));
  }

  if (callbacks.onPhaseTokenUsage) {
    const handler = (event: PhaseTokenUsageEvent) => {
      if (event.evaluationId === evaluationId) {
        callbacks.onPhaseTokenUsage!(event);
      }
    };
    eventBus.on(EventType.PHASE_TOKEN_USAGE, handler);
    unsubscribers.push(() => eventBus.off(EventType.PHASE_TOKEN_USAGE, handler));
  }

  if (callbacks.onPhaseStart) {
    const handler = (event: PhaseStartEvent) => {
      if (event.evaluationId === evaluationId) {
        callbacks.onPhaseStart!(event);
      }
    };
    eventBus.on(EventType.PHASE_START, handler);
    unsubscribers.push(() => eventBus.off(EventType.PHASE_START, handler));
  }

  // 返回取消订阅函数
  return () => {
    unsubscribers.forEach(unsub => unsub());
  };
}

/**
 * 订阅特定评估的所有事件（简化版 - 单回调）
 * 用于 SSE 重连场景，将所有事件转发到 SSE 流
 * @param evaluationId 评估 ID
 * @param callback 事件回调函数，接收所有类型的事件
 * @returns 取消订阅函数
 */
export function subscribeToEvaluationEvents(
  evaluationId: string,
  callback: (event: any) => void
): () => void {
  const unsubscribers: (() => void)[] = [];

  // 订阅 TODO 更新事件
  const todoHandler = (event: TodoUpdateEvent) => {
    if (event.evaluationId === evaluationId) {
      callback({ type: 'todo_update', ...event });
    }
  };
  eventBus.on(EventType.TODO_UPDATE, todoHandler);
  unsubscribers.push(() => eventBus.off(EventType.TODO_UPDATE, todoHandler));

  // 订阅节点完成事件
  const nodeHandler = (event: NodeCompleteEvent) => {
    if (event.evaluationId === evaluationId) {
      callback({ type: 'node_complete', ...event });
    }
  };
  eventBus.on(EventType.NODE_COMPLETE, nodeHandler);
  unsubscribers.push(() => eventBus.off(EventType.NODE_COMPLETE, nodeHandler));

  // 订阅评估完成事件
  const evalHandler = (event: EvaluationCompleteEvent) => {
    if (event.evaluationId === evaluationId) {
      callback({ type: 'evaluation_complete', ...event });
    }
  };
  eventBus.on(EventType.EVALUATION_COMPLETE, evalHandler);
  unsubscribers.push(() => eventBus.off(EventType.EVALUATION_COMPLETE, evalHandler));

  // 订阅消息块事件
  const msgHandler = (event: MessageChunkEvent) => {
    if (event.evaluationId === evaluationId) {
      callback({ type: 'message_chunk', ...event });
    }
  };
  eventBus.on(EventType.MESSAGE_CHUNK, msgHandler);
  unsubscribers.push(() => eventBus.off(EventType.MESSAGE_CHUNK, msgHandler));

  // 订阅 Token 使用量事件
  const tokenHandler = (event: PhaseTokenUsageEvent) => {
    if (event.evaluationId === evaluationId) {
      callback({ 
        type: 'phase_token_usage', 
        nodeIndex: event.nodeIndex,
        nodeName: event.nodeName,
        modelName: event.modelName,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cumulativeInputTokens: event.cumulativeInputTokens,
        cumulativeOutputTokens: event.cumulativeOutputTokens,
      });
    }
  };
  eventBus.on(EventType.PHASE_TOKEN_USAGE, tokenHandler);
  unsubscribers.push(() => eventBus.off(EventType.PHASE_TOKEN_USAGE, tokenHandler));

  // 订阅节点开始事件
  const phaseStartHandler = (event: PhaseStartEvent) => {
    if (event.evaluationId === evaluationId) {
      callback({
        type: 'phase_start',
        nodeIndex: event.nodeIndex,
        nodeId: event.nodeId,
        nodeName: event.nodeName,
        modelName: event.modelName,
        totalNodes: event.totalNodes,
      });
    }
  };
  eventBus.on(EventType.PHASE_START, phaseStartHandler);
  unsubscribers.push(() => eventBus.off(EventType.PHASE_START, phaseStartHandler));

  // 订阅准备阶段进度事件
  const preparingHandler = (event: PreparingProgressEvent) => {
    if (event.evaluationId === evaluationId) {
      callback({
        type: 'preparing_progress',
        stage: event.stage,
        message: event.message,
        error: event.error,
        duration: event.duration,
      });
    }
  };
  eventBus.on(EventType.PREPARING_PROGRESS, preparingHandler);
  unsubscribers.push(() => eventBus.off(EventType.PREPARING_PROGRESS, preparingHandler));

  // 订阅评估正式开始事件
  const startedHandler = (event: EvaluationStartedEvent) => {
    if (event.evaluationId === evaluationId) {
      callback({
        type: 'evaluation_started',
        workflowType: event.workflowType,
        message: event.message,
      });
    }
  };
  eventBus.on(EventType.EVALUATION_STARTED, startedHandler);
  unsubscribers.push(() => eventBus.off(EventType.EVALUATION_STARTED, startedHandler));

  console.log(`[EventBus] SSE subscribed to evaluation ${evaluationId}`);

  // 返回取消订阅函数
  return () => {
    unsubscribers.forEach(unsub => unsub());
    console.log(`[EventBus] SSE unsubscribed from evaluation ${evaluationId}`);
  };
}

export default eventBus;
