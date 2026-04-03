'use client';

import { useEffect, useState } from 'react';
import {
  Cog,
  Plus,
  Search,
  Edit,
  Trash2,
  Play,
  Power,
} from 'lucide-react';

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

const categoryLabels: Record<string, string> = {
  'file': '文件操作',
  'code': '代码分析',
  'security': '安全检测',
  'network': '网络请求',
  'system': '系统命令',
};

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [user, setUser] = useState<{ roles?: string[] } | null>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
    fetchTools();
  }, []);

  const fetchTools = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/tools', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取工具列表失败');
      }

      const data = await response.json();
      setTools(data.tools || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const filteredTools = tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tool.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isAdmin = user?.roles?.includes('admin');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">工具管理</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理 Skills 可使用的工具，共 {tools.length} 个工具
          </p>
        </div>
        {isAdmin && (
          <button
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={20} className="mr-2" />
            创建工具
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="搜索工具..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Tools List */}
      <div className="space-y-4">
        {filteredTools.length === 0 ? (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
            <div className="text-center">
              <Cog className="mx-auto h-16 w-16 text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">暂无工具</h3>
              <p className="mt-2 text-sm text-gray-600">
                工具库为空，请添加工具
              </p>
            </div>
          </div>
        ) : (
          filteredTools.map((tool) => (
            <div
              key={tool.id}
              className="bg-white rounded-lg shadow border border-gray-200 p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <div className={`p-2 rounded-lg ${tool.isActive ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <Cog className={tool.isActive ? 'text-green-600' : 'text-gray-400'} size={20} />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="font-semibold text-gray-900">{tool.displayName}</h3>
                        {tool.isBuiltin && (
                          <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded-full">
                            内置
                          </span>
                        )}
                        {tool.requiresPermission && (
                          <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">
                            需要权限
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{tool.name}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-gray-600">{tool.description}</p>
                  <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                    <span>{categoryLabels[tool.category] || tool.category}</span>
                    <span>执行器: {tool.executor}</span>
                    <span>超时: {tool.timeout}ms</span>
                  </div>
                </div>
                {!tool.isActive && (
                  <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                    已禁用
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
