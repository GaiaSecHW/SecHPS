'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Edit2, Trash2, Loader2, GitBranch, FileText, CheckCircle, Archive, Send, Box, X } from 'lucide-react';
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">AgentFlow 编排</h1>
          <p className="mt-1 text-sm text-gray-400">管理和创建您的 AgentFlow Pipeline</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <Plus size={20} />
          <span>新建 Pipeline</span>
        </button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-400">总 Pipeline</p>
              <p className="text-2xl font-bold text-gray-100 mt-1">{stats.total}</p>
            </div>
            <div className="p-3 bg-blue-600/10 rounded-lg">
              <GitBranch className="h-6 w-6 text-blue-400" />
            </div>
          </div>
        </div>
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-400">草稿</p>
              <p className="text-2xl font-bold text-gray-100 mt-1">{stats.draft}</p>
            </div>
            <div className="p-3 bg-[#0F172A] rounded-lg">
              <FileText className="h-6 w-6 text-gray-400" />
            </div>
          </div>
        </div>
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-400">已发布</p>
              <p className="text-2xl font-bold text-gray-100 mt-1">{stats.published}</p>
            </div>
            <div className="p-3 bg-green-600/10 rounded-lg">
              <CheckCircle className="h-6 w-6 text-green-400" />
            </div>
          </div>
        </div>
      </div>

      {/* 卡片列表 */}
      {pipelines.length === 0 ? (
        <div className="text-center py-12 bg-dark-surface rounded-lg border border-gray-700/50">
          <GitBranch className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-100">暂无 Pipeline</h3>
          <p className="mt-2 text-sm text-gray-400">点击"新建 Pipeline"开始创建</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
          {pipelines.map((pipeline) => (
            <div
              key={pipeline.id}
              className="bg-dark-surface rounded-lg border border-gray-700/50 overflow-hidden hover:shadow-lg transition-shadow flex flex-col"
            >
              {/* 缩略图 */}
              {pipeline.thumbnail && (
                <div className="h-32 bg-dark-surface-hover relative">
                  <img
                    src={`data:image/png;base64,${pipeline.thumbnail}`}
                    alt={pipeline.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              {/* 内容区 */}
              <div className="p-6 flex-1">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-semibold text-gray-100 truncate">{pipeline.name}</h3>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/15 text-purple-400">
                        <GitBranch size={11} />
                        Pipeline
                      </span>
                    </div>
                    {pipeline.agentApp && (
                      <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                        <Box size={11} />
                        {pipeline.agentApp.name}
                      </p>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ml-2 flex-shrink-0 ${
                      pipeline.status === 'published'
                        ? 'bg-green-500/15 text-green-400 border-green-500/20'
                        : 'bg-dark-surface-hover text-gray-200 border-gray-700/50'
                    }`}
                  >
                    {pipeline.status === 'published' ? <CheckCircle size={12} /> : <FileText size={12} />}
                    {pipeline.status === 'published' ? '已发布' : '草稿'}
                  </span>
                </div>

                <div className="mt-4 flex items-center space-x-4 text-xs text-gray-500">
                  <div className="flex items-center space-x-1">
                    <FileText size={14} />
                    <span>{pipeline.nodeCount} 节点</span>
                  </div>
                </div>

                <p className="mt-2 text-xs text-gray-400">
                  更新于 {new Date(pipeline.updatedAt).toLocaleDateString('zh-CN')}
                </p>
              </div>

              {/* 操作按钮 */}
              <div className="bg-[#0F172A] px-6 py-3 border-t border-gray-700/50 mt-auto">
                <div className="flex items-center justify-between">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => router.push(`/dashboard/agentflow-pipelines/${pipeline.id}`)}
                      className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-blue-400 hover:text-blue-300 bg-blue-600/10 hover:bg-blue-600/20 rounded-md transition-colors"
                    >
                      <Edit2 size={16} />
                      <span>编辑流程</span>
                    </button>
                    {pipeline.status === 'draft' && (
                      <button
                        onClick={() => handlePublish(pipeline)}
                        disabled={publishingId === pipeline.id}
                        className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-green-400 hover:text-green-300 bg-green-600/10 hover:bg-green-600/20 rounded-md transition-colors disabled:opacity-50"
                      >
                        {publishingId === pipeline.id
                          ? <Loader2 size={16} className="animate-spin" />
                          : <Send size={16} />}
                        <span>发布</span>
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
                      ? <Loader2 size={16} className="animate-spin" />
                      : <Trash2 size={16} />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建弹窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-dark-surface rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-100">新建 Pipeline</h3>
              <button onClick={() => { setShowCreateModal(false); setNewName(''); }} className="text-gray-400 hover:text-gray-200">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">Pipeline 名称</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
                className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 text-gray-100"
                placeholder="输入 Pipeline 名称"
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end space-x-3">
              <button
                onClick={() => { setShowCreateModal(false); setNewName(''); }}
                disabled={creating}
                className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A] disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
