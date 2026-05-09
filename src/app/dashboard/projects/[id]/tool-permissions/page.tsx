'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Shield,
  Edit,
  Trash2,
  Check,
  X,
  AlertCircle,
  Loader2,
} from 'lucide-react';

interface ToolPermission {
  id: string;
  toolPattern: string;
  permission: 'allow' | 'deny' | 'ask';
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export default function ToolPermissionsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [permissions, setPermissions] = useState<ToolPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingPermission, setEditingPermission] = useState<ToolPermission | null>(null);

  // 表单状态
  const [formData, setFormData] = useState({
    toolPattern: '',
    permission: 'ask' as 'allow' | 'deny' | 'ask',
    description: '',
  });

  const fetchPermissions = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${projectId}/tool-permissions`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取工具权限列表失败');
      }

      const data = await response.json();
      setPermissions(data.permissions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPermissions();
  }, [projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const token = localStorage.getItem('token');
      const url = editingPermission
        ? `/api/projects/${projectId}/tool-permissions/${editingPermission.id}`
        : `/api/projects/${projectId}/tool-permissions`;

      const method = editingPermission ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '保存失败');
      }

      setShowForm(false);
      setEditingPermission(null);
      resetForm();
      fetchPermissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  const handleDelete = async (permissionId: string) => {
    if (!confirm('确定要删除此权限规则吗？')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/projects/${projectId}/tool-permissions/${permissionId}`,
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

      fetchPermissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleEdit = (permission: ToolPermission) => {
    setEditingPermission(permission);
    setFormData({
      toolPattern: permission.toolPattern,
      permission: permission.permission,
      description: permission.description || '',
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      toolPattern: '',
      permission: 'ask',
      description: '',
    });
  };

  const getPermissionBadge = (permission: 'allow' | 'deny' | 'ask') => {
    switch (permission) {
      case 'allow':
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
            <Check className="w-3 h-3 mr-1" />
            允许
          </span>
        );
      case 'deny':
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
            <X className="w-3 h-3 mr-1" />
            拒绝
          </span>
        );
      case 'ask':
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
            <AlertCircle className="w-3 h-3 mr-1" />
            询问
          </span>
        );
    }
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
          <h1 className="text-2xl font-bold text-gray-900">工具权限管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            配置工具调用权限规则（允许、拒绝或询问）
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setEditingPermission(null);
            setShowForm(true);
          }}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          添加规则
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
            {editingPermission ? '编辑权限规则' : '添加权限规则'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                工具模式 *
              </label>
              <input
                type="text"
                value={formData.toolPattern}
                onChange={(e) =>
                  setFormData({ ...formData, toolPattern: e.target.value })
                }
                placeholder="例如: Bash(npm:*) 或 Read"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                支持精确匹配（如 Read）或模式匹配（如 Bash(npm:*)）
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                权限 *
              </label>
              <select
                value={formData.permission}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    permission: e.target.value as 'allow' | 'deny' | 'ask',
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="allow">允许 - 自动执行</option>
                <option value="deny">拒绝 - 禁止执行</option>
                <option value="ask">询问 - 需要用户确认</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                描述
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="可选：规则描述"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingPermission(null);
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
                {editingPermission ? '更新' : '创建'}
              </button>
            </div>
          </form>
        </div>
      )}

      {permissions.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <Shield className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 mb-4">暂无工具权限规则</p>
          <button
            onClick={() => setShowForm(true)}
            className="text-blue-600 hover:text-blue-700"
          >
            添加第一条规则
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  工具模式
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  权限
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  描述
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {permissions.map((permission) => (
                <tr key={permission.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Shield className="w-5 h-5 text-gray-400 mr-2" />
                      <code className="text-sm font-mono text-gray-900 bg-gray-100 px-2 py-1 rounded">
                        {permission.toolPattern}
                      </code>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getPermissionBadge(permission.permission)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-500 max-w-xs truncate">
                      {permission.description || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleEdit(permission)}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(permission.id)}
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
