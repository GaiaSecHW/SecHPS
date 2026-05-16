'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Plus, Box, Edit2, Trash2, Loader2, Eye } from 'lucide-react';
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
        console.error('获取应用列表失败');
        setApps([]);
      }
    } catch (error) {
      console.error('获取应用列表失败:', error);
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

  const handleSyncFromGit = async () => {
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
      toast.success(`同步成功！${result.message}`);
      await fetchApps();
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
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <Box size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Agent应用开发</h1>
            <p className="text-sm text-gray-400 mt-0.5">管理和创建您的 Agent 应用</p>
          </div>
        </div>
<div className="flex items-center gap-3">
           <button
             onClick={handleSyncFromGit}
             disabled={syncing}
             className="inline-flex items-center px-3 py-2 text-sm text-gray-300 bg-dark-surface-hover border border-gray-700/50 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
           >
             <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
             同步仓库
           </button>
           <button
             onClick={handleRefresh}
             disabled={refreshing}
             className="inline-flex items-center px-3 py-2 text-sm text-gray-300 bg-dark-surface-hover border border-gray-700/50 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
           >
             <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
             刷新
           </button>
           <button
             onClick={handleCreateApp}
             className="group inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 bg-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400"
           >
             <Plus size={16} className="transition-transform group-hover:rotate-90 duration-200" />
             创建新应用
           </button>
         </div>
      </div>

      <div className="bg-dark-surface rounded-lg border border-gray-700/50">
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
            </div>
          ) : apps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <Box size={48} className="text-gray-300 mb-4" />
              <p className="text-base font-medium">暂无应用</p>
              <p className="text-sm mt-1">点击"创建新应用"开始创建您的第一个Agent应用</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700/50">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">名称</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">引擎</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">默认智能体</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">启动命令</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">共享</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">创建时间</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">更新时间</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-400">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app) => (
                    <tr key={app.id} className="border-b border-gray-700/30 hover:bg-gray-800/30">
                      <td className="py-3 px-4 text-sm text-gray-100 font-medium">{app.name}</td>
                      <td className="py-3 px-4">
                        <span className="text-xs bg-blue-500/15 text-blue-400 px-2 py-1 rounded">{app.engine}</span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-300">{app.defaultAgentName || '-'}</td>
                      <td className="py-3 px-4 text-sm text-gray-300">{app.startCommand || '-'}</td>
                      <td className="py-3 px-4">
                        {app.isPublic ? (
                          <span className="text-xs bg-green-500/15 text-green-400 px-2 py-1 rounded">已共享</span>
                        ) : (
                          <span className="text-xs bg-gray-500/15 text-gray-400 px-2 py-1 rounded">私有</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-500">
                        {new Date(app.createdAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-500">
                        {new Date(app.updatedAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          {app.engine === 'agentflow' && (
                            <button
                              onClick={() => setViewingApp(app)}
                              className="inline-flex items-center px-2 py-1 text-sm text-gray-300 hover:text-cyan-400 hover:bg-cyan-500/10 rounded transition-colors"
                            >
                              <Eye size={14} className="mr-1" />
                              查看
                            </button>
                          )}
                          <button
                            onClick={() => handleEdit(app)}
                            disabled={deletingId === app.id}
                            className="inline-flex items-center px-2 py-1 text-sm text-gray-300 hover:text-primary-400 hover:bg-primary-500/10 rounded transition-colors disabled:opacity-50"
                          >
                            <Edit2 size={14} className="mr-1" />
                            编辑
                          </button>
                          <button
                            onClick={() => handleDelete(app)}
                            disabled={deletingId === app.id}
                            className="inline-flex items-center px-2 py-1 text-sm text-gray-300 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                          >
                            {deletingId === app.id ? (
                              <Loader2 size={14} className="mr-1 animate-spin" />
                            ) : (
                              <Trash2 size={14} className="mr-1" />
                            )}
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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