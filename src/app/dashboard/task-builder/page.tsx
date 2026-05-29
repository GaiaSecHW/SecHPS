'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus, ClipboardList, Play, Trash2, Calendar, Loader2, ChevronLeft, ChevronRight, RefreshCw, Square, Bot, Clock, AlertCircle, Search, CheckCircle, Server, X, Check, ChevronDown } from 'lucide-react';
import TaskCreateModal from './TaskCreateModal';
import ModeSelectModal from './ModeSelectModal';
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
  workerNodeId: string | null;
  workerStatus: string | null;
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

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: 'bg-gray-500/20',  text: 'text-gray-400',  label: '待执行' },
  running:   { bg: 'bg-blue-500/20',  text: 'text-blue-400',  label: '执行中' },
  completed: { bg: 'bg-green-500/20', text: 'text-green-400', label: '已完成' },
  failed:    { bg: 'bg-red-500/20',   text: 'text-red-400',   label: '执行失败' },
};

const PAGE_SIZE_OPTIONS = [12, 24, 36, 100];
const DEFAULT_PAGE_SIZE = 12;

export default function TaskBuilderPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showModeSelect, setShowModeSelect] = useState(false);
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
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'running' | 'completed' | 'failed'>('all');

  // 重试弹窗状态
  const [rerunModal, setRerunModal] = useState<{ isOpen: boolean; taskId: string | null; taskName: string; modelId: string; modelName: string }>({
    isOpen: false, taskId: null, taskName: '', modelId: '', modelName: '',
  });
  const [rerunModels, setRerunModels] = useState<{ modelId: string; modelName: string; key: string }[]>([]);
  const [rerunSelectedKey, setRerunSelectedKey] = useState('');
  const [rerunDropdownOpen, setRerunDropdownOpen] = useState(false);
  const rerunDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rerunDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (rerunDropdownRef.current && !rerunDropdownRef.current.contains(e.target as Node)) {
        setRerunDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [rerunDropdownOpen]);

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

  const filteredTasks = tasks.filter(task =>
    (statusFilter === 'all' || task.status === statusFilter) &&
    (task.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    task.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (task.notes?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false))
  );

  const handleModeSelect = (mode: 'quick' | 'deep') => {
    setShowModeSelect(false);
    if (mode === 'quick') setShowCreateModal(true);
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

  const handleRunTask = async (taskId: string, modelId?: string, modelName?: string) => {
    if (executingIds.has(taskId)) return;
    setExecutingIds(prev => new Set(prev).add(taskId));
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/task-builder/tasks/${taskId}/execute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: modelId || undefined, modelName: modelName || undefined }),
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
    <div className="space-y-6">
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
            className="flex items-center space-x-2 px-4 py-2 text-gray-300 bg-dark-bg border border-gray-700/50 rounded-lg hover:bg-gray-700 disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
          <button
            onClick={() => setShowModeSelect(true)}
            className="group flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 bg-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400"
          >
            <Plus size={18} className="transition-transform group-hover:rotate-90 duration-200" />
            创建任务
          </button>
        </div>
      </div>

      {/* Search + Cards container */}
      <div className="bg-dark-surface border border-gray-700/50 rounded-xl">
        {/* Filters section */}
        <div className="px-5 py-4 border-b border-gray-700/50">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            {/* 搜索框 */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="搜索任务名称、Agent..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-primary-500 text-gray-100 placeholder-gray-500 text-sm"
              />
            </div>
            
            {/* 状态筛选按钮组 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === 'all' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25' : 'bg-dark-bg text-gray-400 hover:bg-gray-700'
                }`}
              >
                全部
              </button>
              <button
                onClick={() => setStatusFilter('pending')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === 'pending' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25' : 'bg-dark-bg text-gray-400 hover:bg-gray-700'
                }`}
              >
                <Clock size={16} />
                待执行
              </button>
              <button
                onClick={() => setStatusFilter('running')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === 'running' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25' : 'bg-dark-bg text-gray-400 hover:bg-gray-700'
                }`}
              >
                <Loader2 size={16} />
                执行中
              </button>
              <button
                onClick={() => setStatusFilter('completed')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === 'completed' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25' : 'bg-dark-bg text-gray-400 hover:bg-gray-700'
                }`}
              >
                <CheckCircle size={16} />
                已完成
              </button>
              <button
                onClick={() => setStatusFilter('failed')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === 'failed' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25' : 'bg-dark-bg text-gray-400 hover:bg-gray-700'
                }`}
              >
                <AlertCircle size={16} />
                失败
              </button>
            </div>
          </div>
        </div>

        {/* Cards section */}
        {filteredTasks.length === 0 ? (
          <div className="p-12">
            <div className="text-center">
              <ClipboardList className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">
                {searchQuery || statusFilter !== 'all' ? '未找到匹配的任务' : '暂无任务实例'}
              </p>
              {!searchQuery && statusFilter === 'all' && (
                <button
                  onClick={() => setShowModeSelect(true)}
                  className="text-primary-500 hover:text-primary-400"
                >
                  创建第一个任务
                </button>
              )}
            </div>
          </div>
        ) : (
        <div className="p-5">
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {filteredTasks.map((task) => {
            const config = statusConfig[task.status] || statusConfig.pending;
            const isExecuting = executingIds.has(task.id);

            return (
              <div
                key={task.id}
                className="group relative flex flex-col rounded border border-gray-600/50 bg-gray-700/30 hover:bg-gray-700/50 transition-colors cursor-pointer min-h-[180px]"
                onClick={() => handleViewDetail(task.id)}
              >
                <div className="flex-1 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-medium text-gray-100 truncate leading-tight">{task.name}</h3>
                    <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${config.bg} ${config.text}`}>
                      {task.status === 'running' && <Loader2 size={10} className="animate-spin" />}
                      {config.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="truncate font-medium text-gray-300">{task.agentName}</span>
                    {task.modelName && (
                      <>
                        <span className="text-gray-600">/</span>
                        <span className="truncate text-gray-500">{task.modelName}</span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    {task.workerNodeId ? (
                      <span className="flex items-center gap-1 text-cyan-400 bg-cyan-900/20 px-2 py-0.5 rounded">
                        <Server className="w-3 h-3" />
                        <span>{task.workerNodeId}</span>
                      </span>
                    ) : task.status === 'pending' ? (
                      <span className="text-gray-500">待分配 Worker</span>
                    ) : null}
                  </div>

                  {task.notes && (
                    <p className="text-xs text-gray-500 line-clamp-2">{task.notes}</p>
                  )}

                  {task.status === 'failed' && task.errorMessage && (
                    <div className="flex items-start gap-1.5 text-xs">
                      <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
                      <span className="text-red-400 line-clamp-1">{task.errorMessage}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Clock size={12} className="shrink-0" />
                    <span>创建于 {formatDate(task.createdAt)}</span>
                  </div>
                </div>

                {/* 操作栏 */}
                <div className="mt-auto border-t border-gray-600/30 px-4 py-2.5 flex items-center justify-between bg-gray-700/20">
                  <div className="flex items-center gap-1.5">
                    {task.status === 'pending' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRunTask(task.id); }}
                        disabled={isExecuting}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-400/15 rounded transition-colors disabled:opacity-50"
                      >
                        {isExecuting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                        执行
                      </button>
                    )}
                    {task.status === 'running' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStopTask(task.id, task.name); }}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-400/15 rounded transition-colors"
                      >
                        <Square size={12} />
                        停止
                      </button>
                    )}
                    {(task.status === 'completed' || task.status === 'failed') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const token = localStorage.getItem('token');
                          fetch('/api/models', { headers: { Authorization: `Bearer ${token}` } })
                            .then(r => r.json())
                            .then(data => {
                              const models = (data.models || data || []).flatMap((m: any) => {
                                try {
                                  return (m.models ? JSON.parse(m.models) : []).map((name: string) => ({
                                    modelId: m.id, modelName: name, key: `${m.id}:${name}`,
                                  }));
                                } catch {
                                  return [];
                                }
                              });
                              setRerunModels(models);
                              const defaultKey = task.modelId && task.modelName ? `${task.modelId}:${task.modelName}` : '';
                              setRerunSelectedKey(models.find((m: { key: string }) => m.key === defaultKey)?.key || models[0]?.key || '');
                              setRerunModal({ isOpen: true, taskId: task.id, taskName: task.name, modelId: task.modelId || '', modelName: task.modelName || '' });
                            })
                            .catch(() => {
                              toast.error('获取模型列表失败');
                            });
                        }}
                        disabled={isExecuting}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-400 hover:bg-blue-400/15 rounded transition-colors disabled:opacity-50"
                      >
                        {isExecuting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        重试
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id, task.name); }}
                      disabled={deleting}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-400/15 rounded transition-colors disabled:opacity-50"
                    >
                      {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </div>
        )}
      </div>

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

      <ModeSelectModal
        isOpen={showModeSelect}
        onClose={() => setShowModeSelect(false)}
        onSelect={handleModeSelect}
      />

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

      {/* 重试弹窗 - 选择模型 */}
      {rerunModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-dark-surface rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-white">重试任务</h3>
              <button onClick={() => setRerunModal({ isOpen: false, taskId: null, taskName: '', modelId: '', modelName: '' })} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <span className="text-sm text-gray-400">任务名称</span>
                <p className="text-sm text-white mt-1">{rerunModal.taskName}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">选择模型</label>
                <div className="relative" ref={rerunDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setRerunDropdownOpen(!rerunDropdownOpen)}
                    className="w-full px-3 py-2 border border-gray-600 rounded-md bg-dark-bg text-left text-sm text-white flex items-center justify-between hover:border-gray-500"
                  >
                    <span className="truncate">{rerunModels.find(m => m.key === rerunSelectedKey)?.modelName || '选择模型'}</span>
                    <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
                  </button>
                  {rerunDropdownOpen && rerunModels.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-dark-surface border border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {rerunModels.map(m => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => { setRerunSelectedKey(m.key); setRerunDropdownOpen(false); }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700 flex items-center justify-between"
                        >
                          <span className={m.key === rerunSelectedKey ? 'text-blue-400' : 'text-white'}>{m.modelName}</span>
                          {m.key === rerunSelectedKey && <Check size={14} className="text-blue-400 flex-shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-gray-700">
              <button
                onClick={() => setRerunModal({ isOpen: false, taskId: null, taskName: '', modelId: '', modelName: '' })}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white border border-gray-600 rounded-md hover:border-gray-500"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const selected = rerunModels.find(m => m.key === rerunSelectedKey);
                  if (rerunModal.taskId && selected) {
                    setRerunModal(prev => ({ ...prev, isOpen: false }));
                    handleRunTask(rerunModal.taskId, selected.modelId, selected.modelName);
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                确认执行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}