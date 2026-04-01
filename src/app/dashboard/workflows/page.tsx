'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Search, Filter, MoreVertical, Edit2, Play, Trash2, Share2, FileText, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { WorkflowStatus } from '@/types/workflow';

interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  thumbnail?: string;
  nodeCount: number;
  edgeCount: number;
  lastExecutedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'all'>('all');
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const fetchWorkflows = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/workflows', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '获取工作流列表失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      setWorkflows(data.workflows || []);
      setLoading(false);
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const createWorkflow = async () => {
    if (!workflowName.trim()) {
      alert('请输入工作流名称');
      return;
    }

    setCreating(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/workflows', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: workflowName,
          description: workflowDescription,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '创建工作流失败');
        setCreating(false);
        return;
      }

      setShowCreateModal(false);
      setWorkflowName('');
      setWorkflowDescription('');
      await fetchWorkflows();
    } catch (err) {
      alert('网络错误，请重试');
    } finally {
      setCreating(false);
    }
  };

  const deleteWorkflow = async (workflowId: string) => {
    if (!confirm('确定要删除这个工作流吗？删除后将无法恢复。')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '删除工作流失败');
        return;
      }

      await fetchWorkflows();
    } catch (err) {
      alert('网络错误，请重试');
    }
  };

  const getStatusText = (status: WorkflowStatus) => {
    switch (status) {
      case 'draft':
        return '草稿';
      case 'published':
        return '已发布';
      case 'archived':
        return '已归档';
      default:
        return status;
    }
  };

  const getStatusColor = (status: WorkflowStatus) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'published':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'archived':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: WorkflowStatus) => {
    switch (status) {
      case 'draft':
        return <FileText size={14} />;
      case 'published':
        return <CheckCircle size={14} />;
      case 'archived':
        return <AlertCircle size={14} />;
      default:
        return <FileText size={14} />;
    }
  };

  // 过滤工作流
  const filteredWorkflows = workflows.filter((workflow) => {
    const matchesSearch =
      workflow.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (workflow.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

    const matchesStatus = statusFilter === 'all' || workflow.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">工作流管理</h1>
          <p className="mt-1 text-sm text-gray-600">
            创建和管理自动化工作流
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <Plus size={20} />
          <span>新建工作流</span>
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* 搜索和筛选 */}
      <div className="flex items-center space-x-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="搜索工作流..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex items-center space-x-2">
          <Filter size={20} className="text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as WorkflowStatus | 'all')}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="archived">已归档</option>
          </select>
        </div>
      </div>

      {/* 工作流列表 */}
      {filteredWorkflows.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <FileText className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            {searchQuery || statusFilter !== 'all' ? '未找到匹配的工作流' : '暂无工作流'}
          </h3>
          <p className="mt-2 text-sm text-gray-600">
            {searchQuery || statusFilter !== 'all'
              ? '尝试调整搜索条件或筛选器'
              : '创建您的第一个工作流开始自动化'}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
          {filteredWorkflows.map((workflow) => (
            <div
              key={workflow.id}
              className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
            >
              {/* 缩略图区域 */}
              {workflow.thumbnail && (
                <div className="h-32 bg-gray-100 relative">
                  <img
                    src={workflow.thumbnail}
                    alt={workflow.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {/* 内容区域 */}
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <h3 className="text-lg font-semibold text-gray-900 truncate flex-1">
                    {workflow.name}
                  </h3>
                  <span
                    className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ml-2 ${getStatusColor(workflow.status)}`}
                  >
                    {getStatusIcon(workflow.status)}
                    <span>{getStatusText(workflow.status)}</span>
                  </span>
                </div>

                {workflow.description && (
                  <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                    {workflow.description}
                  </p>
                )}

                <div className="mt-4 flex items-center space-x-4 text-xs text-gray-500">
                  <div className="flex items-center space-x-1">
                    <FileText size={14} />
                    <span>{workflow.nodeCount} 节点</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Clock size={14} />
                    <span>
                      {workflow.lastExecutedAt
                        ? new Date(workflow.lastExecutedAt).toLocaleDateString()
                        : '未执行'}
                    </span>
                  </div>
                </div>

                <p className="mt-2 text-xs text-gray-400">
                  创建于 {new Date(workflow.createdAt).toLocaleDateString()}
                </p>
              </div>

              {/* 操作按钮 */}
              <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex space-x-2">
                    <Link
                      href={`/dashboard/workflows/${workflow.id}`}
                      className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                    >
                      <Edit2 size={16} />
                      <span>编辑</span>
                    </Link>
                    <button
                      className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100 rounded-md transition-colors"
                      title="执行工作流"
                    >
                      <Play size={16} />
                      <span>执行</span>
                    </button>
                  </div>

                  <div className="flex space-x-1">
                    <button
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                      title="分享"
                    >
                      <Share2 size={16} />
                    </button>
                    <button
                      onClick={() => deleteWorkflow(workflow.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建工作流对话框 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">新建工作流</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setWorkflowName('');
                  setWorkflowDescription('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="workflowName" className="block text-sm font-medium text-gray-700">
                  工作流名称 *
                </label>
                <input
                  id="workflowName"
                  type="text"
                  required
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入工作流名称"
                />
              </div>

              <div>
                <label htmlFor="workflowDescription" className="block text-sm font-medium text-gray-700">
                  工作流描述
                </label>
                <textarea
                  id="workflowDescription"
                  rows={3}
                  value={workflowDescription}
                  onChange={(e) => setWorkflowDescription(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入工作流描述（可选）"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setWorkflowName('');
                  setWorkflowDescription('');
                }}
                disabled={creating}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={createWorkflow}
                disabled={creating || !workflowName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? '创建中...' : '创建工作流'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
