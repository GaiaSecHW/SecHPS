'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus, ClipboardList, Play, Trash2, Eye, Calendar, Loader2, ChevronLeft, ChevronRight, RefreshCw, Square, Bot, FileText, Clock, AlertCircle } from 'lucide-react';
import TaskCreateModal from './TaskCreateModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ConfirmDialog } from '@/components/ui/Modal';

interface TaskInstance {
  id: string;
  userId: string | null;
  name: string;
  agentId: string;
  agentName: string;
  modelId: string | null;
  modelName: string | null;
  parameters: string;
  filePath: string | null;
  projectPath: string | null;
  skills: string | null;
  scripts: string | null;
  notes: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TaskFormData {
  name: string;
  agents: { agentId: string; agentName: string }[];
  modelId: string;
  modelName: string;
  description: string;
  targetProduct: string;
}

const statusConfig: Record<string, { border: string; text: string; label: string }> = {
  pending:   { border: 'border-gray-500',  text: 'text-gray-300',  label: '待执行' },
  running:   { border: 'border-blue-500',  text: 'text-blue-400',  label: '执行中' },
  completed: { border: 'border-green-500', text: 'text-green-400', label: '已完成' },
  failed:    { border: 'border-red-500',   text: 'text-red-400',   label: '执行失败' },
};

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50];
const DEFAULT_PAGE_SIZE = 10;

