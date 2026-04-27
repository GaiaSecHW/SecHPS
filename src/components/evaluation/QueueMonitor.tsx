// src/components/evaluation/QueueMonitor.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  Hourglass,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  ListOrdered,
  Clock,
  Zap,
} from 'lucide-react';
import { useQueueStatus, QueuedEvaluation } from '@/hooks/useQueueStatus';
import { formatBeijingTime } from '@/lib/beijing-time';

interface QueueMonitorProps {
  /** 是否显示详细排队列表 */
  showDetail?: boolean;
  /** 是否自动刷新（默认 10 秒） */
  autoRefresh?: boolean;
  /** 刷新间隔（毫秒） */
  refreshInterval?: number;
  /** 最大显示排队数量 */
  maxQueueDisplay?: number;
}

/**
 * 队列状态监控组件
 * 
 * 显示当前评估队列状态：
 * - 运行中数量 / 最大并发
 * - 排队中数量
 * - 排队列表（项目名、排队位置、入队时间）
 * 
 * @example
 * // 基础用法
 * <QueueMonitor />
 * 
 * // 显示详细排队列表
 * <QueueMonitor showDetail />
 * 
 * // 禁用自动刷新
 * <QueueMonitor autoRefresh={false} />
 */
export function QueueMonitor({
  showDetail = true,
  autoRefresh = true,
  refreshInterval = 10000,
  maxQueueDisplay = 5,
}: QueueMonitorProps) {
  const { status, loading, error, refresh, hasActiveEvaluations, hasQueuedEvaluations, isQueueFull } =
    useQueueStatus(autoRefresh ? refreshInterval : 0);

  // 格式化等待时间
  const formatWaitTime = (createdAt: Date): string => {
    const now = new Date();
    const start = new Date(createdAt);
    const diffSeconds = Math.floor((now.getTime() - start.getTime()) / 1000);
    
    if (diffSeconds < 60) {
      return `${diffSeconds}秒`;
    }
    if (diffSeconds < 3600) {
      return `${Math.floor(diffSeconds / 60)}分钟`;
    }
    return `${Math.floor(diffSeconds / 3600)}小时`;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      {/* 标题和刷新按钮 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center">
          <Zap size={20} className="mr-2 text-primary-500" />
          调度队列状态
        </h3>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
          title="手动刷新"
        >
          <RefreshCw size={16} className={`mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md mb-4 flex items-center">
          <AlertTriangle size={16} className="mr-2" />
          {error}
        </div>
      )}

      {/* 状态统计 */}
      {status && (
        <div className="grid grid-cols-3 gap-4 mb-4">
          {/* 运行中 */}
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Activity size={18} className="text-blue-500 mr-2" />
                <span className="text-sm text-blue-700 font-medium">运行中</span>
              </div>
              <div className="text-right">
                <span className="text-xl font-bold text-blue-700">
                  {status.activeCount}
                </span>
                <span className="text-xs text-blue-500 ml-1">
                  / {status.maxConcurrent}
                </span>
              </div>
            </div>
            {/* 进度条 */}
            <div className="mt-2 w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${(status.activeCount / status.maxConcurrent) * 100}%`,
                }}
              />
            </div>
          </div>

          {/* 排队中 */}
          <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Hourglass size={18} className="text-yellow-500 mr-2" />
                <span className="text-sm text-yellow-700 font-medium">排队中</span>
              </div>
              <span className="text-xl font-bold text-yellow-700">
                {status.queuedCount}
              </span>
            </div>
            {hasQueuedEvaluations && (
              <p className="mt-1 text-xs text-yellow-600">
                预估等待: ~{status.queuedCount * 5}分钟
              </p>
            )}
          </div>

          {/* 状态 */}
          <div className={`rounded-lg p-3 border ${
            isQueueFull
              ? 'bg-red-50 border-red-100'
              : hasActiveEvaluations
                ? 'bg-green-50 border-green-100'
                : 'bg-gray-50 border-gray-100'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                {isQueueFull ? (
                  <XCircle size={18} className="text-red-500 mr-2" />
                ) : hasActiveEvaluations ? (
                  <CheckCircle2 size={18} className="text-green-500 mr-2" />
                ) : (
                  <Clock size={18} className="text-gray-500 mr-2" />
                )}
                <span className={`text-sm font-medium ${
                  isQueueFull ? 'text-red-700' : hasActiveEvaluations ? 'text-green-700' : 'text-gray-700'
                }`}>
                  状态
                </span>
              </div>
              <span className={`text-sm font-semibold ${
                isQueueFull ? 'text-red-600' : hasActiveEvaluations ? 'text-green-600' : 'text-gray-600'
              }`}>
                {isQueueFull ? '队列已满' : hasActiveEvaluations ? '正常运行' : '空闲'}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              最大并发: {status.maxConcurrent}
            </p>
          </div>
        </div>
      )}

      {/* 排队列表详情 */}
      {showDetail && status?.queuedEvaluations && status.queuedEvaluations.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
            <ListOrdered size={16} className="mr-2 text-gray-500" />
            排队评估列表
            {status.queuedEvaluations.length > maxQueueDisplay && (
              <span className="ml-2 text-xs text-gray-500">
                (显示前 {maxQueueDisplay} 个)
              </span>
            )}
          </h4>
          
          <div className="space-y-2">
            {status.queuedEvaluations.slice(0, maxQueueDisplay).map((evaluation, index) => (
              <QueueItem
                key={evaluation.id}
                evaluation={evaluation}
                index={index}
                formatWaitTime={formatWaitTime}
              />
            ))}
          </div>
          
          {status.queuedEvaluations.length > maxQueueDisplay && (
            <p className="mt-2 text-xs text-gray-500 text-center">
              还有 {status.queuedEvaluations.length - maxQueueDisplay} 个评估在队列中
            </p>
          )}
        </div>
      )}

      {/* 无排队时的提示 */}
      {showDetail && status && !hasQueuedEvaluations && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-500 text-center py-2">
            当前没有排队等待的评估
          </p>
        </div>
      )}

      {/* 加载状态 */}
      {loading && !status && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-t-2 border-primary-500" />
        </div>
      )}
    </div>
  );
}

/**
 * 单个排队项组件
 */
function QueueItem({
  evaluation,
  index,
  formatWaitTime,
}: {
  evaluation: QueuedEvaluation;
  index: number;
  formatWaitTime: (createdAt: Date) => string;
}) {
  return (
    <div className="flex items-center justify-between bg-gray-50 rounded-md p-2.5 hover:bg-gray-100 transition-colors">
      <div className="flex items-center min-w-0">
        {/* 排队位置 */}
        <div className="flex-shrink-0 w-6 h-6 bg-yellow-100 text-yellow-700 rounded-full flex items-center justify-center text-xs font-semibold mr-3">
          {evaluation.queuePosition}
        </div>
        
        {/* 项目名 */}
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {evaluation.projectName}
          </p>
          <p className="text-xs text-gray-500 truncate">
            ID: {evaluation.id.slice(0, 8)}...
          </p>
        </div>
      </div>
      
      {/* 等待时间 */}
      <div className="flex-shrink-0 text-right">
        <p className="text-xs text-gray-600">
          等待: {formatWaitTime(evaluation.createdAt)}
        </p>
        <p className="text-xs text-gray-400">
          {formatBeijingTime(evaluation.createdAt, 'short')}
        </p>
      </div>
    </div>
  );
}

/**
 * 简化版队列状态指示器
 * 仅显示运行/排队数量
 */
export function QueueStatusIndicator() {
  const { status, loading, hasActiveEvaluations, hasQueuedEvaluations } = useQueueStatus();

  if (loading || !status) {
    return null;
  }

  return (
    <div className="flex items-center space-x-2 text-sm">
      {/* 运行中 */}
      <div className="flex items-center">
        <Activity size={14} className="text-blue-500 mr-1" />
        <span className="text-blue-700">{status.activeCount}</span>
      </div>
      
      {/* 排队中 */}
      {hasQueuedEvaluations && (
        <div className="flex items-center">
          <Hourglass size={14} className="text-yellow-500 mr-1" />
          <span className="text-yellow-700">{status.queuedCount}</span>
        </div>
      )}
      
      {/* 分隔符 */}
      <span className="text-gray-300">|</span>
      
      {/* 最大并发 */}
      <span className="text-gray-500 text-xs">
        max {status.maxConcurrent}
      </span>
    </div>
  );
}