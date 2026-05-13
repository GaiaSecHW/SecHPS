'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Server,
  Edit,
  Trash2,
  Power,
  PowerOff,
  Loader2,
  CheckCircle,
  XCircle,
  TestTube,
  ChevronLeft,
  ChevronRight,
  Search,
  Share2,
  Lock,
  User,
  Filter,
} from 'lucide-react';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';
import { DeveloperGuard } from '@/components/PermissionGuard';

interface McpServerUser {
  id: string;
  username?: string;
  name?: string;
}

interface McpServer {
  id: string;
  name: string;
  type: 'local' | 'sse' | 'http';
  command?: string;
  args?: string;
  url?: string;
  env?: string;
  isEnabled: boolean;
  autoStart: boolean;
  isPublic: boolean;
  userId: string;
  user?: McpServerUser;
  createdAt: string;
  updatedAt: string;
}

export default function McpServersPage() {
  return (
    <DeveloperGuard>
      <McpServersContent />
    </DeveloperGuard>
  );
}

function McpServersContent() {
  const router = useRouter();

  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    serverId: string;
    success: boolean;
    message: string;
    tools?: Array<{ name: string; description?: string }>;
    toolCount?: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 10;
  const [isIcsOrAdmin, setIsIcsOrAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [filter, setFilter] = useState<'all' | 'mine' | 'shared'>('all');  // 默认显示自己的+共享的

  // 表单状态
  const [formData, setFormData] = useState({
    name: '',
    type: 'local' as 'local' | 'sse' | 'http',
    command: '',
    args: '',
    url: '',
    env: '{}',
    isEnabled: true,
    autoStart: false,
    isPublic: false,
  });

  // 初始化：检查用户权限
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsIcsOrAdmin(payload.isIcsTenant === true || (Array.isArray(payload.roles) && payload.roles.includes('admin')));
        setCurrentUserId(payload.userId || '');
      } catch (e) {
        console.error('解析 token 失败:', e);
      }
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [page, searchQuery, filter]);

  const fetchServers = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        filter: filter,  // 添加过滤参数
      });
      if (searchQuery) params.append('search', searchQuery);
      
      const response = await fetch(`/api/mcp-servers?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取 MCP 服务器列表失败');
      }

      const data = await response.json();
      setServers(data.mcpServers || data.servers || []);
      setTotalCount(data.pagination?.total || (data.mcpServers || data.servers || []).length);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const token = localStorage.getItem('token');
      const url = editingServer
        ? `/api/mcp-servers/${editingServer.id}`
        : '/api/mcp-servers';

      const method = editingServer ? 'PATCH' : 'POST';

      const body: any = {
        name: formData.name,
        type: formData.type,
        isEnabled: formData.isEnabled,
        autoStart: formData.autoStart,
      };

      if (formData.type === 'local') {
        body.command = formData.command;
        if (formData.args.trim()) {
          try {
            body.args = JSON.parse(formData.args);
          } catch {
            setError('参数必须是有效的 JSON 数组');
            return;
          }
        }
      } else if (formData.type === 'sse' || formData.type === 'http') {
        body.url = formData.url;
      }

      if (formData.env.trim() && formData.env !== '{}') {
        try {
          body.env = JSON.parse(formData.env);
        } catch {
          setError('环境变量必须是有效的 JSON 对象');
          return;
        }
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '操作失败');
      }

      setShowForm(false);
      setEditingServer(null);
      resetForm();
      fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleEdit = (server: McpServer) => {
    setEditingServer(server);
    setFormData({
      name: server.name,
      type: server.type,
      command: server.command || '',
      args: server.args || '',
      url: server.url || '',
      env: server.env || '{}',
      isEnabled: server.isEnabled,
      autoStart: server.autoStart,
      isPublic: server.isPublic || false,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此 MCP 服务器配置吗？')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/mcp-servers/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }

      fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleToggle = async (server: McpServer) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/mcp-servers/${server.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isEnabled: !server.isEnabled }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '切换状态失败');
      }

      fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换状态失败');
    }
  };

  // 切换共享状态（仅管理员可用）
  const handleToggleShared = async (server: McpServer) => {
    if (!isIcsOrAdmin) {
      setError('只有管理员可以设置共享状态');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/mcp-servers/${server.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isPublic: !server.isPublic }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '切换共享状态失败');
      }

      fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换共享状态失败');
    }
  };

  // 检查是否可以编辑/删除（管理员可管理所有，普通用户只能管理自己的）
  const canManage = (server: McpServer) => {
    return isIcsOrAdmin || server.userId === currentUserId;
  };

  const handleTest = async (server: McpServer) => {
    setTestingServer(server.id);
    setTestResult(null);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/mcp-servers/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: server.id,  // 添加服务器 ID，用于保存工具列表到数据库
          name: server.name,
          type: server.type,
          command: server.command,
          args: server.args ? JSON.parse(server.args) : undefined,
          url: server.url,
          env: server.env ? JSON.parse(server.env) : undefined,
        }),
      });

      const data = await response.json();

      setTestResult({
        serverId: server.id,
        success: data.success || data.connected,
        message: data.message || data.error || '测试完成',
        tools: data.tools || [],
      });
    } catch (err) {
      setTestResult({
        serverId: server.id,
        success: false,
        message: err instanceof Error ? err.message : '测试失败',
      });
    } finally {
      setTestingServer(null);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'local',
      command: '',
      args: '',
      url: '',
      env: '{}',
      isEnabled: true,
      autoStart: false,
      isPublic: false,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Server className="h-8 w-8 text-purple-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-100">
              MCP 服务器配置
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              管理 MCP 服务器，普通用户可创建私有 MCP，管理员可创建共享 MCP
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            resetForm();
            setEditingServer(null);
            setShowForm(true);
          }}
          className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
        >
          <Plus size={20} />
          <span>添加 MCP 服务器</span>
        </button>
      </div>

      {/* Search and Filter */}
      <div className="mb-4 flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="搜索 MCP 服务器名称..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-600 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>
        {/* 过滤按钮 */}
        <div className="flex gap-2">
          <button
            onClick={() => { setFilter('all'); setPage(1); }}
            className={`px-3 py-2 text-sm rounded-md transition-colors ${
              filter === 'all' ? 'bg-purple-600 text-white' : 'bg-dark-surface-hover text-gray-300 hover:bg-gray-200'
            }`}
          >
            全部
          </button>
          <button
            onClick={() => { setFilter('mine'); setPage(1); }}
            className={`px-3 py-2 text-sm rounded-md transition-colors ${
              filter === 'mine' ? 'bg-purple-600 text-white' : 'bg-dark-surface-hover text-gray-300 hover:bg-gray-200'
            }`}
          >
            <User size={14} className="inline mr-1" />
            我的
          </button>
          <button
            onClick={() => { setFilter('shared'); setPage(1); }}
            className={`px-3 py-2 text-sm rounded-md transition-colors ${
              filter === 'shared' ? 'bg-purple-600 text-white' : 'bg-dark-surface-hover text-gray-300 hover:bg-gray-200'
            }`}
          >
            <Share2 size={14} className="inline mr-1" />
            共享
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded">
          {error}
        </div>
      )}

        {/* MCP Servers List */}
        {servers.length === 0 ? (
          <div className="text-center py-12 bg-dark-surface rounded-lg border border-gray-700/50">
            <Server className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">暂无 MCP 服务器配置</p>
            <button
              onClick={() => setShowForm(true)}
              className="text-purple-600 hover:text-purple-700"
            >
              添加第一个 MCP 服务器
            </button>
          </div>
        ) : (
          <div className="bg-dark-surface rounded-lg border border-gray-700/50 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-700/50">
              <thead className="bg-[#162032]">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    名称
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    类型
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    配置
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    共享
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    自动启动
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-dark-surface divide-y divide-gray-700/50">
                {servers.map((server) => (
                  <tr key={server.id} className="hover:bg-[#0F172A]">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Server className="h-5 w-5 text-gray-400 mr-2" />
                        <div>
                          <span className="text-sm font-medium text-gray-100">
                            {server.name}
                          </span>
                          {server.user && server.userId !== currentUserId && (
                            <span className="text-xs text-gray-400 ml-2">
                              ({server.user.username || server.user.name || '其他用户'})
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          server.type === 'local'
                            ? 'bg-blue-500/15 text-blue-400'
                            : 'bg-green-500/15 text-green-400'
                        }`}
                      >
                        {server.type === 'local' ? '本地' : '远程'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {server.type === 'local' ? (
                        <div className="max-w-xs truncate">
                          {server.command}
                          {server.args && (
                            <div className="text-xs text-gray-400">
                              参数: {server.args}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="max-w-xs truncate">{server.url}</div>
                      )}
                    </td>
                    {/* 共享状态 */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {server.isPublic ? (
                        <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-purple-500/15 text-purple-400">
                          <Share2 size={12} className="mr-1" />
                          共享
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-dark-surface-hover text-gray-400">
                          <Lock size={12} className="mr-1" />
                          私有
                        </span>
                      )}
                    </td>
                    {/* 启用状态 */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => handleToggle(server)}
                        className={`flex items-center space-x-1 ${
                          server.isEnabled
                            ? 'text-green-400 hover:text-green-400'
                            : 'text-gray-400 hover:text-gray-400'
                        }`}
                      >
                        {server.isEnabled ? (
                          <>
                            <Power size={16} />
                            <span className="text-sm">启用</span>
                          </>
                        ) : (
                          <>
                            <PowerOff size={16} />
                            <span className="text-sm">禁用</span>
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {server.autoStart ? '是' : '否'}
                    </td>
                    {/* 操作按钮 */}
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      {/* 共享按钮 - 仅管理员可操作 */}
                      {isIcsOrAdmin && (
                        <button
                          onClick={() => handleToggleShared(server)}
                          className={`mr-3 ${
                            server.isPublic
                              ? 'text-purple-600 hover:text-purple-700'
                              : 'text-gray-400 hover:text-purple-600'
                          }`}
                          title={server.isPublic ? '取消共享' : '设置为共享'}
                        >
                          <Share2 size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => handleTest(server)}
                        disabled={testingServer === server.id}
                        className="text-purple-600 hover:text-purple-700 mr-3 disabled:opacity-50"
                        title="测试连接"
                      >
                        {testingServer === server.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <TestTube size={16} />
                        )}
                      </button>
                      {/* 编辑/删除按钮 - 仅可管理的 MCP */}
                      {canManage(server) && (
                        <>
                          <button
                            onClick={() => handleEdit(server)}
                            className="text-blue-400 hover:text-blue-400 mr-3"
                            title="编辑"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(server.id)}
                            className="text-red-400 hover:text-red-400"
                            title="删除"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 分页 */}
        {totalCount > pageSize && (
          <div className="flex items-center justify-between mt-4 px-4 py-3 bg-dark-surface rounded-lg border border-gray-700/50">
            <span className="text-sm text-gray-400">
              共 {totalCount} 条，第 {page}/{Math.ceil(totalCount / pageSize)} 页
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 border border-gray-600 rounded-lg hover:bg-[#0F172A] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-gray-400">第 {page} 页</span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= Math.ceil(totalCount / pageSize)}
                className="p-2 border border-gray-600 rounded-lg hover:bg-[#0F172A] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Test Result */}
        {testResult && (
          <div className={`mt-4 p-4 rounded-lg ${
            testResult.success 
              ? 'bg-green-900/20 border border-green-800/40' 
              : 'bg-red-900/20 border border-red-800/40'
          }`}>
            <div className="flex items-start">
              {testResult.success ? (
                <CheckCircle className="h-5 w-5 text-green-400 mt-0.5 mr-3" />
              ) : (
                <XCircle className="h-5 w-5 text-red-400 mt-0.5 mr-3" />
              )}
              <div className="flex-1">
                <h4 className={`text-sm font-medium ${
                  testResult.success ? 'text-green-800' : 'text-red-800'
                }`}>
                  {testResult.success ? '测试成功' : '测试失败'}
                </h4>
                <p className={`text-sm mt-1 ${
                  testResult.success ? 'text-green-400' : 'text-red-400'
                }`}>
                  {testResult.message}
                </p>
                {testResult.tools && testResult.tools.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-medium text-gray-300 mb-2">
                      可用工具 ({testResult.tools.length}):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {testResult.tools.map((tool, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-400"
                          title={tool.description || '无描述'}
                        >
                          {tool.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setTestResult(null)}
                className="text-gray-400 hover:text-gray-400 ml-4"
              >
                <XCircle size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Add/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-dark-surface rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-100 mb-4">
                  {editingServer ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      服务器名称 *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="例如: filesystem, database, cloudbugs4ai"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      类型 *
                    </label>
                    <select
                      value={formData.type}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFormData({
                          ...formData,
                          type: v as 'local' | 'sse' | 'http',
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="local">本地 (Local/stdio)</option>
                      <option value="sse">远程 SSE (旧版)</option>
                      <option value="http">远程 Streamable HTTP</option>
                    </select>
                  </div>

                  {formData.type === 'local' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          命令 *
                        </label>
                        <input
                          type="text"
                          value={formData.command}
                          onChange={(e) =>
                            setFormData({ ...formData, command: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                          placeholder="例如: npx @modelcontextprotocol/server-filesystem"
                          required={formData.type === 'local'}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          参数 (JSON 数组)
                        </label>
                        <textarea
                          value={formData.args}
                          onChange={(e) =>
                            setFormData({ ...formData, args: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                          rows={3}
                          placeholder='["/path/to/project"]'
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          JSON 数组格式，例如: ["/path/to/project"]
                        </p>
                      </div>
                    </>
                  )}

                  {(formData.type === 'sse' || formData.type === 'http') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        URL {formData.type === 'sse' ? '(SSE 端点)' : '(MCP 端点)'} *
                      </label>
                      <input
                        type="url"
                        value={formData.url}
                        onChange={(e) =>
                          setFormData({ ...formData, url: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder={formData.type === 'sse' ? "http://localhost:9999/sse" : "http://localhost:9999/mcp"}
                        required={formData.type === 'sse' || formData.type === 'http'}
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      环境变量 (JSON 对象)
                    </label>
                    <textarea
                      value={formData.env}
                      onChange={(e) =>
                        setFormData({ ...formData, env: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                      rows={3}
                      placeholder='{"API_KEY": "your-key"}'
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      JSON 对象格式，例如: {"{"}"API_KEY": "your-key"{"}"}
                    </p>
                  </div>

                  <div className="flex items-center space-x-4">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={formData.isEnabled}
                        onChange={(e) =>
                          setFormData({ ...formData, isEnabled: e.target.checked })
                        }
                        className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-600 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-300">启用</span>
                    </label>

                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={formData.autoStart}
                        onChange={(e) =>
                          setFormData({ ...formData, autoStart: e.target.checked })
                        }
                        className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-600 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-300">自动启动</span>
                    </label>
                  </div>

                  <div className="flex justify-end space-x-3 pt-4 border-t">
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setEditingServer(null);
                        resetForm();
                      }}
                      className="px-4 py-2 text-gray-300 bg-dark-surface-hover rounded-md hover:bg-gray-700 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
                    >
                      {editingServer ? '保存' : '添加'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
