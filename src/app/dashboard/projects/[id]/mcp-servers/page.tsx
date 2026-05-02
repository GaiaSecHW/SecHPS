'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Server,
  Edit,
  Trash2,
  Power,
  PowerOff,
  Loader2,
} from 'lucide-react';

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
  createdAt: string;
  updatedAt: string;
}

export default function McpServersPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);

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
  });

  const fetchServers = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${projectId}/mcp-servers`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取 MCP 服务器列表失败');
      }

      const data = await response.json();
      setServers(data.mcpServers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, [projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const token = localStorage.getItem('token');
      const url = editingServer
        ? `/api/projects/${projectId}/mcp-servers/${editingServer.id}`
        : `/api/projects/${projectId}/mcp-servers`;

      const method = editingServer ? 'PUT' : 'POST';

      const body: any = {
        name: formData.name,
        type: formData.type,
        isEnabled: formData.isEnabled,
        autoStart: formData.autoStart,
      };

      if (formData.type === 'local') {
        body.command = formData.command;
        if (formData.args) {
          try {
            body.args = JSON.parse(formData.args);
          } catch {
            body.args = formData.args.split(' ');
          }
        }
        if (formData.env && formData.env !== '{}') {
          try {
            body.env = JSON.parse(formData.env);
          } catch {
            // 忽略解析错误
          }
        }
      } else {
        body.url = formData.url;
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
        throw new Error(data.error || '保存失败');
      }

      setShowForm(false);
      setEditingServer(null);
      resetForm();
      fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  const handleDelete = async (serverId: string) => {
    if (!confirm('确定要删除此 MCP 服务器配置吗？')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/projects/${projectId}/mcp-servers/${serverId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('删除失败');
      }

      fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
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
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回项目列表
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">MCP 服务器配置</h1>
          <p className="text-sm text-gray-500 mt-1">
            管理 Model Context Protocol 服务器配置
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setEditingServer(null);
            setShowForm(true);
          }}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          添加服务器
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
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
                      type: e.target.value as 'local' | 'sse' | 'http',
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="local">本地服务器 (stdio)</option>
                  <option value="sse">远程 SSE (旧版)</option>
                  <option value="http">远程 Streamable HTTP</option>
                </select>
            </div>

            {formData.type === 'local' ? (
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
                    placeholder="例如: npx @modelcontextprotocol/server-filesystem"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    参数 (JSON 数组或空格分隔)
                  </label>
                  <input
                    type="text"
                    value={formData.args}
                    onChange={(e) =>
                      setFormData({ ...formData, args: e.target.value })
                    }
                    placeholder='例如: ["/path/to/project"] 或 /path/to/project'
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    环境变量 (JSON 对象)
                  </label>
                  <textarea
                    value={formData.env}
                    onChange={(e) =>
                      setFormData({ ...formData, env: e.target.value })
                    }
                    placeholder='例如: {"API_KEY": "xxx"}'
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  URL {formData.type === 'sse' ? '(SSE 端点)' : '(MCP 端点)'} *
                </label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) =>
                    setFormData({ ...formData, url: e.target.value })
                  }
                  placeholder={formData.type === 'sse' ? "例如: http://localhost:8080/sse" : "例如: http://localhost:8080/mcp"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
            )}

            <div className="flex items-center space-x-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.isEnabled}
                  onChange={(e) =>
                    setFormData({ ...formData, isEnabled: e.target.checked })
                  }
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
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
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700">自动启动</span>
              </label>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingServer(null);
                  resetForm();
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {editingServer ? '更新' : '创建'}
              </button>
            </div>
          </form>
        </div>
      )}

      {servers.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <Server className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 mb-4">暂无 MCP 服务器配置</p>
          <button
            onClick={() => setShowForm(true)}
            className="text-blue-600 hover:text-blue-700"
          >
            添加第一个服务器
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
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
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {servers.map((server) => (
                <tr key={server.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Server className="w-5 h-5 text-gray-400 mr-2" />
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
                          : 'bg-purple-100 text-purple-800'
                      }`}
                    >
                      {server.type === 'local' ? '本地' : '远程'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-500 max-w-xs truncate">
                      {server.type === 'local'
                        ? server.command
                        : server.url}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      {server.isEnabled ? (
                        <span className="inline-flex items-center text-green-600">
                          <Power className="w-4 h-4 mr-1" />
                          启用
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-gray-400">
                          <PowerOff className="w-4 h-4 mr-1" />
                          禁用
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleEdit(server)}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(server.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
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
  );
}
