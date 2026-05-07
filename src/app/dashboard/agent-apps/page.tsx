'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Plus, Box } from 'lucide-react';
import CreateAgentAppModal from './CreateAgentAppModal';
import AppDetailModal from './AppDetailModal';
import toast from 'react-hot-toast';

interface AgentApp {
  id: string;
  name: string;
  engine: string;
  startCommand: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SkillFileData {
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
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState<AgentApp | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

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

  const handleCreateApp = () => {
    setIsCreateModalOpen(true);
  };

  const handleAppClick = (app: AgentApp) => {
    setSelectedApp(app);
    setIsDetailModalOpen(true);
  };

  const handleCreateSubmit = async (formData: any, skillFile: SkillFileData) => {
    try {
      const token = localStorage.getItem('token');
      
      const fd = new FormData();
      fd.append('name', formData.name);
      fd.append('engine', formData.engine);
      fd.append('startCommand', formData.startCommand);
      fd.append('notes', formData.notes || '');
      fd.append('skillFileType', skillFile.type);
      
      if (skillFile.type === 'archive') {
        fd.append('skillFile', skillFile.file!);
      } else if (skillFile.type === 'folder') {
        const filesJson = skillFile.files!.map((f, i) => ({
          key: `file_${i}`,
          relativePath: f.webkitRelativePath,
        }));
        fd.append('filesJson', JSON.stringify(filesJson));
        skillFile.files!.forEach((f, i) => {
          fd.append(`file_${i}`, f);
        });
        
        const folderFile = new File([], skillFile.name, { type: 'application/x-directory' });
        fd.append('skillFile', folderFile);
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

  const handleUpdateSubmit = async (appId: string, formData: any, skillFile?: SkillFileData) => {
    try {
      const token = localStorage.getItem('token');
      
      const fd = new FormData();
      fd.append('name', formData.name);
      fd.append('engine', formData.engine);
      fd.append('startCommand', formData.startCommand);
      fd.append('notes', formData.notes || '');
      
      if (skillFile) {
        fd.append('skillFileType', skillFile.type);
        
        if (skillFile.type === 'archive') {
          fd.append('skillFile', skillFile.file!);
        } else if (skillFile.type === 'folder') {
          const filesJson = skillFile.files!.map((f, i) => ({
            key: `file_${i}`,
            relativePath: f.webkitRelativePath,
          }));
          fd.append('filesJson', JSON.stringify(filesJson));
          skillFile.files!.forEach((f, i) => {
            fd.append(`file_${i}`, f);
          });
          
          const folderFile = new File([], skillFile.name, { type: 'application/x-directory' });
          fd.append('skillFile', folderFile);
        }
      }
      
      const response = await fetch(`/api/agent-apps/${appId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '更新失败');
      }
      
      await fetchApps();
    } catch (error: any) {
      throw new Error(error.message || '更新失败，请重试');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agent应用开发</h1>
          <p className="mt-1 text-sm text-gray-600">管理和创建您的Agent应用</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">已创建的应用</h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={16} className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
            <button
              onClick={handleCreateApp}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
            >
              <Plus size={16} className="mr-2" />
              创建新应用
            </button>
          </div>
        </div>

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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {apps.map((app) => (
                <div
                  key={app.id}
                  className="border border-gray-200 rounded-lg p-4 hover:shadow-md hover:border-primary-300 transition-all cursor-pointer"
                  onClick={() => handleAppClick(app)}
                >
                  <h3 className="font-semibold text-gray-900">{app.name}</h3>
                  <div className="mt-2 flex items-center space-x-2">
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">{app.engine}</span>
                    <span className="text-xs text-gray-500">{app.startCommand}</span>
                  </div>
                  {app.notes && (
                    <p className="mt-2 text-sm text-gray-600 line-clamp-2">{app.notes}</p>
                  )}
                  <p className="mt-3 text-xs text-gray-500">
                    创建于 {new Date(app.createdAt).toLocaleDateString('zh-CN')}
                  </p>
                </div>
              ))}
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
    </div>
  );
}