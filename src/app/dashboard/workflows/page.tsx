'use client';
 
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Plus, Search, Filter, Edit2, Trash2, Share2, FileText, CheckCircle, AlertCircle, Send, Archive, RotateCcw, X, Loader2, Globe, Lock, User } from 'lucide-react';
import { WorkflowStatus } from '@/types/workflow';
import { useTechStackOptions } from '@/hooks/useTechStackOptions';

interface Workflow {
  id: string;
  userId: string;
  userName?: string;
  userUsername?: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  thumbnail?: string;
  techStack?: string[];
  isPublic: boolean;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function WorkflowsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'all'>('all');
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [workflowTechStack, setWorkflowTechStack] = useState<string[]>([]);
  const [workflowIsPublic, setWorkflowIsPublic] = useState(false);
  const [techStackSearch, setTechStackSearch] = useState('');
  const [showTechStackDropdown, setShowTechStackDropdown] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  
  // 使用 Hook 获取技术栈选项
  const { options: techStackOptions, loading: loadingTechStack } = useTechStackOptions();

  useEffect(() => {
    // 检查是否是管理员
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const userData = JSON.parse(userStr);
      setUser(userData);
      setIsAdmin(userData.roles?.includes('admin') || false);
    }
    
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
        setError(data.error || '获取Agent编排列表失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      // API returns { data: [...], pagination: {...} }
      // 映射 _count.nodes 到 nodeCount
      const mappedWorkflows = (data.data || []).map((w: any) => ({
        ...w,
        userId: w.userId,
        userName: w.userName || w.userUsername,
        userUsername: w.userUsername,
        nodeCount: w._count?.nodes || 0,
        edgeCount: 0, // 暂时设置为 0，因为 API 没有返回 edgeCount
        techStack: Array.isArray(w.techStack) ? w.techStack : (w.techStack ? JSON.parse(w.techStack) : []),
        isPublic: w.isPublic || false,
      }));
      setWorkflows(mappedWorkflows);
      setLoading(false);
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const createWorkflow = async () => {
    const trimmedName = workflowName.trim();

    if (!trimmedName) {
      toast.error('请输入编排名称');
      return;
    }

    if (trimmedName.length < 2) {
      toast.error('编排名称至少需要2个字符');
      return;
    }

    if (trimmedName.length > 100) {
      toast.error('编排名称不能超过100个字符');
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
          name: trimmedName,
          description: workflowDescription,
          techStack: workflowTechStack,
          isPublic: workflowIsPublic,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '创建编排失败');
        setCreating(false);
        return;
      }

      setShowCreateModal(false);
      setWorkflowName('');
      setWorkflowDescription('');
      setWorkflowTechStack([]);
      setWorkflowIsPublic(false);
      await fetchWorkflows();
    } catch (err) {
      toast.error('网络错误，请重试');
    } finally {
      setCreating(false);
    }
  };

