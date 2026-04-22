'use client';

import { ArrowLeft, Square, Loader2, CheckCircle2, Circle, X, FileSearch, MessageSquare, Trash2 } from 'lucide-react';

interface EvaluationHeaderProps {
  status: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  projectName?: string;
  workflowType?: string;
  onStop: () => void;
  onBack: () => void;
  onViewReport?: () => void;
  onAskProgress?: () => void;
  onDelete?: () => void;
  progressQuestion?: string;
  realtimeTokenUsage?: {
    phase: number;
    phaseName: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cumulativeInputTokens: number;
    cumulativeOutputTokens: number;
    cumulativeTotalTokens: number;
  } | null;
  evaluation?: any;
}

// 状态图标
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'failed':
      return <X className="w-4 h-4 text-red-500" />;
    case 'cancelled':
      return <Circle className="w-4 h-4 text-gray-500" />;
    default:
      return <Circle className="w-4 h-4 text-gray-400" />;
  }
}

export function EvaluationHeader({
  status,
  totalInputTokens,
  totalOutputTokens,
  projectName,
  workflowType,
  onStop,
  onBack,
  onViewReport,
  onAskProgress,
  onDelete,
  progressQuestion,
  realtimeTokenUsage,
  evaluation,
}: EvaluationHeaderProps) {
  const totalTokens = totalInputTokens + totalOutputTokens;

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-4">
      {/* 第一行：导航、标题、操作按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button 
            onClick={onBack} 
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={20} />
            <span>返回</span>
          </button>
          
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {projectName || '评估会话详情'}
            </h1>
            <div className="flex items-center space-x-4 text-sm text-gray-500">
              <span>ID: {evaluation?.id}</span>
              <div className="flex items-center gap-1">
                <StatusIcon status={status} />
                <span className={
                  status === 'running' ? 'text-blue-500' :
                  status === 'completed' ? 'text-green-500' :
                  status === 'failed' ? 'text-red-500' : 'text-gray-500'
                }>
                  {status === 'running' ? '运行中' :
                   status === 'completed' ? '已完成' :
                   status === 'failed' ? '失败' :
                   status === 'cancelled' ? '已取消' : status}
                </span>
              </div>
            </div>
          </div>
        </div>
        
        {/* 操作按钮 */}
        <div className="flex items-center space-x-2">
          {/* 查看报告 */}
          {status === 'completed' && onViewReport && (
            <button
              onClick={onViewReport}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-green-600 hover:text-green-800 hover:bg-green-50 rounded border border-green-200"
            >
              <FileSearch size={16} />
              <span>查看报告</span>
            </button>
          )}
          
          {/* 运行中操作 */}
          {status === 'running' && (
            <>
              {onAskProgress && (
                <button
                  onClick={onAskProgress}
                  disabled={!progressQuestion}
                  className={`flex items-center space-x-1 px-3 py-1.5 text-sm font-medium rounded border ${
                    progressQuestion
                      ? 'text-blue-600 hover:text-blue-800 hover:bg-blue-50 border-blue-200'
                      : 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed'
                  }`}
                  title={!progressQuestion ? '请先在"系统配置"中设置"进展询问消息"' : '询问当前评估进展'}
                >
                  <MessageSquare size={16} />
                  <span>询问进展</span>
                </button>
              )}
              <button
                onClick={onStop}
                className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-orange-600 hover:text-orange-800 hover:bg-orange-50 rounded border border-orange-200"
              >
                <Square size={16} />
                <span>停止</span>
              </button>
            </>
          )}
          
          {/* 删除 */}
          {status !== 'running' && onDelete && (
            <button
              onClick={onDelete}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-800 hover:bg-red-50 rounded border border-red-200"
            >
              <Trash2 size={16} />
              <span>删除</span>
            </button>
          )}
        </div>
      </div>
      
      {/* 第二行：Token统计和实时信息 */}
      <div className="flex items-center justify-between text-sm mt-2">
        <div className="flex items-center gap-4">
          {/* Token统计 */}
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Token:</span>
            <span className="font-medium text-blue-600">
              {totalTokens.toLocaleString()}
            </span>
            <span className="text-gray-400">
              (输入: {totalInputTokens.toLocaleString()}, 输出: {totalOutputTokens.toLocaleString()})
            </span>
          </div>
          
          {/* 实时Token */}
          {status === 'running' && realtimeTokenUsage && (
            <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
              <span className="text-gray-500">实时:</span>
              <span className="text-xs font-medium text-gray-700">
                输入 {realtimeTokenUsage.cumulativeInputTokens.toLocaleString()} / 
                输出 {realtimeTokenUsage.cumulativeOutputTokens.toLocaleString()}
              </span>
              <span className="text-xs text-gray-500">模型: {realtimeTokenUsage.modelName}</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* 工作流类型 */}
          {workflowType && (
            <span className="text-gray-500">
              {workflowType === 'fsm' ? 'FSM流程' : 'DAG编排'}
            </span>
          )}
          
          {/* 结束原因 */}
          {evaluation?.endReason && status !== 'running' && (
            <span className="text-xs text-gray-500" title={evaluation.endMessage || ''}>
              ({evaluation.endReason === 'stopped' ? '用户中止' :
                evaluation.endReason === 'error' ? '执行错误' :
                evaluation.endReason === 'completed' ? '正常完成' :
                evaluation.endReason})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}