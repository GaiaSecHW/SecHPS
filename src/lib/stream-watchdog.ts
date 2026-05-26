// src/lib/stream-watchdog.ts
/**
 * SSE 流健康检查服务 (Watchdog)
 *
 * 监控 Claude SDK 的 SSE 流是否正常：
 * 1. 超时检测：长时间没有消息活动
 * 2. 心跳检测：定期检查流是否存活
 * 3. 异常处理：超时或异常时中止评估并记录原因
 */

import { prisma } from '@/lib/prisma';
import { abortAgent, removeAgent } from '@/lib/agent-registry';
import { logger, LOG_MODULES } from '@/lib/logger';

// ============================================================================
// 类型定义
// ============================================================================

export interface WatchdogConfig {
  /** 评估会话 ID */
  evaluationId: string;
  /** 项目 ID */
  projectId: string;
  
  /** 空闲超时时间（毫秒），默认 2 小时 */
  idleTimeout?: number;
  /** 最大运行时间（毫秒），默认 2 小时 */
  maxRunTime?: number;
  /** 心跳检查间隔（毫秒），默认 30 秒 */
  heartbeatInterval?: number;
  
  /** 超时回调（仅用于 session_not_found 和 manual_abort） */
  onTimeout?: (reason: TimeoutReason) => void;
  /** 心跳回调 */
  onHeartbeat?: (stats: WatchdogStats) => void;
  /** 进展询问回调（空闲超时或运行时间较长时触发） */
  onProgressInquiry?: (reason: 'idle_timeout' | 'max_runtime', stats: WatchdogStats) => void;
}

export interface WatchdogStats {
  /** 启动时间 */
  startTime: number;
  /** 最后活动时间 */
  lastActivityTime: number;
  /** 总消息数 */
  totalMessages: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 当前迭代次数 */
  iterationCount: number;
  /** 运行时长（毫秒） */
  runTime: number;
  /** 空闲时长（毫秒） */
  idleTime: number;
}

export type TimeoutReason = 
  | 'idle_timeout'        // 空闲超时（长时间无消息）
  | 'max_runtime'         // 最大运行时间超限
  | 'stream_error'        // 流错误
  | 'session_not_found'   // 会话不存在
  | 'manual_abort';       // 手动中止

export interface TimeoutDetail {
  reason: TimeoutReason;
  message: string;
  stats: WatchdogStats;
  timestamp: number;
}

// ============================================================================
// 默认配置
// ============================================================================

/** 默认空闲超时：2 小时 */
const DEFAULT_IDLE_TIMEOUT = 7200000;
/** 默认最大运行时间：2 小时 */
const DEFAULT_MAX_RUN_TIME = 7200000;
/** 默认心跳间隔：30 秒 */
const DEFAULT_HEARTBEAT_INTERVAL = 60 * 1000;

// ============================================================================
// StreamWatchdog 类
// ============================================================================

export class StreamWatchdog {
  private config: Required<WatchdogConfig>;
  private startTime: number;
  private lastActivityTime: number;
  private totalMessages: number = 0;
  private totalTokens: number = 0;
  private iterationCount: number = 0;
  
  private heartbeatTimer?: NodeJS.Timeout;
  private idleCheckTimer?: NodeJS.Timeout;
  private maxRunTimer?: NodeJS.Timeout;
  
  private isRunning: boolean = false;
  private isAborted: boolean = false;

  constructor(config: WatchdogConfig) {
    this.config = {
      evaluationId: config.evaluationId,
      projectId: config.projectId,
      idleTimeout: config.idleTimeout ?? DEFAULT_IDLE_TIMEOUT,
      maxRunTime: config.maxRunTime ?? DEFAULT_MAX_RUN_TIME,
      heartbeatInterval: config.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      onTimeout: config.onTimeout ?? (() => {}),
      onHeartbeat: config.onHeartbeat ?? (() => {}),
      onProgressInquiry: config.onProgressInquiry ?? (() => {}),
    };
    
    this.startTime = Date.now();
    this.lastActivityTime = this.startTime;
  }

  /**
   * 启动 Watchdog
   */
  start(): void {
    if (this.isRunning) {
      logger.warn(LOG_MODULES.STREAM, `${this.config.evaluationId} 已经在运行`);
      return;
    }
    
    this.isRunning = true;
    this.startTime = Date.now();
    this.lastActivityTime = this.startTime;
    
    logger.info(LOG_MODULES.STREAM, `启动监控: ${this.config.evaluationId}`);
    logger.info(LOG_MODULES.STREAM, `配置: idleTimeout=${this.config.idleTimeout}ms, maxRunTime=${this.config.maxRunTime}ms`);
    
    // 启动心跳检查
    this.startHeartbeat();
    
    // 启动空闲超时检查
    this.startIdleCheck();
    
    // 启动最大运行时间检查
    this.startMaxRunCheck();
  }

