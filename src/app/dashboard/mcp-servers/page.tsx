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
} from 'lucide-react';

interface McpServer {
  id: string;
  name: string;
  type: 'local' | 'remote';
  command?: string;
  args?: string;
  url?: string;
  env?: string;
  isEnabled: boolean;
  autoStart: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function McpServersPage() {
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
    tools?: string[];
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 10;

  // 表单状态
  const [formData, setFormData] = useState({
    name: '',
    type: 'local' as 'local' | 'remote',
    command: '',
    args: '',
    url: '',
    env: '{}',
    isEnabled: true,
    autoStart: false,
  });

  useEffect(() => {
    fetchServers();
  }, [page, searchQuery]);

  const fetchServers = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
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
      } else if (formData.type === 'remote') {
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
            <h1 className="text-2xl font-bold text-gray-900">
              MCP 服务器配置
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              全局 MCP 服务器配置，所有项目评估都会使用
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

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="搜索 MCP 服务器名称..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

        {/* MCP Servers List */}
        {servers.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
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
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
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
              <tbody className="bg-white divide-y divide-gray-200">
                {servers.map((server) => (
                  <tr key={server.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Server className="h-5 w-5 text-gray-400 mr-2" />
                        <span className="text-sm font-medium text-gray-900">
                          {server.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          server.type === 'local'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-green-100 text-green-800'
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
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => handleToggle(server)}
                        className={`flex items-center space-x-1 ${
                          server.isEnabled
                            ? 'text-green-600 hover:text-green-700'
                            : 'text-gray-400 hover:text-gray-600'
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
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
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
                      <button
                        onClick={() => handleEdit(server)}
                        className="text-blue-600 hover:text-blue-700 mr-3"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(server.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

        {/* Test Result */}
        {testResult && (
          <div className={`mt-4 p-4 rounded-lg ${
            testResult.success 
              ? 'bg-green-50 border border-green-200' 
              : 'bg-red-50 border border-red-200'
          }`}>
            <div className="flex items-start">
              {testResult.success ? (
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 mr-3" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600 mt-0.5 mr-3" />
              )}
              <div className="flex-1">
                <h4 className={`text-sm font-medium ${
                  testResult.success ? 'text-green-800' : 'text-red-800'
                }`}>
                  {testResult.success ? '测试成功' : '测试失败'}
                </h4>
                <p className={`text-sm mt-1 ${
                  testResult.success ? 'text-green-700' : 'text-red-700'
                }`}>
                  {testResult.message}
                </p>
                {testResult.tools && testResult.tools.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      可用工具 ({testResult.tools.length}):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {testResult.tools.map((tool, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setTestResult(null)}
                className="text-gray-400 hover:text-gray-600 ml-4"
              >
                <XCircle size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Add/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">
                  {editingServer ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      服务器名称 *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="例如: filesystem, database, cloudbugs4ai"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      类型 *
                    </label>
                    <select
                      value={formData.type}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          type: e.target.value as 'local' | 'remote',
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="local">本地 (Local)</option>
                      <option value="remote">远程 (Remote/SSE)</option>
                    </select>
                  </div>

                  {formData.type === 'local' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          命令 *
                        </label>
                        <input
                          type="text"
                          value={formData.command}
                          onChange={(e) =>
                            setFormData({ ...formData, command: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                          placeholder="例如: npx @modelcontextprotocol/server-filesystem"
                          required={formData.type === 'local'}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          参数 (JSON 数组)
                        </label>
                        <textarea
                          value={formData.args}
                          onChange={(e) =>
                            setFormData({ ...formData, args: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                          rows={3}
                          placeholder='["/path/to/project"]'
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          JSON 数组格式，例如: ["/path/to/project"]
                        </p>
                      </div>
                    </>
                  )}

                  {formData.type === 'remote' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        URL (SSE 端点) *
                      </label>
                      <input
                        type="url"
                        value={formData.url}
                        onChange={(e) =>
                          setFormData({ ...formData, url: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="http://localhost:9999/sse"
                        required={formData.type === 'remote'}
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      环境变量 (JSON 对象)
                    </label>
                    <textarea
                      value={formData.env}
                      onChange={(e) =>
                        setFormData({ ...formData, env: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
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
                        className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-700">启用</span>
                    </label>

                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={formData.autoStart}
                        onChange={(e) =>
                          setFormData({ ...formData, autoStart: e.target.checked })
                        }
                        className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-700">自动启动</span>
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
                      className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
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