export default function TaskBuilderPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    taskId: string | null;
    taskName: string;
  }>({ isOpen: false, taskId: null, taskName: '' });
  const [deleting, setDeleting] = useState(false);
  const [executingIds, setExecutingIds] = useState<Set<string>>(new Set());
  const [stopConfirm, setStopConfirm] = useState<{
    isOpen: boolean;
    taskId: string | null;
    taskName: string;
  }>({ isOpen: false, taskId: null, taskName: '' });

  useEffect(() => {
    fetchTasks(currentPage, pageSize);
  }, [currentPage, pageSize]);

  const fetchTasks = async (page: number, size: number) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/task-builder/tasks?page=${page}&limit=${size}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks || []);
        setTotalCount(data.pagination?.total || 0);
        setTotalPages(data.pagination?.totalPages || 0);
      } else {
        setTasks([]);
        setTotalCount(0);
        setTotalPages(0);
      }
    } catch {
      setTasks([]);
      setTotalCount(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (formData: TaskFormData, file: File | null) => {
    const token = localStorage.getItem('token');
    const isBatch = formData.agents.length > 1;
    let successCount = 0;

    for (const agent of formData.agents) {
      try {
        const taskName = isBatch ? `${formData.name} - ${agent.agentName}` : formData.name;
        const form = new FormData();
        form.append('name', taskName);
        form.append('agentId', agent.agentId);
        form.append('agentName', agent.agentName);
        form.append('modelId', formData.modelId);
        form.append('modelName', formData.modelName);
        form.append('notes', formData.description || '');
        form.append('skills', '');
        form.append('scripts', '');
        form.append('targetProduct', formData.targetProduct || '');
        if (file) {
          form.append('file', file);
        }

        const response = await fetch('/api/task-builder/tasks', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });

        if (!response.ok) {
          const errorData = await response.json();
          const errorMsg = errorData.details
            ? `${errorData.error}: ${errorData.details}`
            : errorData.error || '创建失败';
          throw new Error(errorMsg);
        }
        successCount++;
      } catch (error) {
        toast.error(`${agent.agentName} 创建失败: ${error instanceof Error ? error.message : '未知错误'}`);
        if (!isBatch) throw error;
      }
    }

    if (successCount > 0) {
      toast.success(isBatch ? `成功创建 ${successCount} 个任务` : '任务创建成功');
      setShowCreateModal(false);
      setCurrentPage(1);
      await fetchTasks(1, pageSize);
    }
  };

  const handleViewDetail = (taskId: string) => {
    router.push(`/dashboard/task-builder/${taskId}`);
  };

  const handleRunTask = async (taskId: string) => {
    if (executingIds.has(taskId)) return;
    setExecutingIds(prev => new Set(prev).add(taskId));
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/task-builder/tasks/${taskId}/execute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '执行失败');
      }

      toast.success('任务已开始执行');
      await fetchTasks(currentPage, pageSize);
    } catch (error) {
      toast.error(`执行失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setExecutingIds(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const handleStopTask = (taskId: string, taskName: string) => {
    setStopConfirm({ isOpen: true, taskId, taskName });
  };

  const confirmStopTask = async () => {
    if (!stopConfirm.taskId) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/task-builder/tasks/${stopConfirm.taskId}/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '停止失败');
      }

      toast.success('任务已停止');
      setStopConfirm({ isOpen: false, taskId: null, taskName: '' });
      await fetchTasks(currentPage, pageSize);
    } catch (error) {
      toast.error(`停止失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleDeleteTask = (taskId: string, taskName: string) => {
    setDeleteConfirm({ isOpen: true, taskId, taskName });
  };

  const confirmDeleteTask = async () => {
    if (!deleteConfirm.taskId) return;
    
    setDeleting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/task-builder/tasks/${deleteConfirm.taskId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '删除失败');
      }

      toast.success('任务已删除');
      setDeleteConfirm({ isOpen: false, taskId: null, taskName: '' });
      await fetchTasks(currentPage, pageSize);
    } catch (error) {
      toast.error(`删除失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
{/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <ClipboardList size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">任务实例</h1>
            <p className="text-sm text-gray-400 mt-0.5">管理安全审计任务实例</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchTasks(currentPage, pageSize)}
            disabled={loading}
            className="flex items-center space-x-2 px-4 py-2 text-gray-300 bg-dark-surface-hover border border-gray-700/50 rounded-lg hover:bg-dark-surface-hover disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="group flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 bg-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400"
          >
            <Plus size={18} className="transition-transform group-hover:rotate-90 duration-200" />
            创建任务
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-12 bg-dark-surface rounded-lg border border-gray-700/50">
          <ClipboardList className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-100">暂无任务实例</h3>
          <p className="mt-2 text-sm text-gray-400">
            点击右上角"创建任务"开始构建安全审计任务
          </p>
        </div>
      ) : (
        <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {tasks.map((task) => {
            const config = statusConfig[task.status] || statusConfig.pending;
            const isExecuting = executingIds.has(task.id);

            return (
              <div
                key={task.id}
                className="bg-dark-surface rounded-lg shadow border border-gray-700/50 overflow-hidden hover:shadow-lg transition-shadow flex flex-col"
              >
                <div className="p-5 flex-1">
                  {/* 标题行 */}
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className="text-base font-semibold text-gray-100 truncate"
                      title={task.name}
                    >
                      {task.name}
                    </h3>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.border} ${config.text}`}
                    >
                      {task.status === 'running' && <Loader2 size={11} className="animate-spin" />}
                      {config.label}
                    </span>
                  </div>

                  {/* Agent */}
                  <div className="mt-3 flex items-center gap-1.5 text-sm text-gray-400">
                    <Bot size={14} className="shrink-0 text-gray-500" />
                    <span className="truncate">{task.agentName}</span>
                    {task.modelName && (
                      <>
                        <span className="text-gray-600">·</span>
                        <span className="truncate text-gray-500">{task.modelName}</span>
                      </>
                    )}
                  </div>

                  {/* 任务描述 */}
                  {task.notes && (
                    <div className="mt-2 flex items-start gap-1.5">
                      <FileText size={13} className="shrink-0 mt-0.5 text-gray-500" />
                      <p className="text-xs text-gray-400 line-clamp-2">{task.notes}</p>
                    </div>
                  )}

                  {/* 错误信息 */}
                  {task.status === 'failed' && task.errorMessage && (
                    <div className="mt-2 flex items-start gap-1.5">
                      <AlertCircle size={13} className="shrink-0 mt-0.5 text-red-400" />
                      <p className="text-xs text-red-400 line-clamp-2">{task.errorMessage}</p>
                    </div>
                  )}

                  {/* 时间信息 */}
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <Calendar size={12} className="shrink-0" />
                      <span>创建于 {formatDate(task.createdAt)}</span>
                    </div>
                    {task.startedAt && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Clock size={12} className="shrink-0" />
                        <span>
                          {task.completedAt
                            ? `完成于 ${formatDate(task.completedAt)}`
                            : `启动于 ${formatDate(task.startedAt)}`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 操作栏 */}
                <div className="px-5 py-3 bg-dark-bg border-t border-gray-700/50 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {task.status === 'pending' && (
                      <button
                        onClick={() => handleRunTask(task.id)}
                        disabled={isExecuting}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isExecuting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                        执行
                      </button>
                    )}
                    {task.status === 'running' && (
                      <button
                        onClick={() => handleStopTask(task.id, task.name)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                      >
                        <Square size={12} />
                        停止
                      </button>
                    )}
                    {(task.status === 'completed' || task.status === 'failed') && (
                      <button
                        onClick={() => handleRunTask(task.id)}
                        disabled={isExecuting}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isExecuting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        重新执行
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleViewDetail(task.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-300 bg-dark-surface hover:bg-dark-surface-hover border border-gray-600 rounded-md transition-colors"
                    >
                      <Eye size={12} />
                      详情
                    </button>
                    <button
                      onClick={() => handleDeleteTask(task.id, task.name)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-red-800/50 rounded-md transition-colors"
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 分页 */}
      <div className="bg-dark-surface px-6 py-3 border border-gray-700/50 rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-400">
            {totalCount > 0 
              ? `共 ${totalCount} 条记录，第 ${currentPage} / ${totalPages || 1} 页`
              : '暂无记录'}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span>每页显示</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="w-[100px] px-2 py-1 border border-gray-600 rounded-md bg-dark-surface focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} 条
                </option>
              ))}
            </select>
          </div>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm font-medium text-gray-300 bg-dark-surface border border-gray-600 rounded-md hover:bg-[#0F172A] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft size={16} />
              上一页
            </button>
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm font-medium text-gray-300 bg-dark-surface border border-gray-600 rounded-md hover:bg-[#0F172A] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              下一页
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      <TaskCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateTask}
      />

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, taskId: null, taskName: '' })}
        onConfirm={confirmDeleteTask}
        title="删除任务"
        message={`确定要删除任务「${deleteConfirm.taskName}」吗？此操作不可恢复。`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        loading={deleting}
      />

      <ConfirmDialog
        isOpen={stopConfirm.isOpen}
        onClose={() => setStopConfirm({ isOpen: false, taskId: null, taskName: '' })}
        onConfirm={confirmStopTask}
        title="停止任务"
        message={`确定要停止任务「${stopConfirm.taskName}」吗？任务将标记为失败。`}
        confirmText="停止"
        cancelText="取消"
        variant="danger"
        loading={false}
      />
    </div>
  );
}