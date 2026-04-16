'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Clock,
  Sparkles,
  Zap,
  DollarSign,
  History,
  FileText,
} from 'lucide-react';
import type { IterationRecord } from '@/types/ralph-loop-config';

// ============ Props Interface ============

interface IterationHistoryProps {
  iterations: IterationRecord[];
  expanded?: boolean;
  onToggleExpand?: () => void;
}

// ============ Helper Functions ============

function formatTimestamp(date: Date | undefined): string {
  if (!date) return '--';
  return new Date(date).toLocaleTimeString('zh-CN');
}

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(2)}`;
}

function formatTokens(tokens: { input: number; output: number }): string {
  return `${tokens.input.toLocaleString()} / ${tokens.output.toLocaleString()}`;
}

function truncateText(text: string, maxLength: number = 150): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// ============ Sub Components ============

interface IterationCardProps {
  iteration: IterationRecord;
  isExpanded: boolean;
  onToggle: () => void;
}

function IterationCard({ iteration, isExpanded, onToggle }: IterationCardProps) {
  const verified = iteration.verification?.verified ?? false;
  const hasExperience = iteration.experienceQueried && (iteration.experiencesFound ?? 0) > 0;

  return (
    <div
      className={`rounded-lg border transition-all duration-200 ${
        verified
          ? 'bg-green-50 border-green-200'
          : 'bg-gray-50 border-gray-200'
      }`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-100/50"
        onClick={onToggle}
      >
        <div className="flex items-center space-x-3">
          {/* Iteration Number Badge */}
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold ${
              verified
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            #{iteration.iteration}
          </div>

          {/* Status Icon */}
          {verified ? (
            <CheckCircle size={18} className="text-green-500" />
          ) : (
            <XCircle size={18} className="text-gray-400" />
          )}

          {/* Summary */}
          <div>
            <p className="text-sm font-medium text-gray-900">
              迭代 #{iteration.iteration}
              {verified && ' - 验证完成'}
            </p>
            <p className="text-xs text-gray-500">
              {formatTimestamp(iteration.startedAt)}
              {iteration.completedAt && ` → ${formatTimestamp(iteration.completedAt)}`}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Experience Badge */}
          {hasExperience && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
              <Sparkles size={12} className="mr-1" />
              {iteration.experiencesFound} 经验
            </span>
          )}

          {/* Cost */}
          <span className="text-xs text-gray-600">
            {formatCost(iteration.costUsd)}
          </span>

          {/* Expand Toggle */}
          {isExpanded ? (
            <ChevronUp size={16} className="text-gray-500" />
          ) : (
            <ChevronDown size={16} className="text-gray-500" />
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-200 space-y-3">
          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-lg p-2 border border-gray-200">
              <div className="flex items-center space-x-1 mb-1">
                <Zap size={14} className="text-yellow-500" />
                <span className="text-xs text-gray-500">Token</span>
              </div>
              <p className="text-sm font-medium text-gray-900">
                {formatTokens(iteration.tokensUsed)}
              </p>
            </div>

            <div className="bg-white rounded-lg p-2 border border-gray-200">
              <div className="flex items-center space-x-1 mb-1">
                <DollarSign size={14} className="text-green-500" />
                <span className="text-xs text-gray-500">成本</span>
              </div>
              <p className="text-sm font-medium text-gray-900">
                {formatCost(iteration.costUsd)}
              </p>
            </div>

            <div className="bg-white rounded-lg p-2 border border-gray-200">
              <div className="flex items-center space-x-1 mb-1">
                <Clock size={14} className="text-blue-500" />
                <span className="text-xs text-gray-500">状态</span>
              </div>
              <p className="text-sm font-medium text-gray-900">
                {verified ? '完成' : '失败'}
              </p>
            </div>
          </div>

          {/* Result Preview */}
          <div>
            <div className="flex items-center space-x-1 mb-2">
              <FileText size={14} className="text-gray-500" />
              <span className="text-xs font-medium text-gray-700">输出结果</span>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-200 max-h-[200px] overflow-y-auto">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words">
                {truncateText(iteration.result, 500)}
              </pre>
            </div>
          </div>

          {/* Verification Feedback */}
          {iteration.verification?.feedback && (
            <div>
              <div className="flex items-center space-x-1 mb-2">
                {verified ? (
                  <CheckCircle size={14} className="text-green-500" />
                ) : (
                  <XCircle size={14} className="text-red-500" />
                )}
                <span className="text-xs font-medium text-gray-700">验证反馈</span>
              </div>
              <div
                className={`rounded-lg p-3 border ${
                  verified
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <p className="text-xs text-gray-700">
                  {iteration.verification.feedback}
                </p>
              </div>
            </div>
          )}

          {/* Experience Learning Info */}
          {hasExperience && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <div className="flex items-center space-x-2 mb-2">
                <Sparkles size={14} className="text-purple-500" />
                <span className="text-xs font-medium text-purple-700">
                  经验学习
                </span>
              </div>
              <p className="text-xs text-purple-600">
                查询到 {iteration.experiencesFound} 条相关经验用于指导本轮迭代
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ Main Component ============

export function IterationHistory({
  iterations,
  expanded = false,
  onToggleExpand,
}: IterationHistoryProps) {
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  const toggleCard = (iteration: number) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(iteration)) {
        next.delete(iteration);
      } else {
        next.add(iteration);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      // Default behavior: toggle all cards
      if (expandedCards.size === iterations.length) {
        setExpandedCards(new Set());
      } else {
        setExpandedCards(new Set(iterations.map((i) => i.iteration)));
      }
    }
  };

  if (iterations.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center space-x-2 mb-3">
          <History size={18} className="text-gray-400" />
          <h3 className="font-semibold text-gray-900">迭代历史</h3>
        </div>
        <div className="text-center py-6 text-gray-500">
          <History size={32} className="mx-auto mb-2 text-gray-400" />
          <p className="text-sm">暂无迭代记录</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
        onClick={toggleAll}
      >
        <div className="flex items-center space-x-2">
          <History size={18} className="text-blue-500" />
          <h3 className="font-semibold text-gray-900">迭代历史</h3>
          <span className="text-sm text-gray-500">
            ({iterations.length} 次迭代)
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Summary Stats */}
          <span className="text-xs text-gray-600">
            {iterations.filter((i) => i.verification?.verified).length} 成功
          </span>
          <span className="text-xs text-gray-400">|</span>
          <span className="text-xs text-gray-600">
            总成本: {formatCost(
              iterations.reduce((sum, i) => sum + i.costUsd, 0)
            )}
          </span>

          {expanded ? (
            <ChevronUp size={16} className="text-gray-500" />
          ) : (
            <ChevronDown size={16} className="text-gray-500" />
          )}
        </div>
      </div>

      {/* Iterations List */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {iterations.map((iteration) => (
            <IterationCard
              key={iteration.iteration}
              iteration={iteration}
              isExpanded={expandedCards.has(iteration.iteration)}
              onToggle={() => toggleCard(iteration.iteration)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default IterationHistory;