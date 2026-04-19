'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Shield,
  Plus,
  Edit,
  Trash2,
  Check,
  X,
  ChevronDown,
  Settings,
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';
import { PermissionGuard } from '@/components/PermissionGuard';
import { PERMISSIONS } from '@/types/permissions';

export default function RolesPage() {
  return (
    <PermissionGuard permission={PERMISSIONS.ROLE_READ}>
      <RolesPageContent />
    </PermissionGuard>
  );
}

function RolesPageContent() {
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [showCreatePermissionModal, setShowCreatePermissionModal] = useState(false);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 10;

  useEffect(() => {
    fetchRoles();
    fetchPermissions();
  }, [page, searchQuery]);

  const fetchRoles = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      if (searchQuery) params.append('search', searchQuery);
      
      const response = await fetch(`/api/roles?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '获取角色失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      setRoles(data.roles || []);
      setTotalCount(data.pagination?.total || data.roles?.length || 0);
      setLoading(false);
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const fetchPermissions = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/permissions', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPermissions(data.permissions || []);
      }
    } catch (err) {
      console.error('获取权限失败:', err);
    }
  };

  const handleDeleteRole = async (roleId: string, roleName: string) => {
    if (!confirm(`确定要删除角色 "${roleName}" 吗？`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/roles/${roleId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '删除角色失败');
        return;
      }

      await fetchRoles();
    } catch (err) {
      toast.error('网络错误，请重试');
    }
  };

  const getRolePermissions = (roleId: string) => {
    const role = roles.find(r => r.id === roleId);
    return role?.permissions?.map((p: any) => p.name) || [];
  };

  const getPermissionCount = (roleId: string) => {
    return getRolePermissions(roleId).length;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题和操作 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">角色与权限</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理系统角色及其权限
          </p>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={() => setShowCreateRoleModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Plus size={20} />
            <span>创建角色</span>
          </button>
          <button
            onClick={() => setShowCreatePermissionModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            <Settings size={20} />
            <span>创建权限</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* 角色列表 */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-900">角色</h2>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="搜索角色..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent w-48"
              />
            </div>
          </div>
        </div>

        {roles.length === 0 ? (
          <div className="text-center py-12">
            <Shield className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-sm text-gray-600">未找到角色</p>
          </div>
        ) : (
           <div className="divide-y divide-gray-200">
            {roles.map((role) => (
              <RoleCard
                key={role.id}
                role={role}
                permissionCount={getPermissionCount(role.id)}
                onEdit={() => {
                  setSelectedRole(role);
                  setShowEditRoleModal(true);
                }}
                onDelete={() => handleDeleteRole(role.id, role.name)}
              />
            ))}
          </div>
        )}
        {/* 分页 */}
        {totalCount > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
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
      </div>

      {/* 权限列表 */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden mt-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">权限</h2>
        </div>

        {permissions.length === 0 ? (
          <div className="text-center py-12">
            <Settings className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-sm text-gray-600">未找到权限</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {permissions.map((permission) => (
              <PermissionCard key={permission.id} permission={permission} />
            ))}
          </div>
        )}
      </div>

      {/* 创建角色模态框 */}
      {showCreateRoleModal && (
        <CreateRoleModal
          onClose={() => setShowCreateRoleModal(false)}
          onSuccess={() => {
            setShowCreateRoleModal(false);
            fetchRoles();
          }}
          permissions={permissions}
        />
      )}

      {/* 编辑角色模态框 */}
      {showEditRoleModal && selectedRole && (
        <EditRoleModal
          role={selectedRole}
          onClose={() => {
            setShowEditRoleModal(false);
            setSelectedRole(null);
          }}
          onSuccess={() => {
            setShowEditRoleModal(false);
            setSelectedRole(null);
            fetchRoles();
          }}
          permissions={permissions}
        />
      )}

      {/* 创建权限模态框 */}
      {showCreatePermissionModal && (
        <CreatePermissionModal
          onClose={() => setShowCreatePermissionModal(false)}
          onSuccess={() => {
            setShowCreatePermissionModal(false);
            fetchPermissions();
          }}
        />
      )}
    </div>
  );
}

function RoleCard({
  role,
  permissionCount,
  onEdit,
  onDelete,
}: {
  role: any;
  permissionCount: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showAllPermissions, setShowAllPermissions] = useState(false);

  return (
    <div className="px-6 py-4 hover:bg-gray-50">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2">
            <h3 className="text-lg font-semibold text-gray-900">
              {role.name}
            </h3>
            {role.isSystem && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                系统
              </span>
            )}
          </div>

          {role.description && (
            <p className="mt-1 text-sm text-gray-600">
              {role.description}
            </p>
          )}

          <div className="mt-2 flex items-center space-x-4">
            <div className="flex items-center space-x-1">
              <Shield size={16} className="text-gray-400" />
              <span className="text-sm text-gray-600">
                {permissionCount} 个权限
              </span>
            </div>

            {role.permissions && role.permissions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(showAllPermissions ? role.permissions : role.permissions.slice(0, 5)).map((permission: any) => (
                  <span
                    key={permission.id}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
                  >
                    {permission.name}
                  </span>
                ))}
                {role.permissions.length > 5 && (
                  <button
                    onClick={() => setShowAllPermissions(!showAllPermissions)}
                    className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer"
                  >
                    {showAllPermissions ? '收起' : `+${role.permissions.length - 5} 更多`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {!role.isSystem && (
          <div className="flex space-x-2">
            <button
              onClick={onEdit}
              className="p-2 text-gray-400 hover:text-gray-600"
              title="编辑角色"
            >
              <Edit size={16} />
            </button>
            <button
              onClick={onDelete}
              className="p-2 text-gray-400 hover:text-red-600"
              title="删除角色"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionCard({ permission }: { permission: any }) {
  return (
    <div className="px-6 py-4 hover:bg-gray-50">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2">
            <h3 className="text-lg font-semibold text-gray-900">
              {permission.name}
            </h3>
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              {permission.module}
            </span>
          </div>

          {permission.description && (
            <p className="mt-1 text-sm text-gray-600">
              {permission.description}
            </p>
          )}

          <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
            <div>
              <span className="font-medium">操作:</span> {permission.action}
            </div>
            {permission.resource && (
              <div>
                <span className="font-medium">资源:</span> {permission.resource}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateRoleModal({
  onClose,
  onSuccess,
  permissions,
}: {
  onClose: () => void;
  onSuccess: () => void;
  permissions: any[];
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/roles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          description,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '创建角色失败');
        setLoading(false);
        return;
      }

      onSuccess();
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const togglePermission = (permissionId: string) => {
    setSelectedPermissions(prev =>
      prev.includes(permissionId) ?
        prev.filter(id => id !== permissionId)
      : [...prev, permissionId]
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">创建角色</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <form className="p-6 space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700"
            >
              角色名称 *
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700"
            >
              描述
            </label>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              权限
            </label>
            <div className="max-h-64 overflow-y-auto border border-gray-300 rounded-md p-3">
              <div className="grid grid-cols-1 gap-2">
                {permissions.map((permission: any) => (
                  <label
                    key={permission.id}
                    className="flex items-start space-x-2 px-3 py-2 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPermissions.includes(permission.id)}
                      onChange={() => togglePermission(permission.id)}
                      className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">
                        {permission.name}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {permission.module}:{permission.action}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? '创建中...' : '创建角色'}
            </button>
          </div>
        </form>
      </div>
    </div>
);
}

function EditRoleModal({
  role,
  onClose,
  onSuccess,
  permissions,
}: {
  role: any;
  onClose: () => void;
  onSuccess: () => void;
  permissions: any[];
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description || '');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(
    role.permissions?.map((p: any) => p.id) || []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/roles/${role.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          description,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '更新角色失败');
        setLoading(false);
        return;
      }

      // 更新权限关联需要额外的 API 调用
      // 这里简化处理，实际可能需要单独的权限分配 API
      onSuccess();
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const togglePermission = (permissionId: string) => {
    setSelectedPermissions(prev =>
      prev.includes(permissionId) ?
        prev.filter(id => id !== permissionId)
      : [...prev, permissionId]
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">编辑角色</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <form className="p-6 space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700"
            >
              角色名称 *
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700"
            >
              描述
            </label>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              权限
            </label>
            <div className="max-h-64 overflow-y-auto border border-gray-300 rounded-md p-3">
              <div className="grid grid-cols-1 gap-2">
                {permissions.map((permission: any) => (
                  <label
                    key={permission.id}
                    className="flex items-start space-x-2 px-3 py-2 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPermissions.includes(permission.id)}
                      onChange={() => togglePermission(permission.id)}
                      className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">
                        {permission.name}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {permission.module}:{permission.action}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? '更新中...' : '更新角色'}
            </button>
          </div>
        </form>
      </div>
    </div>
);
}

function CreatePermissionModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const modules = ['session', 'user', 'role', 'permission', 'config', 'search', 'file', 'audit'];
  const actions = ['create', 'read', 'update', 'delete', 'share', 'revert', 'assign_role', 'assign_permission'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/permissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          module,
          action,
          resource: resource || undefined,
          description,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '创建权限失败');
        setLoading(false);
        return;
      }

      onSuccess();
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">创建权限</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <form className="p-6 space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700"
            >
              权限名称 *
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="module"
              className="block text-sm font-medium text-gray-700"
            >
              模块 *
            </label>
            <select
              id="module"
              required
              value={module}
              onChange={(e) => setModule(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">选择模块</option>
              {modules.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="action"
              className="block text-sm font-medium text-gray-700"
            >
              操作 *
            </label>
            <select
              id="action"
              required
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">选择操作</option>
              {actions.map(a => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="resource"
              className="block text-sm font-medium text-gray-700"
            >
              资源（可选）
            </label>
            <input
              id="resource"
              type="text"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700"
            >
              描述
            </label>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
            >
              {loading ? '创建中...' : '创建权限'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
