'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Edit2, Trash2, Loader2, GitBranch, FileText, CheckCircle, Send, Box, X, Search, Layers } from 'lucide-react';
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

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  draft:     { bg: 'bg-gray-500/15', text: 'text-gray-400', label: '草稿' },
  published: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: '已发布' },
};

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

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <GitBranch size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">AgentFlow 编排</h1>
            <p className="text-sm text-gray-400 mt-0.5">可视化编排 Agent 执行流程</p>
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
                placeholder="搜索 Pipeline..."
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
                onClick={() => setStatusFilter('draft')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === 'draft' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25' : 'bg-dark-bg text-gray-400 hover:bg-gray-700'
                }`}
              >
                <FileText size={16} />
                草稿
              </button>
              <button
                onClick={() => setStatusFilter('published')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === 'published' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25' : 'bg-dark-bg text-gray-400 hover:bg-gray-700'
                }`}
              >
                <CheckCircle size={16} />
                已发布
              </button>
            </div>
          </div>
        </div>

        {/* Cards section */}
        {filteredPipelines.length === 0 ? (
          <div className="p-12">
            <div className="text-center">
              <Layers className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">
                {searchQuery || statusFilter !== 'all' ? '未找到匹配的 Pipeline' : '暂无 Pipeline'}
              </p>
              {!searchQuery && statusFilter === 'all' && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="text-purple-600 hover:text-purple-700"
                >
                  创建第一个 Pipeline
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
              {filteredPipelines.map((pipeline) => {
                const config = statusConfig[pipeline.status] || statusConfig.draft;
                const isPublishing = publishingId === pipeline.id;
                const isDeleting = deletingId === pipeline.id;

                return (
                  <div
                    key={pipeline.id}
                    className="group relative flex flex-col rounded border border-gray-600/50 bg-gray-700/30 hover:bg-gray-700/50 transition-colors cursor-pointer min-h-[160px]"
                    onClick={() => router.push(`/dashboard/agentflow-pipelines/${pipeline.id}`)}
                  >
                    {pipeline.thumbnail && (
                      <div className="h-20 bg-gray-800/50 overflow-hidden">
                        <img
                          src={`data:image/png;base64,${pipeline.thumbnail}`}
                          alt={pipeline.name}
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                        />
                      </div>
                    )}
                    <div className="flex-1 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-medium text-gray-100 truncate leading-tight">
                          {pipeline.name}
                        </h3>
                        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${config.bg} ${config.text}`}>
                          {pipeline.status === 'published' ? <CheckCircle size={10} /> : <FileText size={10} />}
                          {config.label}
                        </span>
                      </div>

                      {pipeline.agentApp && (
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <Box size={12} className="text-gray-500" />
                          <span className="truncate">{pipeline.agentApp.name}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>{pipeline.nodeCount} 节点</span>
                        <span className="text-gray-600">·</span>
                        <span>更新于 {formatTime(pipeline.updatedAt)}</span>
                      </div>
                    </div>

                    <div className="mt-auto border-t border-gray-600/30 px-4 py-2.5 flex items-center justify-between bg-gray-700/20">
                      <div className="flex items-center gap-1.5">
                        {pipeline.status === 'draft' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handlePublish(pipeline); }}
                            disabled={isPublishing}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-400/15 rounded transition-colors disabled:opacity-50"
                          >
                            {isPublishing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                            <span>发布</span>
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/agentflow-pipelines/${pipeline.id}`); }}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-600/30 rounded transition-colors"
                        >
                          <Edit2 size={12} />
                          <span>编辑</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(pipeline); }}
                          disabled={isDeleting}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-400 hover:text-red-400 hover:bg-red-400/15 rounded transition-colors disabled:opacity-50"
                        >
                          {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          <span>删除</span>
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

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-dark-surface rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-100">新建 Pipeline</h3>
              <button
                onClick={() => { setShowCreateModal(false); setNewName(''); }}
                className="text-gray-400 hover:text-gray-300 disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Pipeline 名称 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="请输入 Pipeline 名称"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end gap-3">
              <button
                onClick={() => { setShowCreateModal(false); setNewName(''); }}
                disabled={creating}
                className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-dark-bg disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {creating && <Loader2 size={14} className="animate-spin" />}
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}