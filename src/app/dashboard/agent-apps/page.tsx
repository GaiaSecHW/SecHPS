'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Plus, Box, Edit2, Trash2, Loader2, Eye, BookOpen, Bot, Terminal, User, Calendar, Play, ShieldAlert, Bell, Percent, Globe, Lock, CheckCircle, Clock, GitPullRequest, GitBranch, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
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
  requireCodedmap?: boolean;
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
  agentHarnessPath?: string | null;
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
  const [expandedHarness, setExpandedHarness] = useState<string | null>(null);
  const [harnessBranches, setHarnessBranches] = useState<Record<string, Array<{ name: string; giteaUrl: string }>>>({});

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
        const appsList = data.apps || [];
        setApps(appsList);

        // 预加载有 Harness 的应用分支数量
        const withHarness = appsList.filter((a: AgentApp) => a.agentHarnessPath);
        if (withHarness.length > 0) {
          const token2 = localStorage.getItem('token');
          Promise.all(withHarness.map(async (a: AgentApp) => {
            try {
              const res = await fetch(`/api/agent-apps/${a.id}/branches`, {
                headers: { Authorization: `Bearer ${token2}` },
              });
              if (res.ok) {
                const bData = await res.json();
                return { id: a.id, branches: bData.branches };
              }
            } catch {}
            return null;
          })).then(results => {
            const map: Record<string, Array<{ name: string; giteaUrl: string }>> = {};
            for (const r of results) {
              if (r) map[r.id] = r.branches;
            }
            setHarnessBranches(prev => ({ ...prev, ...map }));
          });
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: '未知错误' }));
        console.error('获取Agent列表失败:', errorData);
        toast.error(errorData.error || '获取Agent列表失败');
        setApps([]);
      }
    } catch (error) {
      console.error('获取Agent列表失败:', error);
      toast.error('获取Agent列表失败');
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
    if (!confirm(`确定要删除Agent "${app.name}" 吗？此操作不可恢复。`)) {
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
      
      toast.success('Agent删除成功');
      await fetchApps();
    } catch (error: any) {
      toast.error(error.message || '删除失败，请重试');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleHarness = async (appId: string) => {
    if (expandedHarness === appId) {
      setExpandedHarness(null);
      return;
    }
    setExpandedHarness(appId);
    if (!harnessBranches[appId]) {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/agent-apps/${appId}/branches`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setHarnessBranches(prev => ({ ...prev, [appId]: data.branches }));
        }
      } catch {}
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
      fd.append('requireCodedmap', formData.requireCodedmap ? 'true' : 'false');
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
        fd.append('requireCodedmap', formData.requireCodedmap ? 'true' : 'false');
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
            requireCodedmap: formData.requireCodedmap || false,
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
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <Box size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Agent市场</h1>
            <p className="text-sm text-gray-400 mt-0.5">管理和创建您的 Agent</p>
          </div>
        </div>
<div className="flex items-center gap-3">
          <button
            onClick={() => window.location.href = '/dashboard/agent-apps/developer-guide'}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-300 bg-dark-surface border border-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors"
          >
            <BookOpen size={16} />
            开发者指南
          </button>
<button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center px-3 py-2 text-sm text-gray-300 bg-dark-surface-hover border border-gray-700/50 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
              刷新
            </button>
            {isAdmin && (
              <button
                onClick={handleSyncFromGitea}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-all"
              >
                {syncing ? <RefreshCw size={16} className="animate-spin" /> : <GitPullRequest size={16} />}
                同步仓库
              </button>
            )}
            <button
             onClick={handleCreateApp}
             className="group inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 bg-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400"
           >
             <Plus size={16} className="transition-transform group-hover:rotate-90 duration-200" />
             创建新Agent
           </button>
         </div>
      </div>

      {/* Card Grid */}
      {loading ? (
        <div className="bg-dark-surface border border-gray-700/50 rounded-xl p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : apps.length === 0 ? (
        <div className="bg-dark-surface border border-gray-700/50 rounded-xl p-12">
          <div className="text-center">
            <Box className="mx-auto h-16 w-16 text-gray-500 opacity-60" />
            <h3 className="mt-4 text-lg font-medium text-gray-100">暂无 Agent</h3>
            <p className="mt-2 text-sm text-gray-500">
              点击右上角"创建新 Agent"开始
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-dark-surface border border-gray-700/50 rounded-xl p-5">
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
                  className="group relative flex flex-col rounded-xl border border-gray-700/50 bg-gray-800/40 hover:bg-gray-800/70 hover:border-gray-600/70 transition-all cursor-pointer"
                  onClick={() => handleEdit(app)}
                >
                  {/* Header */}
                  <div className="px-4 pt-4 pb-3 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 shadow-lg`}>
                      <Bot size={18} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold text-gray-100 truncate pr-6">{app.name}</h4>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[11px] bg-gray-900/80 text-gray-400 px-1.5 py-0.5 rounded font-mono border border-gray-700/50">
                          {app.engine === 'opencode' ? 'OpenCode' : app.engine === 'claudecode' ? 'Claude Code' : app.engine}
                        </span>
                        {app.isPublic
                          ? <span title="已共享"><Globe size={11} className="text-green-400" /></span>
                          : <span title="私有"><Lock size={11} className="text-gray-500" /></span>}
                      </div>
                    </div>
                    {/* Edit + Delete + View icons */}
                    <div className="shrink-0 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      {app.engine === 'agentflow' && (
                        <button
                          onClick={() => setViewingApp(app)}
                          className="p-1.5 rounded-lg text-gray-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                          title="查看流程"
                        >
                          <Eye size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(app)}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-primary-400 hover:bg-primary-500/10 transition-colors"
                        title="编辑"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(app)}
                        disabled={deletingId === app.id}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        title="删除"
                      >
                        {deletingId === app.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="mx-4 border-t border-gray-700/40" />

                  {/* Metrics — 3 cols top row, 3 cols bottom row */}
                  <div className="px-4 py-3 grid grid-cols-3 gap-1.5">
                    {[
                      { icon: <Play size={12} />, value: app._metrics?.runCount ?? 0, label: '运行次数', color: 'text-blue-400', show: true },
                      { icon: <ShieldAlert size={12} />, value: app._metrics?.vulnCount ?? 0, label: '确认漏洞', color: 'text-red-400', show: true },
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
                        color: 'text-gray-400',
                        show: true,
                      },
                    ].filter(m => m.show).map(({ icon, value, label, color }) => (
                      <div key={label} className="flex flex-col items-center gap-0.5 py-2 rounded-lg bg-gray-900/40">
                        <span className={color}>{icon}</span>
                        <span className="text-sm font-bold text-gray-100 leading-tight">{value}</span>
                        <span className="text-[10px] text-gray-500">{label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Divider */}
                  <div className="mx-4 border-t border-gray-700/40" />

                  {/* Meta info */}
                  <div className="px-4 py-3 flex items-center justify-between text-xs text-gray-400">
                    <span><span className="text-gray-600">开发者：</span>{app.User?.username || app.User?.name || '-'}</span>
                    <span><span className="text-gray-600">更新：</span>{new Date(app.updatedAt).toLocaleDateString('zh-CN')}</span>
                  </div>

                  {/* Harness branches (collapsible) */}
                  {app.agentHarnessPath && (
                    <div className="border-t border-gray-700/40" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleHarness(app.id)}
                        className="w-full px-4 py-2 flex items-center gap-2 text-xs text-cyan-400 hover:bg-gray-800/60 transition-colors"
                      >
                        {expandedHarness === app.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <GitBranch className="w-3 h-3" />
                        <span>Harness 分支 ({harnessBranches[app.id]?.length ?? '...'})</span>
                      </button>
                      {expandedHarness === app.id && harnessBranches[app.id] && (
                        <div className="px-4 pb-3 space-y-1">
                          {harnessBranches[app.id].length === 0 ? (
                            <p className="text-xs text-gray-500 pl-5">暂无版本分支</p>
                          ) : harnessBranches[app.id].map(branch => (
                            <a
                              key={branch.name}
                              href={branch.giteaUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-300 hover:bg-gray-700/60 hover:text-cyan-300 transition-colors group"
                            >
                              <GitBranch className="w-3 h-3 text-gray-500 group-hover:text-cyan-400" />
                              <span className="flex-1 font-mono truncate">{branch.name}</span>
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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