  const deleteWorkflow = async (workflowId: string) => {
    if (!confirm('确定要删除这个编排吗？删除后将无法恢复。')) {
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
        toast.error(data.error || '删除编排失败');
        return;
      }

      await fetchWorkflows();
    } catch (err) {
      toast.error('网络错误，请重试');
    }
  };

  const publishWorkflow = async (workflowId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 'published' }),
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '发布编排失败');
        return;
      }

      await fetchWorkflows();
    } catch (err) {
      toast.error('网络错误，请重试');
    }
  };

  const archiveWorkflow = async (workflowId: string) => {
    if (!confirm('确定要下线这个编排吗？下线后将不再在选择列表中显示。')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 'archived' }),
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '下线编排失败');
        return;
      }

      await fetchWorkflows();
    } catch (err) {
      toast.error('网络错误，请重试');
    }
  };

  const restoreWorkflow = async (workflowId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 'published' }),
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '恢复发布失败');
        return;
      }

      await fetchWorkflows();
    } catch (err) {
      toast.error('网络错误，请重试');
    }
  };

  const openEditModal = (workflow: Workflow) => {
    setEditingWorkflow(workflow);
    setWorkflowName(workflow.name);
    setWorkflowDescription(workflow.description || '');
    // 从 workflow 中获取 techStack
    setWorkflowTechStack(workflow.techStack || []);
    setShowEditModal(true);
  };

  const updateWorkflowInfo = async () => {
    if (!editingWorkflow) return;

    const trimmedName = workflowName.trim();

    if (!trimmedName) {
      toast.error('请输入编排名称');
      return;
    }

    if (trimmedName.length < 2) {
      toast.error('编排名称至少需要2个字符');
      return;
    }

    if (trimmedName.length > 100) {
      toast.error('编排名称不能超过100个字符');
      return;
    }

    setUpdating(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/workflows/${editingWorkflow.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: trimmedName,
          description: workflowDescription,
          techStack: workflowTechStack,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '更新编排信息失败');
        setUpdating(false);
        return;
      }

      toast.success('编排信息已更新');
      setShowEditModal(false);
      setEditingWorkflow(null);
      setWorkflowName('');
      setWorkflowDescription('');
      setWorkflowTechStack([]);
      await fetchWorkflows();
    } catch (err) {
      toast.error('网络错误，请重试');
    } finally {
      setUpdating(false);
    }
  };

  // 切换分享状态（公开/私有）
  const toggleShare = async (workflow: Workflow) => {
    try {
      const token = localStorage.getItem('token');
      const newIsPublic = !workflow.isPublic;
      
      const response = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isPublic: newIsPublic }),
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '切换分享状态失败');
        return;
      }

      toast.success(newIsPublic ? '已设置为公开，其他用户可查看' : '已设置为私有');
      await fetchWorkflows();
    } catch (err) {
      toast.error('网络错误，请重试');
    }
  };

  const getStatusText = (status: WorkflowStatus) => {
    switch (status) {
      case 'draft':
        return '草稿';
      case 'published':
        return '已发布';
      case 'archived':
        return '已下线';
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
        return 'bg-red-100 text-red-800 border-red-200';
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
        return <Archive size={14} />;
      default:
        return <FileText size={14} />;
    }
  };

   // 过滤
  const filteredWorkflows = workflows.filter((workflow) => {
    const matchesSearch =
      workflow.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (workflow.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

    const matchesStatus = statusFilter === 'all' || workflow.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // 统计信息
  const stats = {
    total: workflows.length,
    draft: workflows.filter(w => w.status === 'draft').length,
    published: workflows.filter(w => w.status === 'published').length,
    archived: workflows.filter(w => w.status === 'archived').length,
  };

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
          <h1 className="text-2xl font-bold text-gray-900">Agent编排管理</h1>
          <p className="mt-1 text-sm text-gray-600">
            创建和管理Agent编排
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <Plus size={20} />
          <span>新建编排</span>
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* 统计信息 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">总编排</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <FileText className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">草稿</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.draft}</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <FileText className="h-6 w-6 text-gray-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">已发布</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.published}</p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">已下线</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.archived}</p>
            </div>
            <div className="p-3 bg-red-50 rounded-lg">
              <Archive className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div className="flex items-center space-x-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="搜索编排..."
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
            <option value="archived">已下线</option>
          </select>
        </div>
      </div>

      {/* Agent列表 */}
      {filteredWorkflows.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <FileText className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            {searchQuery || statusFilter !== 'all' ? '未找到匹配的编排' : '暂无编排'}
          </h3>
          <p className="mt-2 text-sm text-gray-600">
            {searchQuery || statusFilter !== 'all'
              ? '尝试调整搜索条件或筛选器'
              : '创建您的第一个Agent开始编排'}
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
                    src={workflow.thumbnail.startsWith('data:') ? workflow.thumbnail : `data:image/png;base64,${workflow.thumbnail}`}
                    alt={workflow.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {/* 内容区域 */}
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">
                        {workflow.name}
                      </h3>
                      {/* 公开/私有标签 */}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          workflow.isPublic
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {workflow.isPublic ? <Globe size={12} /> : <Lock size={12} />}
                        {workflow.isPublic ? '公开' : '私有'}
                      </span>
                    </div>
                    {/* 管理员视角显示创建者 */}
                    {isAdmin && workflow.userName && (
                      <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                        <User size={12} />
                        {workflow.userName || workflow.userUsername}
                      </p>
                    )}
                  </div>
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
                      <span>编辑流程</span>
                    </Link>
                    {workflow.status === 'draft' && (
                      <button
                        onClick={() => publishWorkflow(workflow.id)}
                        className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100 rounded-md transition-colors"
                        title="发布"
                      >
                        <Send size={16} />
                        <span>发布</span>
                      </button>
                    )}
                    {workflow.status === 'published' && (
                      <button
                        onClick={() => archiveWorkflow(workflow.id)}
                        className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                        title="下线"
                      >
                        <Archive size={16} />
                        <span>下线</span>
                      </button>
                    )}
                    {workflow.status === 'archived' && (
                      <button
                        onClick={() => restoreWorkflow(workflow.id)}
                        className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100 rounded-md transition-colors"
                        title="恢复发布"
                      >
                        <RotateCcw size={16} />
                        <span>恢复</span>
                      </button>
                    )}
                  </div>

                  <div className="flex space-x-1">
                    <button
                      onClick={() => openEditModal(workflow)}
                      className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-colors"
                      title="编辑信息"
                    >
                      <FileText size={16} />
                    </button>
                    <button
                      onClick={() => toggleShare(workflow)}
                      className={`p-1.5 rounded-md transition-colors ${
                        workflow.isPublic
                          ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                          : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                      }`}
                      title={workflow.isPublic ? '点击设为私有' : '点击设为公开分享'}
                    >
                      {workflow.isPublic ? <Globe size={16} /> : <Lock size={16} />}
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

      {/* 新建Agent对话框 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">新建编排</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setWorkflowName('');
                  setWorkflowDescription('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <AlertCircle size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="workflowName" className="block text-sm font-medium text-gray-700">
                  编排名称 *
                </label>
                <input
                  id="workflowName"
                  type="text"
                  required
                  maxLength={100}
                  minLength={2}
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入编排名称（2-100个字符）"
                />
              </div>

              <div>
                <label htmlFor="workflowDescription" className="block text-sm font-medium text-gray-700">
                  编排描述
                </label>
                <textarea
                  id="workflowDescription"
                  rows={3}
                  value={workflowDescription}
                  onChange={(e) => setWorkflowDescription(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入编排描述（可选）"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  适合的技术栈
                </label>
                <div className="relative">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {workflowTechStack.map((ts) => (
                      <span
                        key={ts}
                        className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                      >
                        {ts}
                        <button
                          type="button"
                          onClick={() => setWorkflowTechStack(workflowTechStack.filter((t) => t !== ts))}
                          className="ml-2 text-blue-600 hover:text-blue-800"
                        >
                          <X size={14} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={techStackSearch}
                      onChange={(e) => {
                        setTechStackSearch(e.target.value);
                        setShowTechStackDropdown(true);
                      }}
                      onFocus={() => setShowTechStackDropdown(true)}
                      placeholder={loadingTechStack ? "加载中..." : "搜索并选择技术栈..."}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      disabled={loadingTechStack}
                    />
                    {showTechStackDropdown && !loadingTechStack && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {techStackOptions
                          .filter((option) => 
                            option.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                            !workflowTechStack.includes(option)
                          )
                          .slice(0, 20)
                          .map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                setWorkflowTechStack([...workflowTechStack, option]);
                                setTechStackSearch('');
                                setShowTechStackDropdown(false);
                              }}
                              className="w-full px-4 py-2 text-left hover:bg-gray-100 text-sm"
                            >
                              {option}
                            </button>
                          ))}
                        {techStackOptions.filter((option) => 
                          option.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                          !workflowTechStack.includes(option)
                        ).length === 0 && (
                          <div className="px-4 py-2 text-sm text-gray-500">
                            无匹配选项
                          </div>
                        )}
                      </div>
                    )}
{loadingTechStack && (
                       <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg p-4">
                         <div className="flex items-center justify-center">
                           <Loader2 className="h-4 w-4 animate-spin mr-2" />
                           <span className="text-sm text-gray-500">加载技术栈选项...</span>
                         </div>
                       </div>
                     )}
                   </div>
                   <p className="text-xs text-gray-500 mt-1">
                     可选择多个技术栈，表示此编排适用于这些技术
                   </p>
                 </div>

                {/* 公开选项 */}
                <div className="pt-4 border-t border-gray-200">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={workflowIsPublic}
                      onChange={(e) => setWorkflowIsPublic(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 flex items-center gap-1">
                      {workflowIsPublic ? <Globe size={14} className="text-blue-600" /> : <Lock size={14} />}
                      公开（其他用户可在评估中使用）
                    </span>
                  </label>
                  {workflowIsPublic && (
                    <p className="text-xs text-blue-600 mt-2 ml-6">
                      公开的编排将出现在所有用户的评估编排选择列表中
                    </p>
                  )}
                </div>
               </div>
             </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setWorkflowName('');
                  setWorkflowDescription('');
                  setWorkflowTechStack([]);
                  setWorkflowIsPublic(false);
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
                {creating ? '创建中...' : '创建编排'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑编排信息对话框 */}
      {showEditModal && editingWorkflow && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">编辑编排信息</h3>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingWorkflow(null);
                  setWorkflowName('');
                  setWorkflowDescription('');
                  setWorkflowTechStack([]);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="editWorkflowName" className="block text-sm font-medium text-gray-700">
                  编排名称 *
                </label>
                <input
                  id="editWorkflowName"
                  type="text"
                  required
                  maxLength={100}
                  minLength={2}
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入编排名称（2-100个字符）"
                />
              </div>

              <div>
                <label htmlFor="editWorkflowDescription" className="block text-sm font-medium text-gray-700">
                  编排描述
                </label>
                <textarea
                  id="editWorkflowDescription"
                  rows={3}
                  value={workflowDescription}
                  onChange={(e) => setWorkflowDescription(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入编排描述（可选）"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  适合的技术栈
                </label>
                <div className="relative">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {workflowTechStack.map((ts) => (
                      <span
                        key={ts}
                        className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                      >
                        {ts}
                        <button
                          type="button"
                          onClick={() => setWorkflowTechStack(workflowTechStack.filter((t) => t !== ts))}
                          className="ml-2 text-blue-600 hover:text-blue-800"
                        >
                          <X size={14} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={techStackSearch}
                      onChange={(e) => {
                        setTechStackSearch(e.target.value);
                        setShowTechStackDropdown(true);
                      }}
                      onFocus={() => setShowTechStackDropdown(true)}
                      placeholder={loadingTechStack ? "加载中..." : "搜索并选择技术栈..."}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      disabled={loadingTechStack}
                    />
                    {showTechStackDropdown && !loadingTechStack && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {techStackOptions
                          .filter((option) => 
                            option.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                            !workflowTechStack.includes(option)
                          )
                          .slice(0, 20)
                          .map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                setWorkflowTechStack([...workflowTechStack, option]);
                                setTechStackSearch('');
                                setShowTechStackDropdown(false);
                              }}
                              className="w-full px-4 py-2 text-left hover:bg-gray-100 text-sm"
                            >
                              {option}
                            </button>
                          ))}
                        {techStackOptions.filter((option) => 
                          option.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                          !workflowTechStack.includes(option)
                        ).length === 0 && (
                          <div className="px-4 py-2 text-sm text-gray-500">
                            无匹配选项
                          </div>
                        )}
                      </div>
                    )}
                    {loadingTechStack && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg p-4">
                        <div className="flex items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          <span className="text-sm text-gray-500">加载技术栈选项...</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    可选择多个技术栈，表示此编排适用于这些技术
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingWorkflow(null);
                  setWorkflowName('');
                  setWorkflowDescription('');
                  setWorkflowTechStack([]);
                }}
                disabled={updating}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={updateWorkflowInfo}
                disabled={updating || !workflowName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updating ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
