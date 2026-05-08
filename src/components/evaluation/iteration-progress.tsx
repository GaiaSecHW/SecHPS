'use client';

import React from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Zap,
  Hash,
  Timer,
} from 'lucide-react';
import type { RalphIteration, RalphIterationSummary } from '@/hooks/use-ralph-events';

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function formatTokens(n: number | null): string {
  if (n === null) return '-';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ─────────────────────────────────────────────
// 状态 badge
// ─────────────────────────────────────────────

const STATUS_CONFIG = {
  pending: { label: '等待', color: 'bg-gray-700 text-gray-300', Icon: Clock },
  running: { label: '运行中', color: 'bg-blue-900/30 text-blue-400', Icon: Loader2, spin: true },
  completed: { label: '完成', color: 'bg-green-500/15 text-green-400', Icon: CheckCircle },
  failed: { label: '失败', color: 'bg-red-500/15 text-red-400', Icon: XCircle },
} as const;

type IterationStatus = keyof typeof STATUS_CONFIG;

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as IterationStatus] ?? STATUS_CONFIG.pending;
  const { Icon } = cfg;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon size={12} className={'spin' in cfg && cfg.spin ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  );
}

// ─────────────────────────────────────────────
// 单条迭代行
// ─────────────────────────────────────────────

function IterationRow({ iteration }: { iteration: RalphIteration }) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className="border border-gray-700/50 rounded-lg overflow-hidden">
      {/* 头部行 */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-dark-surface hover:bg-dark-surface-hover transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* 序号 */}
        <span className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-700 text-gray-300 text-sm font-bold shrink-0">
          {iteration.iterationNumber}
        </span>

        {/* 状态 */}
        <StatusBadge status={iteration.status} />

        {/* 验证结果 */}
        {iteration.verificationComplete !== null && (
          <span
            className={`text-xs font-medium ${
              iteration.verificationComplete ? 'text-green-400' : 'text-orange-400'
            }`}
          >
            {iteration.verificationComplete ? '✓ 验证通过' : '✗ 未通过'}
          </span>
        )}

        {/* 统计数据 */}
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-500">
          {iteration.duration !== null && (
            <span className="flex items-center gap-1">
              <Timer size={12} />
              {formatDuration(iteration.duration)}
            </span>
          )}
          {iteration.toolCallCount > 0 && (
            <span className="flex items-center gap-1">
              <Zap size={12} />
              {iteration.toolCallCount} 次工具调用
            </span>
          )}
          {(iteration.inputTokens !== null || iteration.outputTokens !== null) && (
            <span className="flex items-center gap-1">
              <Hash size={12} />
              {formatTokens(iteration.inputTokens)} / {formatTokens(iteration.outputTokens)} tokens
            </span>
          )}
        </div>

        {/* 展开箭头 */}
        {expanded ? <ChevronUp size={16} className="text-gray-500 shrink-0" /> : <ChevronDown size={16} className="text-gray-500 shrink-0" />}
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 bg-[#0F172A] border-t border-gray-700/50 space-y-3">
          {/* 验证原因 */}
          {iteration.verificationReason && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">验证反馈</p>
              <p className="text-sm text-gray-300 bg-dark-surface rounded p-2 border border-gray-700/50">
                {iteration.verificationReason}
              </p>
            </div>
          )}

          {/* 错误信息 */}
          {iteration.errorMessage && (
            <div>
              <p className="text-xs font-medium text-red-400 mb-1">错误信息</p>
              <p className="text-sm text-red-400 bg-red-900/20 rounded p-2 border border-red-500/20">
                {iteration.errorMessage}
              </p>
            </div>
          )}

          {/* AI 响应 */}
          {iteration.responseText && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">AI 响应摘要</p>
              <p className="text-sm text-gray-300 bg-dark-surface rounded p-2 border border-gray-700/50 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {iteration.responseText.length > 500
                  ? `${iteration.responseText.slice(0, 500)}...`
                  : iteration.responseText}
              </p>
            </div>
          )}

          {/* 时间信息 */}
          <div className="flex gap-6 text-xs text-gray-500">
            {iteration.startedAt && (
              <span>开始：{new Date(iteration.startedAt).toLocaleTimeString()}</span>
            )}
            {iteration.completedAt && (
              <span>结束：{new Date(iteration.completedAt).toLocaleTimeString()}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 汇总统计卡片
// ─────────────────────────────────────────────

function SummaryCards({ summary }: { summary: RalphIterationSummary }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-3 text-center">
        <p className="text-2xl font-bold text-gray-100">{summary.total}</p>
        <p className="text-xs text-gray-500 mt-1">总迭代次数</p>
      </div>
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-3 text-center">
        <p className="text-2xl font-bold text-green-400">{summary.verifiedCount}</p>
        <p className="text-xs text-gray-500 mt-1">验证通过</p>
      </div>
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-3 text-center">
        <p className="text-2xl font-bold text-blue-400">
          {formatTokens(summary.totalInputTokens + summary.totalOutputTokens)}
        </p>
        <p className="text-xs text-gray-500 mt-1">总 Token 用量</p>
      </div>
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-3 text-center">
        <p className="text-2xl font-bold text-purple-400">
          {formatDuration(summary.totalDuration)}
        </p>
        <p className="text-xs text-gray-500 mt-1">总耗时</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────

interface IterationProgressProps {
  iterations: RalphIteration[];
  summary: RalphIterationSummary | null;
  evaluationStatus: string | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function IterationProgress({
  iterations,
  summary,
  evaluationStatus,
  isLoading,
  error,
  onRefresh,
}: IterationProgressProps) {
  const isRunning = evaluationStatus === 'running';

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-100">Ralph Loop 迭代记录</h3>
          {isRunning && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/30 text-blue-400">
              <Loader2 size={10} className="animate-spin" />
              运行中
            </span>
          )}
          {evaluationStatus === 'completed' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400">
              <CheckCircle size={10} />
              已完成
            </span>
          )}
          {evaluationStatus === 'failed' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400">
              <XCircle size={10} />
              失败
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700/50 rounded-lg hover:bg-dark-surface-hover disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-900/20 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-3">
          加载失败：{error}
        </div>
      )}

      {/* 汇总统计 */}
      {summary && summary.total > 0 && <SummaryCards summary={summary} />}

      {/* 迭代列表 */}
      {iterations.length === 0 ? (
        <div className="text-center py-10 text-gray-500 text-sm border border-dashed border-gray-700/50 rounded-lg">
          {isLoading ? '加载中...' : '暂无迭代记录，请先启动 Ralph Loop Agent'}
        </div>
      ) : (
        <div className="space-y-2">
          {iterations.map((iter) => (
            <IterationRow key={iter.id} iteration={iter} />
          ))}
        </div>
      )}
    </div>
  );
}
