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
}

// 事件数据类型
export interface TodoUpdateEvent {
  evaluationId: string;
  todos: Array<{
    activeForm: string;
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
 * 订阅特定评估的所有事件
 */
export function subscribeToEvaluation(
  evaluationId: string,
  callbacks: {
    onTodoUpdate?: (event: TodoUpdateEvent) => void;
    onNodeComplete?: (event: NodeCompleteEvent) => void;
    onEvaluationComplete?: (event: EvaluationCompleteEvent) => void;
    onMessageChunk?: (event: MessageChunkEvent) => void;
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

  console.log(`[EventBus] SSE subscribed to evaluation ${evaluationId}`);

  // 返回取消订阅函数
  return () => {
    unsubscribers.forEach(unsub => unsub());
    console.log(`[EventBus] SSE unsubscribed from evaluation ${evaluationId}`);
  };
}

export default eventBus;
