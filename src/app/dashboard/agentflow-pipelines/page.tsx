'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Edit2, Trash2, Loader2, GitBranch, FileText, CheckCircle, Send, Box, X, Search, Filter } from 'lucide-react';
import toast from 'react-hot-toast';

interface AgentFlowPipeline {
  id: string;
  name: string;
  status: 'draft' | 'published';
  nodeCount: number;
  thumbnail?: string | null;
  agentAppId?: string | null;
  agentApp?: { id: string; name: string } | null;
  updatedAt: string;
  createdAt: string;
}

export default function AgentFlowPipelinesPage() {
  const router = useRouter();
  const [pipelines, setPipelines] = useState<AgentFlowPipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published'>('all');

  useEffect(() => { fetchPipelines(); }, []);

  const fetchPipelines = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/agentflow-pipelines', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setPipelines((data.pipelines || []).map((p: any) => ({
          ...p,
          nodeCount: Array.isArray(p.nodes) ? p.nodes.length : 0,
          agentApp: p.AgentApp || null,
        })));
      } else {
        setPipelines([]);
      }
    } catch {
      setPipelines([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/agentflow-pipelines', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '创建失败');
      }
      const data = await response.json();
      router.push(`/dashboard/agentflow-pipelines/${data.pipeline.id}`);
    } catch (error: any) {
      toast.error(error.message || '创建失败');
      setCreating(false);
    }
  };

  const handlePublish = async (pipeline: AgentFlowPipeline) => {
    try {
      setPublishingId(pipeline.id);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/agentflow-pipelines/${pipeline.id}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '发布失败');
      }
      const data = await response.json();
      toast.success(`发布成功！AgentApp: ${data.agentAppName}`);
      await fetchPipelines();
    } catch (error: any) {
      toast.error(error.message || '发布失败');
    } finally {
      setPublishingId(null);
    }
  };

  const handleDelete = async (pipeline: AgentFlowPipeline) => {
    if (!confirm(`确定要删除 Pipeline "${pipeline.name}" 吗？此操作不可恢复。`)) return;
    try {
      setDeletingId(pipeline.id);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/agentflow-pipelines/${pipeline.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }
      toast.success('删除成功');
      await fetchPipelines();
    } catch (error: any) {
      toast.error(error.message || '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const stats = {
    total: pipelines.length,
    draft: pipelines.filter(p => p.status === 'draft').length,
    published: pipelines.filter(p => p.status === 'published').length,
  };

  const filteredPipelines = pipelines.filter((pipeline) => {
    const matchesSearch = pipeline.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (pipeline.agentApp?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    const matchesStatus = statusFilter === 'all' || pipeline.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <GitBranch size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">AgentFlow 编排</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              共 <span className="text-primary-400 font-medium">{stats.total}</span> 个 Pipeline
              <span className="mx-2 text-gray-500">|</span>
              <span className="text-gray-400">草稿 <span className="text-gray-300">{stats.draft}</span></span>
              <span className="mx-2 text-gray-500">|</span>
              <span className="text-green-400/70">已发布 <span className="text-green-400">{stats.published}</span></span>
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="group flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 bg-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400"
        >
          <Plus size={18} className="transition-transform group-hover:rotate-90 duration-200" />
          新建 Pipeline
        </button>
      </div>

      {/* 搜索筛选 + 卡片列表 */}
      <div className="bg-dark-surface border border-gray-700/50 rounded-xl">
        {/* 搜索筛选区域 */}
        <div className="px-5 py-4 border-b border-gray-700/50">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="搜索 Pipeline 名称或 AgentApp..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-primary-500 text-gray-100 placeholder-gray-500 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-gray-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'draft' | 'published')}
                className="w-[170px] px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-primary-500 text-gray-100 text-sm"
              >
                <option value="all">全部状态</option>
                <option value="draft">草稿</option>
                <option value="published">已发布</option>
              </select>
            </div>
          </div>
        </div>

        {/* 卡片列表区域 */}
        {filteredPipelines.length === 0 ? (
          <div className="text-center py-12">
            <GitBranch className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-100">
              {searchQuery || statusFilter !== 'all' ? '未找到匹配的 Pipeline' : '暂无 Pipeline'}
            </h3>
            <p className="mt-2 text-sm text-gray-400">
              {searchQuery || statusFilter !== 'all'
                ? '尝试调整搜索条件或筛选器'
                : '点击"新建 Pipeline"开始创建'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 p-5">
            {filteredPipelines.map((pipeline) => (
              <div
                key={pipeline.id}
                className="bg-dark-bg rounded-lg border border-gray-700/50 overflow-hidden hover:border-gray-600/50 hover:shadow-md transition-all flex flex-col group"
              >
                {/* 缩略图 */}
                {pipeline.thumbnail && (
                  <div className="h-24 bg-dark-surface-hover relative overflow-hidden">
                    <img
                      src={`data:image/png;base64,${pipeline.thumbnail}`}
                      alt={pipeline.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                )}
                {/* 内容区 */}
                <div className="p-4 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-base font-medium text-gray-100 truncate">{pipeline.name}</h3>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30">
                          Pipeline
                        </span>
                      </div>
                      {pipeline.agentApp && (
                        <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                          <Box size={10} />
                          {pipeline.agentApp.name}
                        </p>
                      )}
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium flex-shrink-0 ${
                        pipeline.status === 'published'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-gray-700/50 text-gray-300'
                      }`}
                    >
                      {pipeline.status === 'published' ? <CheckCircle size={12} /> : <FileText size={12} />}
                      {pipeline.status === 'published' ? '已发布' : '草稿'}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <FileText size={12} />
                      <span>{pipeline.nodeCount} 节点</span>
                    </div>
                    <span>{new Date(pipeline.updatedAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="bg-dark-surface/50 px-4 py-2.5 border-t border-gray-700/50">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => router.push(`/dashboard/agentflow-pipelines/${pipeline.id}`)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded-md transition-colors"
                      >
                        <Edit2 size={14} />
                        编辑
                      </button>
                      {pipeline.status === 'draft' && (
                        <button
                          onClick={() => handlePublish(pipeline)}
                          disabled={publishingId === pipeline.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 rounded-md transition-colors disabled:opacity-50"
                        >
                          {publishingId === pipeline.id
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Send size={14} />}
                          发布
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(pipeline)}
                      disabled={deletingId === pipeline.id}
                      className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50"
                      title="删除"
                    >
                      {deletingId === pipeline.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新建弹窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-dark-surface rounded-xl shadow-xl max-w-md w-full mx-4 border border-gray-700/50">
            <div className="px-5 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
                  <Plus size={16} className="text-white" />
                </div>
                <h3 className="text-lg font-semibold text-gray-100">新建 Pipeline</h3>
              </div>
              <button 
                onClick={() => { setShowCreateModal(false); setNewName(''); }} 
                className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 rounded-md transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Pipeline 名称 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
                className="w-full px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-primary-500 text-gray-100 placeholder-gray-500 text-sm"
                placeholder="输入 Pipeline 名称"
              />
            </div>
            <div className="px-5 py-4 border-t border-gray-700/50 flex justify-end gap-3">
              <button
                onClick={() => { setShowCreateModal(false); setNewName(''); }}
                disabled={creating}
                className="px-4 py-2 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="px-4 py-2 bg-primary-500 hover:bg-primary-400 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {creating && <Loader2 size={16} className="animate-spin" />}
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
