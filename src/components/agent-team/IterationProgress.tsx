'use client';

import React from 'react';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  DollarSign,
  Zap,
} from 'lucide-react';

// ============ Props Interface ============

interface IterationProgressProps {
  currentIteration: number;
  maxIterations: number;
  verified: boolean;
  costUsd: number;
  maxCostUsd: number;
  status: 'pending' | 'running' | 'verified' | 'failed';
}

// ============ Status Config ============

const iterationStatusConfig = {
  pending: {
    icon: Clock,
    text: '等待开始',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-200',
    progressColor: 'bg-gray-300',
  },
  running: {
    icon: Loader2,
    text: '迭代中',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    progressColor: 'bg-blue-500',
  },
  verified: {
    icon: CheckCircle,
    text: '验证完成',
    color: 'text-green-500',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    progressColor: 'bg-green-500',
  },
  failed: {
    icon: XCircle,
    text: '迭代失败',
    color: 'text-red-500',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    progressColor: 'bg-red-500',
  },
};

// ============ Helper Functions ============

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(2)}`;
}

function formatPercentage(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

// ============ Sub Components ============

interface ProgressRingProps {
  percentage: number;
  color: string;
  size?: number;
}

function ProgressRing({ percentage, color, size = 60 }: ProgressRingProps) {
  const radius = (size - 4) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#e5e7eb"
          strokeWidth="4"
          fill="none"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color.replace('bg-', '').replace('text-', '')}
          strokeWidth="4"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
          style={{
            stroke: color.includes('green') ? '#22c55e' :
                    color.includes('blue') ? '#3b82f6' :
                    color.includes('red') ? '#ef4444' :
                    '#9ca3af',
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-semibold text-gray-700">
          {percentage}%
        </span>
      </div>
    </div>
  );
}

// ============ Main Component ============

export function IterationProgress({
  currentIteration,
  maxIterations,
  verified,
  costUsd,
  maxCostUsd,
  status,
}: IterationProgressProps) {
  const config = iterationStatusConfig[status];
  const Icon = config.icon;

  const iterationPercentage = formatPercentage(currentIteration, maxIterations);
  const costPercentage = formatPercentage(costUsd, maxCostUsd);

  const isAnimating = status === 'running';

  return (
    <div className={`rounded-lg border p-4 ${config.bgColor} ${config.borderColor}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Icon
            size={20}
            className={`${config.color} ${isAnimating ? 'animate-spin' : ''}`}
          />
          <h3 className="font-semibold text-gray-900">迭代进度</h3>
        </div>

        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium ${config.bgColor} ${config.color}`}
        >
          {config.text}
        </span>
      </div>

      {/* Progress Rings */}
      <div className="flex items-center justify-around mb-4">
        {/* Iteration Progress */}
        <div className="text-center">
          <ProgressRing
            percentage={iterationPercentage}
            color={config.progressColor}
          />
          <p className="mt-2 text-sm text-gray-600">
            迭代 {currentIteration} / {maxIterations}
          </p>
        </div>

        {/* Cost Progress */}
        <div className="text-center">
          <ProgressRing
            percentage={costPercentage}
            color={costPercentage > 80 ? 'bg-red-500' : config.progressColor}
          />
          <p className="mt-2 text-sm text-gray-600">
            成本 {formatCost(costUsd)} / {formatCost(maxCostUsd)}
          </p>
        </div>
      </div>

      {/* Linear Progress Bars */}
      <div className="space-y-3">
        {/* Iteration Bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-1">
              <RefreshCw size={14} className="text-gray-500" />
              <span className="text-xs text-gray-600">迭代进度</span>
            </div>
            <span className="text-xs font-medium text-gray-700">
              {currentIteration} / {maxIterations}
            </span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${config.progressColor}`}
              style={{ width: `${iterationPercentage}%` }}
            />
          </div>
        </div>

        {/* Cost Bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-1">
              <DollarSign size={14} className="text-gray-500" />
              <span className="text-xs text-gray-600">成本消耗</span>
            </div>
            <span className="text-xs font-medium text-gray-700">
              {formatCost(costUsd)} / {formatCost(maxCostUsd)}
            </span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                costPercentage > 80 ? 'bg-red-500' : 'bg-yellow-500'
              }`}
              style={{ width: `${costPercentage}%` }}
            />
          </div>
          {costPercentage > 80 && (
            <p className="mt-1 text-xs text-red-500">
              成本接近上限，请注意控制
            </p>
          )}
        </div>
      </div>

      {/* Verification Status */}
      {verified && (
        <div className="mt-4 pt-3 border-t border-gray-200">
          <div className="flex items-center space-x-2">
            <CheckCircle size={16} className="text-green-500" />
            <span className="text-sm font-medium text-green-700">
              任务验证完成
            </span>
          </div>
        </div>
      )}

      {/* Running Indicator */}
      {status === 'running' && (
        <div className="mt-4 pt-3 border-t border-gray-200">
          <div className="flex items-center justify-center space-x-2 text-blue-600">
            <Zap size={16} className="animate-pulse" />
            <span className="text-sm">正在执行迭代 #{currentIteration}...</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default IterationProgress;