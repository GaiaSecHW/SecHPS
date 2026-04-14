'use client';

import { useEffect, useState } from 'react';
import {
  Puzzle,
  Power,
  Trash2,
  RefreshCw,
  AlertCircle,
  Loader2,
  Check,
  Package,
  Settings,
  ExternalLink,
  Plus,
  Play,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import type { PluginResponse, PluginType } from '@/types/plugin';
import InstallPluginModal from '@/components/plugins/InstallPluginModal';

export default function PluginsPage() {
  const [user, setUser] = useState<any>(null);
  const [plugins, setPlugins] = useState<PluginResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [executingPlugin, setExecutingPlugin] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 10;

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
    fetchPlugins();
  }, [page]);

  const fetchPlugins = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      if (!token) {
        setError('请先登录');
        setLoading(false);
        return;
      }
      
      const response = await fetch(`/api/plugins?page=${page}&limit=${pageSize}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 403) {
        setError('权限不足：需要管理员或经理权限才能访问插件管理。请尝试重新登录。');
        setLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error('获取插件列表失败');
      }

      const data = await response.json();
      setPlugins(data.plugins || []);
      setTotalCount(data.pagination?.total || data.plugins?.length || 0);
    } catch (err) {
      setError('加载插件列表失败');
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = (permission: string) => {
    return user?.permissions?.includes(permission) || user?.roles?.includes('admin');
  };

  const handleTogglePlugin = async (id: string, enabled: boolean) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/plugins/${id}/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '操作失败');
      }

      setSuccess(enabled ? '插件已启用' : '插件已禁用');
      fetchPlugins();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleUninstallPlugin = async (id: string, name: string) => {
    if (!confirm(`确定要卸载插件 "${name}" 吗？此操作不可恢复。`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/plugins/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '卸载失败');
      }

      setSuccess('插件卸载成功');
      fetchPlugins();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '卸载失败');
      setTimeout(() => setError(null), 3000);
    }
  };

  const getTypeLabel = (type: PluginType) => {
    const labels: Record<PluginType, string> = {
      'ui-tab': 'UI 标签页',
      'backend-service': '后端服务',
      'integration': '集成',
      'tool': '工具',
    };
    return labels[type] || type;
  };

  const getTypeColor = (type: PluginType) => {
    const colors: Record<PluginType, string> = {
      'ui-tab': 'bg-blue-100 text-blue-800',
      'backend-service': 'bg-purple-100 text-purple-800',
      'integration': 'bg-green-100 text-green-800',
      'tool': 'bg-orange-100 text-orange-800',
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      error: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      active: '运行中',
      inactive: '未启用',
      error: '错误',
    };
    return labels[status] || status;
  };

  const handleExecutePlugin = async (id: string) => {
    try {
      setExecutingPlugin(id);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/plugins/${id}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '执行失败');
      }

      const result = await response.json();
      setSuccess(`插件执行成功: ${result.result?.data?.message || '完成'}`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '执行失败');
      setTimeout(() => setError(null), 3000);
    } finally {
      setExecutingPlugin(null);
    }
  };

  if (!hasPermission(PERMISSIONS.PLUGIN_READ)) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            访问被拒绝
          </h2>
          <p className="text-gray-600">
            您没有查看插件的权限。
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Puzzle className="h-6 w-6" />
            插件管理
          </h1>
          <p className="text-gray-600 mt-1">
            管理和配置系统插件
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hasPermission(PERMISSIONS.PLUGIN_CREATE) && (
            <button
              onClick={() => setShowInstallModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} />
              安装插件
            </button>
          )}
          <button
            onClick={fetchPlugins}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
            title="刷新插件列表"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md flex items-center gap-2">
          <Check className="h-5 w-5" />
          {success}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Plugin Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">总插件数</p>
              <p className="text-2xl font-semibold text-gray-900">{plugins.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Power className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">已启用</p>
              <p className="text-2xl font-semibold text-gray-900">
                {plugins.filter(p => p.isEnabled).length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 rounded-lg">
              <Settings className="h-5 w-5 text-gray-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">未启用</p>
              <p className="text-2xl font-semibold text-gray-900">
                {plugins.filter(p => !p.isEnabled).length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <AlertCircle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">错误</p>
              <p className="text-2xl font-semibold text-gray-900">
                {plugins.filter(p => p.status === 'error').length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Plugin Grid */}
      {plugins.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <Puzzle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">暂无插件</h3>
          <p className="text-gray-600">
            系统中还没有安装任何插件。您可以在 plugins 目录中添加插件。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              {/* Plugin Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {plugin.displayName}
                    </h3>
                    {plugin.isBuiltin && (
                      <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">
                        内置
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-2">
                    {plugin.description}
                  </p>
                </div>
              </div>

              {/* Plugin Info */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">名称</span>
                  <span className="font-mono text-gray-900">{plugin.name}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">版本</span>
                  <span className="text-gray-900">{plugin.version}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">作者</span>
                  <span className="text-gray-900">{plugin.author}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">类型</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${getTypeColor(plugin.type)}`}>
                    {getTypeLabel(plugin.type)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">状态</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(plugin.status)}`}>
                    {getStatusLabel(plugin.status)}
                  </span>
                </div>
              </div>

              {/* Plugin Actions */}
              <div className="flex items-center gap-2 pt-4 border-t border-gray-200">
                {plugin.isEnabled && plugin.type === 'tool' && (
                  <button
                    onClick={() => handleExecutePlugin(plugin.id)}
                    disabled={executingPlugin === plugin.id}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors disabled:opacity-50"
                    title="执行插件"
                  >
                    {executingPlugin === plugin.id ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Play size={16} />
                    )}
                    {executingPlugin === plugin.id ? '执行中...' : '执行'}
                  </button>
                )}
                {hasPermission(PERMISSIONS.PLUGIN_TOGGLE) && (
                  <button
                    onClick={() => handleTogglePlugin(plugin.id, !plugin.isEnabled)}
                    disabled={plugin.isBuiltin && plugin.isEnabled}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      plugin.isEnabled
                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={plugin.isEnabled ? '禁用插件' : '启用插件'}
                  >
                    <Power size={16} />
                    {plugin.isEnabled ? '已启用' : '启用'}
                  </button>
                )}
                {hasPermission(PERMISSIONS.PLUGIN_DELETE) && !plugin.isBuiltin && (
                  <button
                    onClick={() => handleUninstallPlugin(plugin.id, plugin.name)}
                    className="flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                    title="卸载插件"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                {plugin.homepage && (
                  <a
                    href={plugin.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors"
                    title="访问主页"
                  >
                    <ExternalLink size={16} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页 */}
      {totalCount > pageSize && (
        <div className="flex items-center justify-between mt-4 px-4 py-3 bg-white rounded-lg border border-gray-200">
          <span className="text-sm text-gray-600">
            共 {totalCount} 条，第 {page}/{Math.ceil(totalCount / pageSize)} 页
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-gray-600">第 {page} 页</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= Math.ceil(totalCount / pageSize)}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Install Plugin Modal */}
      {showInstallModal && (
        <InstallPluginModal
          isOpen={showInstallModal}
          onClose={() => setShowInstallModal(false)}
          onSuccess={fetchPlugins}
        />
      )}
    </div>
  );
}
