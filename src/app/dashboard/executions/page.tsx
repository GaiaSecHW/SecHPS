'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Clock, CheckCircle2, XCircle, AlertCircle, Loader2, Eye, Trash2 } from 'lucide-react';
import Link from 'next/link';

interface ExecutionStep {
  id: string;
  executionId: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: string;
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
  status: string;
  variables: any;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  steps: ExecutionStep[];
}

const statusConfig = {
  pending: { icon: Clock, color: 'text-gray-500', bg: 'bg-gray-100', label: '等待中' },
  running: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-50', label: '运行中' },
  completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50', label: '已完成' },
  failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', label: '失败' },
  cancelled: { icon: AlertCircle, color: 'text-yellow-500', bg: 'bg-yellow-50', label: '已取消' },
};

export default function ExecutionsPage() {
  const router = useRouter();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);

  useEffect(() => {
    fetchExecutions();
  }, []);

  const fetchExecutions = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/executions', {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取详情失败');
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

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

  return (
    <div className="p-6">
      {/* 头部 */}
      <div className="mb-6">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/dashboard/workflows" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">执行历史</h1>
        </div>
        <p className="text-gray-600">查看和管理所有工作流的执行记录</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
          {error}
          <button 
            onClick={fetchExecutions}
            className="ml-4 text-red-600 hover:text-red-800 underline"
          >
            重试
          </button>
        </div>
      )}

      {/* 执行列表 */}
      {executions.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <Clock className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">暂无执行记录</p>
          <p className="text-sm text-gray-400 mt-2">运行工作流后，执行记录将显示在这里</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左侧：执行列表 */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">执行列表</h2>
            </div>
            <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
              {executions.map((execution) => {
                const config = statusConfig[execution.status as keyof typeof statusConfig] || statusConfig.pending;
                const StatusIcon = config.icon;
                const isSelected = selectedExecution?.id === execution.id;

                return (
                  <div
                    key={execution.id}
                    className={`px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                    }`}
                    onClick={() => handleViewDetails(execution.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`p-2 rounded-full ${config.bg}`}>
                          <StatusIcon className={`w-4 h-4 ${config.color} ${execution.status === 'running' ? 'animate-spin' : ''}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 truncate">
                              {execution.workflowName}
                            </span>
                            <span className={`px-2 py-0.5 text-xs rounded-full ${config.bg} ${config.color}`}>
                              {config.label}
                            </span>
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {formatTime(execution.createdAt)} · {getDuration(execution)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {execution.status === 'running' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancel(execution.id);
                            }}
                            className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded"
                            title="取消执行"
                          >
                            <AlertCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(execution.id);
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 右侧：执行详情 */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">
                {selectedExecution ? '执行详情' : '选择执行记录'}
              </h2>
            </div>
            {selectedExecution ? (
              <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
                {/* 基本信息 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-500">工作流名称</label>
                    <p className="text-gray-900 font-medium">{selectedExecution.workflowName}</p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">执行状态</label>
                    <p className="text-gray-900 font-medium">
                      {statusConfig[selectedExecution.status as keyof typeof statusConfig]?.label || selectedExecution.status}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">开始时间</label>
                    <p className="text-gray-900">{formatTime(selectedExecution.startedAt)}</p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">完成时间</label>
                    <p className="text-gray-900">{formatTime(selectedExecution.completedAt)}</p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">执行时长</label>
                    <p className="text-gray-900">{getDuration(selectedExecution)}</p>
                  </div>
                </div>

                {/* 变量 */}
                {selectedExecution.variables && Object.keys(selectedExecution.variables).length > 0 && (
                  <div>
                    <label className="text-sm text-gray-500 block mb-2">变量</label>
                    <pre className="text-sm bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto">
                      {JSON.stringify(selectedExecution.variables, null, 2)}
                    </pre>
                  </div>
                )}

                {/* 执行步骤 */}
                {selectedExecution.steps && selectedExecution.steps.length > 0 && (
                  <div>
                    <label className="text-sm text-gray-500 block mb-2">执行步骤</label>
                    <div className="space-y-3">
                      {selectedExecution.steps.map((step, index) => (
                        <div key={step.id} className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-medium text-gray-900">
                              {index + 1}. {step.nodeName}
                            </span>
                            <span className="text-xs text-gray-500">({step.nodeType})</span>
                            <span className={`px-2 py-0.5 text-xs rounded-full ${
                              statusConfig[step.status as keyof typeof statusConfig]?.bg || 'bg-gray-100'
                            } ${
                              statusConfig[step.status as keyof typeof statusConfig]?.color || 'text-gray-500'
                            }`}>
                              {statusConfig[step.status as keyof typeof statusConfig]?.label || step.status}
                            </span>
                          </div>
                          {step.error && (
                            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded mb-2">
                              错误: {step.error}
                            </div>
                          )}
                          {step.output && (
                            <details className="text-sm">
                              <summary className="text-gray-500 cursor-pointer hover:text-gray-700">
                                查看输出
                              </summary>
                              <pre className="mt-2 text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto max-h-40">
                                {JSON.stringify(step.output, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-12 text-center text-gray-500">
                <Eye className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                <p>点击左侧执行记录查看详情</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
