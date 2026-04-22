'use client';
 
import { ArrowLeft, Square, Loader2, CheckCircle2, Circle, X, FileSearch, MessageSquare, Trash2, Coins, Info } from 'lucide-react';

// 自适应单位格式化 Token
function formatTokenNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// 预估费用计算（与 dashboard 一致：输入 ¥6/M, 输出 ¥22/M）
function calculateEstimatedCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1000000) * 6;   // ¥6 per million input tokens
  const outputCost = (outputTokens / 1000000) * 22; // ¥22 per million output tokens
  return inputCost + outputCost;
}

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
          {/* Token统计 - 自适应单位 + 预估费用 */}
          <div className="flex items-center gap-2">
            <Coins size={14} className="text-orange-500" />
            <span className="font-medium text-blue-600">
              {formatTokenNumber(totalInputTokens + totalOutputTokens)}
            </span>
            <span className="text-gray-400">
              (输入: {formatTokenNumber(totalInputTokens)}, 输出: {formatTokenNumber(totalOutputTokens)})
            </span>
          </div>
          
          {/* 预估费用 - 带 tooltip */}
          <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
            <span className="text-gray-500">预估费用:</span>
            <span className="font-medium text-orange-600">
              ¥{calculateEstimatedCost(totalInputTokens, totalOutputTokens).toFixed(2)}
            </span>
            <span className="cursor-help relative group">
              <Info size={12} className="text-gray-400 hover:text-gray-600" />
              <span className="absolute left-0 bottom-full mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 whitespace-nowrap z-10 shadow-lg">
                费用 = 输入Token × ¥6/百万 + 输出Token × ¥22/百万
              </span>
            </span>
          </div>
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