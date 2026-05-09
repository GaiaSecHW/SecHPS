'use client';

import React from 'react';
import { Loader2, CheckCircle, AlertCircle, Clock } from 'lucide-react';

export type ProgressStatus = 'idle' | 'connecting' | 'streaming' | 'completed' | 'error';

interface EvaluationProgressProps {
  status: ProgressStatus;
  progress?: number; // 0-100
  message?: string;
  errorMessage?: string;
}

const statusConfig = {
  idle: {
    icon: Clock,
    text: '等待开始',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
  },
  connecting: {
    icon: Loader2,
    text: '连接中...',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
  },
  streaming: {
    icon: Loader2,
    text: '评估进行中',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  completed: {
    icon: CheckCircle,
    text: '评估完成',
    color: 'text-green-500',
    bgColor: 'bg-green-50',
  },
  error: {
    icon: AlertCircle,
    text: '评估失败',
    color: 'text-red-500',
    bgColor: 'bg-red-50',
  },
};

export function EvaluationProgress({
  status,
  progress,
  message,
  errorMessage,
}: EvaluationProgressProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const isAnimating = status === 'connecting' || status === 'streaming';

  return (
    <div className={`${config.bgColor} rounded-lg p-4`}>
      <div className="flex items-center space-x-3">
        <Icon
          size={24}
          className={`${config.color} ${isAnimating ? 'animate-spin' : ''}`}
        />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className={`font-medium ${config.color}`}>
              {config.text}
            </span>
            {progress !== undefined && status === 'streaming' && (
              <span className="text-sm text-gray-500">{progress}%</span>
            )}
          </div>
          {message && (
            <p className="text-sm text-gray-600 mt-1">{message}</p>
          )}
          {errorMessage && status === 'error' && (
            <p className="text-sm text-red-600 mt-1">{errorMessage}</p>
          )}
        </div>
      </div>

      {/* 进度条 */}
      {status === 'streaming' && progress !== undefined && (
        <div className="mt-3">
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
