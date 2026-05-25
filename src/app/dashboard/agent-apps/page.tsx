'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Plus, Box, Edit2, Trash2, Loader2, Eye, BookOpen, Bot, Terminal, User, Calendar, Play, ShieldAlert, Bell, Percent, Globe, Lock, CheckCircle, Clock, GitPullRequest } from 'lucide-react';
import CreateAgentAppModal from './CreateAgentAppModal';
import AppDetailModal from './AppDetailModal';
import { PipelineViewModal } from '@/components/agent-apps/PipelineViewModal';
import toast from 'react-hot-toast';

interface AgentApp {
  id: string;
  name: string;
  engine: string;
  defaultAgentName: string;
  startCommand?: string | null;
  isPublic: boolean;
  tenantId?: string | null;
  Tenant?: {
    name: string;
  } | null;
  User?: {
    name: string | null;
    username: string;
  };
  _metrics?: {
    runCount: number;
    successRate: number | null;
    lastRunAt: string | null;
    vulnCount: number;
    alertCount: number;
    falsePositiveRate: number | null;
  };
  createdAt: string;
  updatedAt: string;
}

interface AgentHarnessFileData {
  type: 'folder' | 'archive';
  name: string;
  files?: File[];
  file?: File;
  size?: number;
}

export default function AgentAppsPage() {
  const router = useRouter();
  const [apps, setApps] = useState<AgentApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState<AgentApp | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingApp, setViewingApp] = useState<AgentApp | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      try { setIsAdmin(JSON.parse(userData)?.roles?.includes('admin') ?? false); } catch {}
    }
  }, []);

  useEffect(() => {
    fetchApps();
  }, []);

  const fetchApps = async () => {
    try {
      setLoading(true);

      const token = localStorage.getItem('token');
      const response = await fetch('/api/agent-apps', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setApps(data.apps || []);
      } else {
        const errorData = await response.json().catch(() => ({ error: '未知错误' }));
        console.error('获取应用列表失败:', errorData);
        toast.error(errorData.error || '获取应用列表失败');
        setApps([]);
      }
    } catch (error) {
      console.error('获取应用列表失败:', error);
      toast.error('获取应用列表失败');
      setApps([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchApps();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleSyncFromGitea = async () => {
    if (!confirm('确定要从 Gitea 同步所有 AgentHarness 仓库吗？')) return;
    try {
      setSyncing(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/agent-apps/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '同步失败');
      }

      const result = await response.json();
      toast.success(`同步完成: ${result.successCount}/${result.total} 成功`);
      fetchApps();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateApp = () => {
    setIsCreateModalOpen(true);
  };

  const handleEdit = (app: AgentApp) => {
    setSelectedApp(app);
    setIsDetailModalOpen(true);
  };

  const handleDelete = async (app: AgentApp) => {
    if (!confirm(`确定要删除应用 "${app.name}" 吗？此操作不可恢复。`)) {
      return;
    }

    try {
      setDeletingId(app.id);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/agent-apps/${app.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`服务器返回非 JSON 格式响应`);
      }
      
      if (!response.ok) {
        throw new Error(data.error || '删除失败');
      }
      
      toast.success('应用删除成功');
      await fetchApps();
    } catch (error: any) {
      toast.error(error.message || '删除失败，请重试');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateSubmit = async (formData: any, agentHarnessFile: AgentHarnessFileData, isPublic: boolean) => {
    try {
      const token = localStorage.getItem('token');

      const fd = new FormData();
      fd.append('name', formData.name);
      fd.append('engine', formData.engine);
      fd.append('defaultAgentName', formData.defaultAgentName);
      if (formData.startCommand) {
        fd.append('startCommand', formData.startCommand);
      }
      if (formData.inputRequirements) {
        fd.append('inputRequirements', formData.inputRequirements);
      }
      fd.append('isPublic', isPublic ? 'true' : 'false');
      // __public__ 是前端占位值，后端收到 isPublic=true 时不需要 tenantId
      const tenantId = formData.tenantId === '__public__' ? '' : (formData.tenantId || '');
      fd.append('tenantId', tenantId);
      fd.append('agentHarnessFileType', agentHarnessFile.type);

      if (agentHarnessFile.type === 'archive') {
        fd.append('agentHarnessFile', agentHarnessFile.file!);
      } else if (agentHarnessFile.type === 'folder') {
        const filesJson = agentHarnessFile.files!.map((f, i) => ({
          key: `file_${i}`,
          relativePath: f.webkitRelativePath,
        }));
        fd.append('filesJson', JSON.stringify(filesJson));
        agentHarnessFile.files!.forEach((f, i) => {
          fd.append(`file_${i}`, f);
        });

        const folderFile = new File([], agentHarnessFile.name, { type: 'application/x-directory' });
        fd.append('agentHarnessFile', folderFile);
      }
      
      const response = await fetch('/api/agent-apps', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '创建失败');
      }
      
      await fetchApps();
    } catch (error: any) {
      throw new Error(error.message || '创建失败，请重试');
    }
  };

  const handleUpdateSubmit = async (appId: string, formData: any, agentHarnessFile?: AgentHarnessFileData, isPublic?: boolean) => {
    try {
      const token = localStorage.getItem('token');
      
      // 如果有文件上传，使用 FormData；否则使用 JSON
      if (agentHarnessFile) {
        const fd = new FormData();
        fd.append('name', formData.name);
        fd.append('engine', formData.engine);
        fd.append('defaultAgentName', formData.defaultAgentName);
        if (formData.startCommand) {
          fd.append('startCommand', formData.startCommand);
        }
        if (formData.inputRequirements) {
          fd.append('inputRequirements', formData.inputRequirements);
        }
        fd.append('isPublic', isPublic ? 'true' : 'false');
        fd.append('agentHarnessFileType', agentHarnessFile.type);
        
        if (agentHarnessFile.type === 'archive') {
          fd.append('agentHarnessFile', agentHarnessFile.file!);
        } else if (agentHarnessFile.type === 'folder') {
          const filesJson = agentHarnessFile.files!.map((f, i) => ({
            key: `file_${i}`,
            relativePath: f.webkitRelativePath,
          }));
          fd.append('filesJson', JSON.stringify(filesJson));
          agentHarnessFile.files!.forEach((f, i) => {
            fd.append(`file_${i}`, f);
          });
          
          const folderFile = new File([], agentHarnessFile.name, { type: 'application/x-directory' });
          fd.append('agentHarnessFile', folderFile);
        }
        
        const response = await fetch(`/api/agent-apps/${appId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`服务器返回非 JSON 格式响应: ${text.substring(0, 100)}`);
        }
        
        if (!response.ok) {
          throw new Error(data.error || '更新失败');
        }
        
        await fetchApps();
      } else {
        // 无文件上传，使用 JSON body（避免 Turbopack FormData 问题）
        const response = await fetch(`/api/agent-apps/${appId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: formData.name,
            engine: formData.engine,
            defaultAgentName: formData.defaultAgentName,
            startCommand: formData.startCommand || null,
            inputRequirements: formData.inputRequirements || null,
            isPublic: isPublic,
          }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || '更新失败');
        }
        
        await fetchApps();
      }
    } catch (error: any) {
      throw new Error(error.message || '更新失败，请重试');
    }
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/dashboard/agent-apps/developer-guide')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-dark-text-secondary bg-dark-surface-hover rounded-lg hover:bg-dark-border transition-colors"
          >
            <BookOpen size={14} />
            开发者指南
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-dark-text-secondary bg-dark-surface-hover rounded-lg hover:bg-dark-border disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            刷新
          </button>
          {isAdmin && (
            <button
              onClick={handleSyncFromGitea}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-dark-text-secondary bg-dark-surface-hover rounded-lg hover:bg-dark-border disabled:opacity-50 transition-colors"
            >
              {syncing ? <RefreshCw size={14} className="animate-spin" /> : <GitPullRequest size={14} />}
              同步仓库
            </button>
          )}
        </div>
        <button
          onClick={handleCreateApp}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
        >
          <Plus size={14} />
          创建新应用
        </button>
      </div>

      {/* Card Grid */}
      {loading ? (
        <div className="bg-dark-surface border border-dark-border rounded-xl p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-dark-text-muted" />
        </div>
      ) : apps.length === 0 ? (
        <div className="bg-dark-surface border border-dark-border rounded-xl p-12">
          <div className="text-center">
            <Box className="mx-auto h-16 w-16 text-dark-text-muted opacity-60" />
            <h3 className="mt-4 text-lg font-medium text-dark-text">暂无 Agent</h3>
            <p className="mt-2 text-sm text-dark-text-muted">
              点击右上角"创建新 Agent"开始
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-dark-surface border border-dark-border rounded-xl p-5">
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {apps.map((app) => {
              const engineColors: Record<string, string> = {
                opencode: 'from-teal-400 to-teal-600',
                claudecode: 'from-purple-400 to-purple-600',
                agentflow: 'from-cyan-400 to-cyan-600',
              };
              const gradient = engineColors[app.engine] || 'from-gray-400 to-gray-600';

              return (
                <div
                  key={app.id}
                  className="group relative flex flex-col rounded-xl border border-dark-border bg-dark-surface-hover/30 hover:bg-dark-surface-hover/60 hover:border-dark-border transition-all cursor-pointer"
                  onClick={() => handleEdit(app)}
                >
                  {/* Header */}
                  <div className="px-4 pt-4 pb-3 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 shadow-lg`}>
                      <Bot size={18} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold text-dark-text truncate pr-6">{app.name}</h4>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[11px] bg-dark-bg/80 text-dark-text-muted px-1.5 py-0.5 rounded font-mono border border-dark-border">
                          {app.engine === 'opencode' ? 'OpenCode' : app.engine === 'claudecode' ? 'Claude Code' : app.engine}
                        </span>
                        {app.isPublic
                          ? <span title="已共享"><Globe size={11} className="text-green-400" /></span>
                          : <span title="私有"><Lock size={11} className="text-dark-text-muted" /></span>}
                      </div>
                    </div>
                    {/* Edit + Delete + View icons */}
                    <div className="shrink-0 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      {app.engine === 'agentflow' && (
                        <button
                          onClick={() => setViewingApp(app)}
                          className="p-1.5 rounded-lg text-dark-text-muted hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                          title="查看流程"
                        >
                          <Eye size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(app)}
                        className="p-1.5 rounded-lg text-dark-text-muted hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                        title="编辑"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(app)}
                        disabled={deletingId === app.id}
                        className="p-1.5 rounded-lg text-dark-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        title="删除"
                      >
                        {deletingId === app.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="mx-4 border-t border-dark-border/40" />

                  {/* Metrics — 3 cols top row, 3 cols bottom row */}
                  <div className="px-4 py-3 grid grid-cols-3 gap-1.5">
                    {[
                      { icon: <Play size={12} />, value: app._metrics?.runCount ?? 0, label: '运行次数', color: 'text-blue-400', show: true },
                      { icon: <ShieldAlert size={12} />, value: app._metrics?.vulnCount ?? 0, label: '发现漏洞', color: 'text-red-400', show: true },
                      { icon: <Bell size={12} />, value: app._metrics?.alertCount ?? 0, label: '告警数量', color: 'text-yellow-400', show: true },
                      {
                        icon: <CheckCircle size={12} />,
                        value: app._metrics?.successRate != null ? `${(app._metrics.successRate * 100).toFixed(0)}%` : '-',
                        label: '成功率',
                        color: 'text-green-400',
                        show: isAdmin,
                      },
                      {
                        icon: <Percent size={12} />,
                        value: app._metrics?.falsePositiveRate != null
                          ? `${((1 - app._metrics.falsePositiveRate) * 100).toFixed(0)}%`
                          : '-',
                        label: '误报率',
                        color: 'text-purple-400',
                        show: isAdmin,
                      },
                      {
                        icon: <Clock size={12} />,
                        value: app._metrics?.lastRunAt
                          ? new Date(app._metrics.lastRunAt).toLocaleDateString('zh-CN')
                          : '-',
                        label: '最近运行',
                        color: 'text-dark-text-muted',
                        show: true,
                      },
                    ].filter(m => m.show).map(({ icon, value, label, color }) => (
                      <div key={label} className="flex flex-col items-center gap-0.5 py-2 rounded-lg bg-dark-bg/40">
                        <span className={color}>{icon}</span>
                        <span className="text-sm font-bold text-dark-text leading-tight">{value}</span>
                        <span className="text-[10px] text-dark-text-muted">{label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Divider */}
                  <div className="mx-4 border-t border-dark-border/40" />

                  {/* Meta info */}
                  <div className="px-4 py-3 flex items-center justify-between text-xs text-dark-text-muted">
                    <span><span className="text-dark-text-muted">开发者：</span>{app.User?.name || app.User?.username || '-'}</span>
                    <span><span className="text-dark-text-muted">更新：</span>{new Date(app.updatedAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CreateAgentAppModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateSubmit}
      />

      <AppDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        app={selectedApp}
        onUpdate={handleUpdateSubmit}
      />

      <PipelineViewModal
        appId={viewingApp?.id}
        isOpen={!!viewingApp}
        onClose={() => setViewingApp(null)}
      />
    </div>
  );
}