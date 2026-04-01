'use client';

import { useState, useEffect } from 'react';
import { 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Loader2, 
  ChevronDown, 
  ChevronRight,
  Play,
  Trash2,
  Eye
} from 'lucide-react';

// 执行状态类型
type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

// API 响应类型
interface ExecutionStep {
  id: string;
  executionId: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: StepStatus;
  input: any;
  output: any;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Execution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  variables: any;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  steps: ExecutionStep[];
}

interface ExecutionMonitorProps {
  workflowId?: string;
  onSelectExecution?: (execution: Execution) => void;
}

// 状态图标和颜色映射
const statusConfig = {
  pending: { icon: Clock, color: 'text-gray-500', bg: 'bg-gray-100' },
  running: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-50' },
  completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50' },
  failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
  cancelled: { icon: AlertCircle, color: 'text-yellow-500', bg: 'bg-yellow-50' },
};

const stepStatusConfig = {
  pending: { icon: Clock, color: 'text-gray-400' },
  running: { icon: Loader2, color: 'text-blue-500 animate-spin' },
  completed: { icon: CheckCircle2, color: 'text-green-500' },
  failed: { icon: XCircle, color: 'text-red-500' },
  skipped: { icon: AlertCircle, color: 'text-gray-400' },
};

export default function ExecutionMonitor({ workflowId, onSelectExecution }: ExecutionMonitorProps) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedExecutions, setExpandedExecutions] = useState<Set<string>>(new Set());
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);

  // 加载执行列表
  useEffect(() => {
    fetchExecutions();
  }, [workflowId]);

  const fetchExecutions = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const url = workflowId 
        ? `/api/executions?workflowId=${workflowId}`
        : '/api/executions';

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取执行记录失败');
      }

      const data = await response.json();
      setExecutions(data.executions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // 取消执行
  const handleCancel = async (executionId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/executions/${executionId}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('取消执行失败');
      }

      fetchExecutions();
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消失败');
    }
  };

  // 删除执行记录
  const handleDelete = async (executionId: string) => {
    if (!confirm('确定要删除此执行记录吗？')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/executions/${executionId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('删除失败');
      }

      fetchExecutions();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 切换展开状态
  const toggleExpand = (executionId: string) => {
    const newExpanded = new Set(expandedExecutions);
    if (newExpanded.has(executionId)) {
      newExpanded.delete(executionId);
    } else {
      newExpanded.add(executionId);
    }
    setExpandedExecutions(newExpanded);
  };

  // 查看执行详情
  const handleViewDetails = async (executionId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/executions/${executionId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取执行详情失败');
      }

      const data = await response.json();
      setSelectedExecution(data.execution);
      onSelectExecution?.(data.execution);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取详情失败');
    }
  };

  // 格式化时间
  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  // 计算执行时长
  const getDuration = (execution: Execution) => {
    if (!execution.startedAt) return '-';
    const start = new Date(execution.startedAt).getTime();
    const end = execution.completedAt 
      ? new Date(execution.completedAt).getTime() 
      : Date.now();
    const seconds = Math.floor((end - start) / 1000);
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}分${remainingSeconds}秒`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        {error}
        <button 
          onClick={fetchExecutions}
          className="ml-4 text-red-600 hover:text-red-800 underline"
        >
          重试
        </button>
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Play className="w-12 h-12 mx-auto mb-4 text-gray-300" />
        <p>暂无执行记录</p>
        <p className="text-sm mt-2">运行工作流后，执行记录将显示在这里</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 执行列表 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">执行历史</h3>
        </div>
        <div className="divide-y divide-gray-200">
          {executions.map((execution) => {
            const StatusIcon = statusConfig[execution.status].icon;
            const statusColor = statusConfig[execution.status].color;
            const statusBg = statusConfig[execution.status].bg;
            const isExpanded = expandedExecutions.has(execution.id);

            return (
              <div key={execution.id} className="hover:bg-gray-50">
                {/* 执行摘要 */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <button
                      onClick={() => toggleExpand(execution.id)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5" />
                      ) : (
                        <ChevronRight className="w-5 h-5" />
                      )}
                    </button>
                    <div className={`p-2 rounded-full ${statusBg}`}>
                      <StatusIcon className={`w-5 h-5 ${statusColor} ${execution.status === 'running' ? 'animate-spin' : ''}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 truncate">
                          {execution.workflowName}
                        </span>
                        <span className={`px-2 py-0.5 text-xs rounded-full ${statusBg} ${statusColor}`}>
                          {execution.status === 'pending' && '等待中'}
                          {execution.status === 'running' && '运行中'}
                          {execution.status === 'completed' && '已完成'}
                          {execution.status === 'failed' && '失败'}
                          {execution.status === 'cancelled' && '已取消'}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {formatTime(execution.createdAt)} · 时长: {getDuration(execution)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleViewDetails(execution.id)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                      title="查看详情"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {execution.status === 'running' && (
                      <button
                        onClick={() => handleCancel(execution.id)}
                        className="p-2 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded"
                        title="取消执行"
                      >
                        <AlertCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(execution.id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 执行步骤详情 */}
                {isExpanded && execution.steps && (
                  <div className="px-4 pb-4 pl-12">
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">执行步骤</h4>
                      {execution.steps.map((step, index) => {
                        const StepIcon = stepStatusConfig[step.status].icon;
                        const stepColor = stepStatusConfig[step.status].color;

                        return (
                          <div key={step.id} className="flex items-start gap-3">
                            <div className="flex-shrink-0 mt-1">
                              <StepIcon className={`w-4 h-4 ${stepColor}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">
                                  {step.nodeName}
                                </span>
                                <span className="text-xs text-gray-500">
                                  ({step.nodeType})
                                </span>
                              </div>
                              {step.error && (
                                <div className="mt-1 text-sm text-red-600 bg-red-50 px-2 py-1 rounded">
                                  错误: {step.error}
                                </div>
                              )}
                              {step.output && (
                                <details className="mt-2">
                                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                                    查看输出
                                  </summary>
                                  <pre className="mt-1 text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto max-h-40">
                                    {JSON.stringify(step.output, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 执行详情面板 */}
      {selectedExecution && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">执行详情</h3>
            <button
              onClick={() => setSelectedExecution(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label className="text-sm text-gray-500">工作流名称</label>
              <p className="text-gray-900">{selectedExecution.workflowName}</p>
            </div>
            <div>
              <label className="text-sm text-gray-500">执行状态</label>
              <p className="text-gray-900">{selectedExecution.status}</p>
            </div>
            <div>
              <label className="text-sm text-gray-500">开始时间</label>
              <p className="text-gray-900">{formatTime(selectedExecution.startedAt)}</p>
            </div>
            {selectedExecution.completedAt && (
              <div>
                <label className="text-sm text-gray-500">完成时间</label>
                <p className="text-gray-900">{formatTime(selectedExecution.completedAt)}</p>
              </div>
            )}
            {selectedExecution.variables && Object.keys(selectedExecution.variables).length > 0 && (
              <div>
                <label className="text-sm text-gray-500">变量</label>
                <pre className="mt-1 text-sm bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto max-h-40">
                  {JSON.stringify(selectedExecution.variables, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
