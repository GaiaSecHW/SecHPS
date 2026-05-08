'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus, ClipboardList, Play, Trash2, Eye, Calendar, User, Shield, Bug, Sword, Network, Loader2, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
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
  agentId: string;
  agentName: string;
  modelId: string;
  modelName: string;
  description: string;
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-700', label: '待执行' },
  running: { bg: 'bg-blue-100', text: 'text-blue-700', label: '执行中' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', label: '已完成' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: '执行失败' },
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
    try {
      const token = localStorage.getItem('token');
      const form = new FormData();
      form.append('name', formData.name);
      form.append('agentId', formData.agentId);
      form.append('agentName', formData.agentName);
      form.append('modelId', formData.modelId);
      form.append('modelName', formData.modelName);
      form.append('notes', formData.description || '');
      form.append('skills', '');
      form.append('scripts', '');
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
        throw new Error(errorData.error || '创建失败');
      }

      toast.success('任务创建成功');
      setShowCreateModal(false);
      setCurrentPage(1);
      await fetchTasks(1, pageSize);
    } catch (error) {
      toast.error(`创建失败: ${error instanceof Error ? error.message : '未知错误'}`);
      throw error;
    }
  };

  const handleViewDetail = (taskId: string) => {
    router.push(`/dashboard/task-builder/${taskId}`);
  };

  const handleRunTask = async (taskId: string) => {
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">任务实例</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理您的安全审计任务实例
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchTasks(currentPage, pageSize)}
            disabled={loading}
            className="flex items-center space-x-2 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Plus size={20} />
            <span>创建任务</span>
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <ClipboardList className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">暂无任务实例</h3>
          <p className="mt-2 text-sm text-gray-600">
            点击右上角"创建任务"开始构建安全审计任务
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    任务名称
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Agent
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    创建时间
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {tasks.map((task) => {
                  const config = statusConfig[task.status] || statusConfig.pending;

                  return (
                    <tr key={task.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-gray-900">
                          {task.name}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-600">
                          {task.agentName}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
                          {config.label}
                          {task.status === 'running' && <Loader2 size={12} className="ml-1 animate-spin" />}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-500 flex items-center gap-1">
                          <Calendar size={14} className="text-gray-400" />
                          {formatDate(task.createdAt)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          {task.status === 'pending' && (
                            <button
                              onClick={() => handleRunTask(task.id)}
                              className="text-green-600 hover:text-green-900 flex items-center gap-1"
                            >
                              <Play size={14} />
                              执行
                            </button>
                          )}
                          {(task.status === 'completed' || task.status === 'failed') && (
                            <button
                              onClick={() => handleRunTask(task.id)}
                              className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                            >
                              <RefreshCw size={14} />
                              重新执行
                            </button>
                          )}
                          <button
                            onClick={() => handleViewDetail(task.id)}
                            className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                          >
                            <Eye size={14} />
                            详情
                          </button>
                          <button
                            onClick={() => handleDeleteTask(task.id, task.name)}
                            className="text-red-600 hover:text-red-900 flex items-center gap-1"
                          >
                            <Trash2 size={14} />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 分页 */}
      <div className="bg-white px-6 py-3 border border-gray-200 rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-600">
            {totalCount > 0 
              ? `共 ${totalCount} 条记录，第 ${currentPage} / ${totalPages || 1} 页`
              : '暂无记录'}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>每页显示</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="px-2 py-1 border border-gray-300 rounded-md bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
              className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft size={16} />
              上一页
            </button>
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
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
    </div>
  );
}