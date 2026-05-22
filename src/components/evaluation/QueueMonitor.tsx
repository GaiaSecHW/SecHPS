// src/components/evaluation/QueueMonitor.tsx
'use client';

import { useState } from 'react';
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
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useQueueStatus, QueuedEvaluation } from '@/hooks/useQueueStatus';
import { formatBeijingTime } from '@/lib/beijing-time';

interface QueueMonitorProps {
  /** 是否自动刷新（默认 10 秒） */
  autoRefresh?: boolean;
  /** 刷新间隔（毫秒） */
  refreshInterval?: number;
  /** 每页显示排队数量 */
  pageSize?: number;
}

/**
 * 队列状态监控组件
 *
 * 显示当前评估队列状态：
 * - 运行中数量 / 最大并发
 * - 排队中数量
 * - 排队列表（默认收缩，点击展开，支持分页）
 */
export function QueueMonitor({
  autoRefresh = true,
  refreshInterval = 10000,
  pageSize = 5,
}: QueueMonitorProps) {
  const { status, loading, error, refresh, hasActiveEvaluations, hasQueuedEvaluations, isQueueFull } =
    useQueueStatus(autoRefresh ? refreshInterval : 0);

  // 排队列表展开/收缩状态
  const [isExpanded, setIsExpanded] = useState(false);

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);

  // 计算分页信息
  const totalItems = status?.queuedEvaluations?.length || 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentItems = status?.queuedEvaluations?.slice(startIndex, endIndex) || [];

  // 重置分页到第一页（当数据变化时）
  const handleExpand = () => {
    setIsExpanded(!isExpanded);
    if (!isExpanded) {
      setCurrentPage(1);
    }
  };

  // 分页导航
  const goToPrevPage = () => setCurrentPage(Math.max(1, currentPage - 1));
  const goToNextPage = () => setCurrentPage(Math.min(totalPages, currentPage + 1));

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
    <div className="bg-dark-surface rounded-lg shadow-sm border border-gray-700/50 p-4">
      {/* 标题和刷新按钮 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium text-dark-text flex items-center">
          <Zap size={16} className="mr-2 text-indigo-400" />
          调度队列状态
        </h3>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-dark-surface-hover rounded-md transition-colors disabled:opacity-50"
          title="手动刷新"
        >
          <RefreshCw size={16} className={`mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-900/20 border border-red-500/20 text-red-400 px-3 py-2 rounded-md mb-4 flex items-center">
          <AlertTriangle size={16} className="mr-2" />
          {error}
        </div>
      )}

      {/* 状态统计 */}
      {status && (
        <div className="grid grid-cols-3 gap-4 mb-4">
          {/* 运行中 */}
          <div className="bg-blue-900/20 rounded-lg p-3 border border-blue-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Activity size={18} className="text-blue-400 mr-2" />
                <span className="text-sm text-blue-400 font-medium">运行中</span>
              </div>
              <div className="text-right">
                <span className="text-xl font-bold text-blue-400">
                  {status.activeCount}
                </span>
                <span className="text-xs text-blue-500 ml-1">
                  / {status.maxConcurrent}
                </span>
              </div>
            </div>
            {/* 进度条 */}
            <div className="mt-2 w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${(status.activeCount / status.maxConcurrent) * 100}%`,
                }}
              />
            </div>
          </div>

          {/* 排队中 */}
          <div className="bg-yellow-900/20 rounded-lg p-3 border border-yellow-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Hourglass size={18} className="text-yellow-400 mr-2" />
                <span className="text-sm text-yellow-400 font-medium">排队中</span>
              </div>
              <span className="text-xl font-bold text-yellow-400">
                {status.queuedCount}
              </span>
            </div>
            {hasQueuedEvaluations && (
              <p className="mt-1 text-xs text-yellow-500">
                预估等待: ~{status.queuedCount * 5}分钟
              </p>
            )}
          </div>

          {/* 状态 */}
          <div className={`rounded-lg p-3 border ${
            isQueueFull
              ? 'bg-red-900/20 border-red-500/20'
              : hasActiveEvaluations
                ? 'bg-green-500/15 border-green-500/20'
                : 'bg-dark-surface-hover border-gray-700/50'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                {isQueueFull ? (
                  <XCircle size={18} className="text-red-400 mr-2" />
                ) : hasActiveEvaluations ? (
                  <CheckCircle2 size={18} className="text-green-400 mr-2" />
                ) : (
                  <Clock size={18} className="text-gray-500 mr-2" />
                )}
                <span className={`text-sm font-medium ${
                  isQueueFull ? 'text-red-400' : hasActiveEvaluations ? 'text-green-400' : 'text-gray-400'
                }`}>
                  状态
                </span>
              </div>
              <span className={`text-sm font-semibold ${
                isQueueFull ? 'text-red-400' : hasActiveEvaluations ? 'text-green-400' : 'text-gray-400'
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

      {/* 排队列表详情（可展开/收缩） */}
      {status && (
        <div className="border-t border-gray-700/50 pt-4">
          {/* 可点击的标题 */}
          <button
            onClick={handleExpand}
            className="w-full flex items-center justify-between text-sm font-medium text-gray-300 hover:text-gray-100 transition-colors"
          >
            <span className="flex items-center">
              <ListOrdered size={16} className="mr-2 text-gray-500" />
              排队评估列表
              {hasQueuedEvaluations && (
                <span className="ml-2 text-xs text-gray-500">
                  ({status.queuedCount} 个)
                </span>
              )}
            </span>
            <span className="flex items-center text-gray-500">
              {isExpanded ? (
                <>
                  <span className="mr-1 text-xs">收起</span>
                  <ChevronUp size={16} />
                </>
              ) : (
                <>
                  <span className="mr-1 text-xs">展开</span>
                  <ChevronDown size={16} />
                </>
              )}
            </span>
          </button>

          {/* 展开的内容 */}
          {isExpanded && (
            <div className="mt-3">
              {hasQueuedEvaluations ? (
                <>
                  {/* 排队列表 */}
                  <div className="space-y-2">
                    {currentItems.map((evaluation, index) => (
                      <QueueItem
                        key={evaluation.id}
                        evaluation={evaluation}
                        index={startIndex + index}
                        formatWaitTime={formatWaitTime}
                      />
                    ))}
                  </div>

                  {/* 分页控制 */}
                  {totalPages > 1 && (
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        第 {currentPage} / {totalPages} 页，共 {totalItems} 个
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={goToPrevPage}
                          disabled={currentPage === 1}
                          className="flex items-center px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-dark-surface-hover rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ChevronLeft size={14} className="mr-0.5" />
                          上一页
                        </button>
                        <button
                          onClick={goToNextPage}
                          disabled={currentPage === totalPages}
                          className="flex items-center px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-dark-surface-hover rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          下一页
                          <ChevronRight size={14} className="ml-0.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500 text-center py-2">
                  当前没有排队等待的评估
                </p>
              )}
            </div>
          )}
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
    <div className="flex items-center justify-between bg-[#0F172A] rounded-md p-2.5 hover:bg-dark-surface-hover transition-colors">
      <div className="flex items-center min-w-0">
        {/* 排队位置 */}
        <div className="flex-shrink-0 w-6 h-6 bg-yellow-900/30 text-yellow-400 rounded-full flex items-center justify-center text-xs font-semibold mr-3">
          {evaluation.queuePosition}
        </div>

        {/* 项目名 */}
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-100 truncate">
            {evaluation.projectName}
          </p>
          <p className="text-xs text-gray-500 truncate">
            ID: {evaluation.id.slice(0, 8)}...
          </p>
        </div>
      </div>

      {/* 等待时间 */}
      <div className="flex-shrink-0 text-right">
        <p className="text-xs text-gray-400">
          等待: {formatWaitTime(evaluation.createdAt)}
        </p>
        <p className="text-xs text-gray-500">
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
        <Activity size={14} className="text-blue-400 mr-1" />
        <span className="text-blue-400">{status.activeCount}</span>
      </div>

      {/* 排队中 */}
      {hasQueuedEvaluations && (
        <div className="flex items-center">
          <Hourglass size={14} className="text-yellow-400 mr-1" />
          <span className="text-yellow-400">{status.queuedCount}</span>
        </div>
      )}

      {/* 分隔符 */}
      <span className="text-gray-600">|</span>

      {/* 最大并发 */}
      <span className="text-gray-500 text-xs">
        max {status.maxConcurrent}
      </span>
    </div>
  );
}