  /**
   * 停止 Watchdog
   */
  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    // 清除所有定时器
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = undefined;
    }
    if (this.maxRunTimer) {
      clearTimeout(this.maxRunTimer);
      this.maxRunTimer = undefined;
    }
    
    logger.info(LOG_MODULES.STREAM, `停止监控: ${this.config.evaluationId}`);
  }

  /**
   * 记录活动（收到消息时调用）
   */
  recordActivity(type: 'message' | 'token' | 'tool_call' | 'iteration', data?: any): void {
    this.lastActivityTime = Date.now();
    
    switch (type) {
      case 'message':
        this.totalMessages++;
        break;
      case 'token':
        this.totalTokens += data?.tokens || 0;
        break;
      case 'iteration':
        this.iterationCount++;
        break;
    }
    
    // 重置空闲检查计时
    this.restartIdleCheck();
  }

  /**
   * 获取当前统计信息
   */
  getStats(): WatchdogStats {
    const now = Date.now();
    return {
      startTime: this.startTime,
      lastActivityTime: this.lastActivityTime,
      totalMessages: this.totalMessages,
      totalTokens: this.totalTokens,
      iterationCount: this.iterationCount,
      runTime: now - this.startTime,
      idleTime: now - this.lastActivityTime,
    };
  }

  /**
   * 检查是否正在运行
   */
  isActive(): boolean {
    return this.isRunning && !this.isAborted;
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.isRunning) return;
      
      const stats = this.getStats();
      
      // 检查评估状态
      this.checkEvaluationStatus().then(status => {
        if (status === 'not_found') {
          this.handleTimeout('session_not_found', '评估会话不存在');
          return;
        }
        if (status === 'cancelled') {
          this.handleTimeout('manual_abort', '评估已被取消');
          return;
        }
        
        // 调用心跳回调
        this.config.onHeartbeat(stats);
        
        logger.info(LOG_MODULES.STREAM, `心跳: ${this.config.evaluationId} | ` +
          `运行=${Math.round(stats.runTime / 1000)}s | ` +
          `空闲=${Math.round(stats.idleTime / 1000)}s | ` +
          `消息=${stats.totalMessages} | ` +
          `迭代=${stats.iterationCount}`);
      });
    }, this.config.heartbeatInterval);
  }

  private startIdleCheck(): void {
    this.idleCheckTimer = setInterval(() => {
      if (!this.isRunning) return;
      
      const stats = this.getStats();
      if (stats.idleTime >= this.config.idleTimeout) {
        // 空闲超时：不中止评估，改为发送进展询问
        logger.warn(LOG_MODULES.STREAM, `空闲超时: ${this.config.evaluationId} (${Math.round(stats.idleTime / 1000)}秒无消息)`);
        logger.info(LOG_MODULES.STREAM, '触发进展询问，不中止评估');
        
        // 调用进展询问回调
        this.config.onProgressInquiry('idle_timeout', stats);
        
        // 重置活动时间，避免频繁触发
        this.lastActivityTime = Date.now();
      }
    }, Math.min(this.config.idleTimeout / 2, 60000)); // 每分钟或超时时间的一半检查一次
  }

  private restartIdleCheck(): void {
    // 空闲检查由定时器自动进行，不需要重启
  }

  private startMaxRunCheck(): void {
    this.maxRunTimer = setTimeout(() => {
      if (!this.isRunning) return;
      
      const stats = this.getStats();
      // 最大运行时间：不中止评估，改为发送进展询问
      logger.warn(LOG_MODULES.STREAM, `运行时间较长: ${this.config.evaluationId} (${Math.round(stats.runTime / 60000)}分钟)`);
      logger.info(LOG_MODULES.STREAM, '触发进展询问，不中止评估');
      
      // 调用进展询问回调
      this.config.onProgressInquiry('max_runtime', stats);
    }, this.config.maxRunTime);
  }

  private async checkEvaluationStatus(): Promise<'running' | 'cancelled' | 'not_found'> {
    try {
      const evaluation = await prisma.evaluationSession.findUnique({
        where: { id: this.config.evaluationId },
        select: { status: true },
      });
      
      if (!evaluation) return 'not_found';
      if (evaluation.status === 'cancelled') return 'cancelled';
      return 'running';
    } catch (error) {
      logger.error(LOG_MODULES.STREAM, '检查评估状态失败', { details: { error: error instanceof Error ? error.message : String(error) } });
      return 'running'; // 出错时假设仍在运行
    }
  }

  private async handleTimeout(reason: TimeoutReason, message: string): Promise<void> {
    if (this.isAborted) return;
    this.isAborted = true;
    
    const stats = this.getStats();
    const detail: TimeoutDetail = {
      reason,
      message,
      stats,
      timestamp: Date.now(),
    };
    
    logger.error(LOG_MODULES.STREAM, `⚠️ 触发超时: ${this.config.evaluationId}`);
    logger.error(LOG_MODULES.STREAM, `原因: ${reason}`);
    logger.error(LOG_MODULES.STREAM, `消息: ${message}`);
    logger.error(LOG_MODULES.STREAM, `统计: ${JSON.stringify(stats)}`);
    
    // 停止监控
    this.stop();
    
    // 中止 Agent
    const aborted = abortAgent(this.config.evaluationId);
    if (aborted) {
      logger.info(LOG_MODULES.STREAM, `已中止 Agent: ${this.config.evaluationId}`);
    }
    
    // 更新数据库状态（保留已累加的 Token）
    try {
      // 先获取当前 Token 值
      const currentTokens = await prisma.evaluationSession.findUnique({
        where: { id: this.config.evaluationId },
        select: {
          totalInputTokens: true,
          totalOutputTokens: true,
          totalTokens: true,
          estimatedCost: true,
        },
      });

      await prisma.evaluationSession.update({
        where: { id: this.config.evaluationId },
        data: {
          status: 'failed',
          endReason: reason,
          endMessage: message,
          errorMessage: message,
          completedAt: new Date(),
          // 保留已累加的 Token
          totalInputTokens: currentTokens?.totalInputTokens ?? 0,
          totalOutputTokens: currentTokens?.totalOutputTokens ?? 0,
          totalTokens: currentTokens?.totalTokens ?? 0,
          estimatedCost: currentTokens?.estimatedCost ?? 0,
        },
      });
      
      await prisma.project.update({
        where: { id: this.config.projectId },
        data: { status: 'failed' },
      });
      
      logger.info(LOG_MODULES.STREAM, `已更新评估状态为 failed, tokens: input=${currentTokens?.totalInputTokens}, output=${currentTokens?.totalOutputTokens}`);
    } catch (error) {
      logger.error(LOG_MODULES.STREAM, '更新数据库失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    }
    
    // 处理队列
    try {
      const { processQueue } = await import('@/services/evaluation-queue');
      processQueue().catch(err => logger.error(LOG_MODULES.STREAM, '处理队列失败', { details: { error: err instanceof Error ? err.message : String(err) } }));
    } catch (error) {
      logger.error(LOG_MODULES.STREAM, '导入队列服务失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    }
    
    // 调用超时回调
    this.config.onTimeout(reason);
  }
}

// ============================================================================
// 全局 Watchdog 注册表
// ============================================================================

const watchdogRegistry = new Map<string, StreamWatchdog>();

/**
 * 创建并启动 Watchdog
 */
export function createWatchdog(config: WatchdogConfig): StreamWatchdog {
  // 如果已存在，先停止旧的
  const existing = watchdogRegistry.get(config.evaluationId);
  if (existing) {
    existing.stop();
  }
  
  const watchdog = new StreamWatchdog(config);
  watchdogRegistry.set(config.evaluationId, watchdog);
  watchdog.start();
  
  return watchdog;
}

/**
 * 获取 Watchdog
 */
export function getWatchdog(evaluationId: string): StreamWatchdog | undefined {
  return watchdogRegistry.get(evaluationId);
}

/**
 * 停止并移除 Watchdog
 */
export function stopWatchdog(evaluationId: string): boolean {
  const watchdog = watchdogRegistry.get(evaluationId);
  if (watchdog) {
    watchdog.stop();
    watchdogRegistry.delete(evaluationId);
    return true;
  }
  return false;
}

/**
 * 记录活动到 Watchdog
 */
export function recordWatchdogActivity(
  evaluationId: string, 
  type: 'message' | 'token' | 'tool_call' | 'iteration',
  data?: any
): void {
  const watchdog = watchdogRegistry.get(evaluationId);
  if (watchdog) {
    watchdog.recordActivity(type, data);
  }
}
