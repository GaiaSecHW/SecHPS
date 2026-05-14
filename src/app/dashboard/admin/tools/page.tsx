'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Cog,
  Plus,
  Search,
  Edit,
  Trash2,
  Play,
  Power,
} from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';
import { useAuth } from '@/hooks/useAuth';
import { useApiFetch } from '@/hooks/useApiFetch';
import { apiDelete } from '@/lib/api-client';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorAlert } from '@/components/ui/Alert';

interface Tool {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  executor: string;
  isActive: boolean;
  isBuiltin: boolean;
  requiresPermission: boolean;
  timeout: number;
  createdAt: string;
}

interface ToolsResponse {
  tools: Tool[];
}

const categoryLabels: Record<string, string> = {
  'file': '文件操作',
  'code': '代码分析',
  'security': '安全检测',
  'network': '网络请求',
  'system': '系统命令',
};

export default function ToolsPage() {
  return (
    <AdminGuard>
      <ToolsPageContent />
    </AdminGuard>
  );
}

function ToolsPageContent() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  const { data, loading, error, refetch } = useApiFetch<ToolsResponse>('/api/tools');
  const tools = data?.tools || [];

  const filteredTools = tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tool.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDelete = async (toolId: string, toolName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`确定要删除工具「${toolName}」吗？此操作不可恢复。`)) {
      return;
    }

    const result = await apiDelete(`/api/tools/${toolId}`);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success('删除成功');
      refetch();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">工具管理</h1>
          <p className="mt-1 text-sm text-gray-400">
            管理 Skills 可使用的工具，共 {tools.length} 个工具
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => router.push('/dashboard/admin/tools/create')}
            className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus size={20} className="mr-2" />
            创建工具
          </button>
        )}
      </div>

      {/* 使用说明 */}
      <div className="bg-blue-900/20 border border-blue-500/20 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-400 mb-2">工具使用说明</h3>
        <ul className="text-sm text-blue-300 space-y-1">
          <li>• <strong>工具用途</strong>：工具是 Skills 可以调用的能力，如文件读取、代码分析、安全检测等</li>
          <li>• <strong>创建工具</strong>：点击右上角"创建工具"按钮，定义工具名称、参数和执行方式</li>
          <li>• <strong>编辑工具</strong>：点击工具卡片或编辑图标进入编辑页面</li>
          <li>• <strong>删除工具</strong>：内置工具不可删除，自定义工具可删除</li>
          <li>• <strong>禁用工具</strong>：在编辑页面可以禁用工具，禁用后 Skills 将无法调用</li>
        </ul>
      </div>

      {/* 搜索区域 */}
      <div className="bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="搜索工具..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-primary-500 text-gray-100 placeholder-gray-500 text-sm"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <ErrorAlert>{error}</ErrorAlert>
      )}

      {/* Tools List */}
      <div className="space-y-4">
        {filteredTools.length === 0 ? (
          <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-12">
            <div className="text-center">
              <Cog className="mx-auto h-16 w-16 text-gray-500" />
              <h3 className="mt-4 text-lg font-medium text-gray-100">暂无工具</h3>
              <p className="mt-2 text-sm text-gray-400">
                工具库为空，请添加工具
              </p>
            </div>
          </div>
        ) : (
          filteredTools.map((tool) => (
            <div
              key={tool.id}
              className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-4 hover:border-gray-600/50 transition-colors cursor-pointer"
              onClick={() => router.push(`/dashboard/admin/tools/${tool.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <div className={`p-2 rounded-lg ${tool.isActive ? 'bg-green-500/15' : 'bg-dark-surface-hover'}`}>
                      <Cog className={tool.isActive ? 'text-green-400' : 'text-gray-500'} size={20} />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="font-semibold text-gray-100">{tool.displayName}</h3>
                        {tool.isBuiltin && (
                          <span className="px-2 py-0.5 text-xs bg-purple-500/15 text-purple-400 border border-purple-500/20 rounded-full">
                            内置
                          </span>
                        )}
                        {tool.requiresPermission && (
                          <span className="px-2 py-0.5 text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 rounded-full">
                            需要权限
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{tool.name}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-gray-400">{tool.description}</p>
                  <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                    <span>{categoryLabels[tool.category] || tool.category}</span>
                    <span>执行器: {tool.executor}</span>
                    <span>超时: {tool.timeout}ms</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {!tool.isActive && (
                    <span className="px-2 py-0.5 text-xs bg-dark-surface-hover text-gray-400 rounded-full">
                      已禁用
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/admin/tools/${tool.id}`); }}
                    className="p-2 text-gray-400 hover:text-blue-400 hover:bg-blue-600/10 rounded-lg transition-colors"
                    title="编辑工具"
                  >
                    <Edit size={18} />
                  </button>
                  {!tool.isBuiltin && isAdmin && (
                    <button
                      onClick={(e) => handleDelete(tool.id, tool.displayName, e)}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-600/10 rounded-lg transition-colors"
                      title="删除工具"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
