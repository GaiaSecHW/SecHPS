'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Users,
  Plus,
  Edit,
  Trash2,
  Shield,
  Search,
  ChevronDown,
  UserPlus,
  ChevronLeft,
  ChevronRight,
  Key,
} from 'lucide-react';
import { PermissionGuard } from '@/components/PermissionGuard';
import { PERMISSIONS } from '@/types/permissions';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function UsersPage() {
  return (
    <PermissionGuard permission={PERMISSIONS.USER_READ}>
      <UsersPageContent />
    </PermissionGuard>
  );
}

function UsersPageContent() {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 10;

  useEffect(() => {
    fetchUsers();
    fetchRoles();
  }, [page]);

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users?page=${page}&limit=${pageSize}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '获取用户列表失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      setUsers(data.users || []);
      setTotalCount(data.pagination?.total || data.users?.length || 0);
      setLoading(false);
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/roles', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setRoles(data.roles || []);
      }
    } catch (err) {
      console.error('获取角色失败:', err);
    }
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    if (!confirm(`确定要删除用户 "${username}" 吗？此操作不可撤销。`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '删除用户失败');
        return;
      }

      await fetchUsers();
    } catch (err) {
      toast.error('网络错误，请重试');
    }
  };

  const handleOpenEditModal = (user: any) => {
    setSelectedUser(user);
    setShowEditModal(true);
  };

  const handleOpenRoleModal = (user: any) => {
    setSelectedUser(user);
    setShowRoleModal(true);
  };

  const handleOpenResetPasswordModal = (user: any) => {
    setSelectedUser(user);
    setShowResetPasswordModal(true);
  };

  const filteredUsers = users.filter(
    user =>
      user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (user.name && user.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

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
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <Users size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">用户管理</h1>
            <p className="text-sm text-gray-400 mt-0.5">管理平台用户及其权限</p>
          </div>
        </div>
        
        <button
          onClick={() => setShowCreateModal(true)}
          className="group flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 bg-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400"
        >
          <Plus size={18} className="transition-transform group-hover:rotate-90 duration-200" />
          创建用户
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Search + Table combined */}
      <div className="bg-dark-surface shadow-sm rounded-lg overflow-hidden border border-gray-700/50">
        {/* Filters section */}
        <div className="px-5 py-4 border-b border-gray-700/50">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="按姓名、邮箱或用户名搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-primary-500 text-gray-100 placeholder-gray-500 text-sm"
            />
          </div>
        </div>

        {/* Table section */}
        <table className="min-w-full divide-y divide-gray-700/50">
          <thead className="bg-[#162032]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                用户
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                邮箱
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                角色
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                租户
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                状态
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                创建时间
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="bg-dark-surface divide-y divide-gray-700/50">
            {filteredUsers.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-12 text-center text-sm text-gray-500"
                >
                  未找到用户
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  onEdit={() => handleOpenEditModal(user)}
                  onDelete={() => handleDeleteUser(user.id, user.username)}
                  onAssignRoles={() => handleOpenRoleModal(user)}
                  onResetPassword={() => handleOpenResetPasswordModal(user)}
                />
              ))
            )}
          </tbody>
        </table>
        {/* 分页 */}
        {totalCount > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700/50">
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
      </div>

      {/* 创建用户模态框 */}
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchUsers();
          }}
          roles={roles}
        />
      )}

      {/* 编辑用户模态框 */}
      {showEditModal && selectedUser && (
        <EditUserModal
          user={selectedUser}
          onClose={() => {
            setShowEditModal(false);
            setSelectedUser(null);
          }}
          onSuccess={() => {
            setShowEditModal(false);
            setSelectedUser(null);
            fetchUsers();
          }}
          roles={roles}
        />
      )}

      {/* 分配角色模态框 */}
      {showRoleModal && selectedUser && (
        <AssignRolesModal
          user={selectedUser}
          onClose={() => {
            setShowRoleModal(false);
            setSelectedUser(null);
          }}
          onSuccess={() => {
            setShowRoleModal(false);
            setSelectedUser(null);
            fetchUsers();
          }}
          roles={roles}
        />
      )}

      {/* 重置密码模态框 */}
      {showResetPasswordModal && selectedUser && (
        <ResetPasswordModal
          user={selectedUser}
          onClose={() => {
            setShowResetPasswordModal(false);
            setSelectedUser(null);
          }}
          onSuccess={() => {
            setShowResetPasswordModal(false);
            setSelectedUser(null);
          }}
        />
      )}
    </div>
  );
}

function UserRow({
  user,
  onEdit,
  onDelete,
  onAssignRoles,
  onResetPassword,
}: {
  user: any;
  onEdit: () => void;
  onDelete: () => void;
  onAssignRoles: () => void;
  onResetPassword: () => void;
}) {
  return (
    <tr className="hover:bg-dark-surface-hover">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center">
          <div className="flex-shrink-0 h-10 w-10">
            {user.avatar ? (
              <img
                className="h-10 w-10 rounded-full"
                src={user.avatar}
                alt={user.name || user.username}
              />
            ) : (
              <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center">
                <span className="text-white font-medium">
                  {(user.name || user.username).charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <div className="ml-4">
            <div className="text-sm font-medium text-gray-100">
              {user.name || user.username}
            </div>
            <div className="text-sm text-gray-500">@{user.username}</div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {user.email}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex flex-wrap gap-1">
          {user.roles && user.roles.length > 0 ? (
            user.roles.map((role: any) => (
              <span
                key={role.id}
                className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20"
              >
                <Shield size={12} className="mr-1" />
                {role.name}
              </span>
            ))
          ) : (
            <span className="text-sm text-gray-500">未分配角色</span>
          )}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
        {user.tenantName || '-'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span
          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
            user.isActive
              ? 'bg-green-500/15 text-green-400 border border-green-500/20'
              : 'bg-red-500/15 text-red-400 border border-red-500/20'
          }`}
        >
          {user.isActive ? '激活' : '禁用'}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {new Date(user.createdAt).toLocaleDateString('zh-CN')}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <div className="flex items-center justify-end space-x-2">
          <button
            onClick={onAssignRoles}
            className="text-blue-400 hover:text-blue-900"
            title="分配角色"
          >
            <UserPlus size={16} />
          </button>
          <button
            onClick={onResetPassword}
            className="text-orange-400 hover:text-orange-900"
            title="重置密码"
          >
            <Key size={16} />
          </button>
          <button
            onClick={onEdit}
            className="text-gray-400 hover:text-gray-400"
            title="编辑用户"
          >
            <Edit size={16} />
          </button>
          <button
            onClick={onDelete}
            className="text-red-400 hover:text-red-400"
            title="删除用户"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function CreateUserModal({
  onClose,
  onSuccess,
  roles,
}: {
  onClose: () => void;
  onSuccess: (initialPassword: string) => void;
  roles: any[];
}) {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/admin/tenants', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setTenants(data.tenants || []);
        }
      } catch {}
    };
    fetchTenants();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username,
          name,
          roles: selectedRoles,
          tenantId: selectedTenantId || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        if (response.status === 401) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          document.cookie = 'auth-token=; path=/; max-age=0';
          window.location.href = '/login';
          return;
        }
        setError(data.error || data.details?.error || '创建用户失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      toast.success(`用户创建成功，初始密码：${data.initialPassword}`, { duration: 10000 });
      onSuccess(data.initialPassword);
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-dark-surface rounded-lg shadow-xl max-w-2xl w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-100">创建用户</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-400 text-2xl">×</button>
        </div>

        <form className="p-6 space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-900/20 border border-red-200 text-red-400 px-4 py-3 rounded">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300">用户名 <span className="text-red-400">*</span></label>
            <input type="text" required value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" placeholder="请输入用户名" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300">姓名</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" placeholder="请输入姓名" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">角色</label>
            <div className="grid grid-cols-2 gap-2">
              {roles.filter((r: any) => r.name !== 'admin').map((role: any) => (
                <label key={role.id} className="flex items-center space-x-2 px-3 py-2 border border-gray-600 rounded-md cursor-pointer hover:bg-dark-surface-hover">
                  <input type="checkbox" checked={selectedRoles.includes(role.id)} onChange={() => {
                    setSelectedRoles(prev => prev.includes(role.id) ? prev.filter(id => id !== role.id) : [...prev, role.id]);
                  }} className="rounded border-gray-600 text-blue-400 focus:ring-primary-500" />
                  <span className="text-sm">{role.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300">所属租户 <span className="text-red-400">*</span></label>
            <select value={selectedTenantId} onChange={(e) => setSelectedTenantId(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 bg-dark-bg text-gray-100">
              <option value="">请选择租户</option>
              {tenants.map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}{t.isIcsTenant ? ' (ICSL)' : ''}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A] disabled:opacity-50">取消</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50">{loading ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onSuccess,
}: {
  user: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword: 'huawei@123', mustChangePassword: true }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '重置密码失败');
        setLoading(false);
        return;
      }

      toast.success(`用户 ${user.username} 的密码已重置为 huawei@123，用户下次登录需自行修改密码`);
      onSuccess();
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-dark-surface rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-100">
            重置密码 - {user.name || user.username}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-400 text-2xl">
            ×
          </button>
        </div>

        <form className="p-6 space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-900/20 border border-red-200 text-red-400 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="bg-yellow-900/20 border border-yellow-500/30 text-yellow-400 px-4 py-3 rounded text-sm">
            将用户 <strong>{user.username}</strong> 的密码重置为默认密码 <code className="bg-yellow-900/40 px-1.5 py-0.5 rounded text-yellow-300">huawei@123</code>，用户下次登录后必须自行修改密码。
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A] disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50"
            >
              {loading ? '重置中...' : '确认重置'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({
  user,
  onClose,
  onSuccess,
  roles,
}: {
  user: any;
  onClose: () => void;
  onSuccess: () => void;
  roles: any[];
}) {
  const [name, setName] = useState(user.name || '');
  const [avatar, setAvatar] = useState(user.avatar || '');
  const [isActive, setIsActive] = useState(user.isActive);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          avatar,
          isActive,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '更新用户失败');
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
      <div className="bg-dark-surface rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-100">编辑用户</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-400 text-2xl">
            ×
          </button>
        </div>

        <form className="p-6 space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-900/20 border border-red-200 text-red-400 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-300"
            >
              姓名
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="请输入姓名"
            />
          </div>

          <div>
            <label
              htmlFor="avatar"
              className="block text-sm font-medium text-gray-300"
            >
              头像链接
            </label>
            <input
              id="avatar"
              type="url"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="https://example.com/avatar.png"
            />
          </div>

          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-gray-600 text-blue-400 focus:ring-primary-500"
              />
              <span className="text-sm font-medium text-gray-300">激活状态</span>
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A] disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
            >
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignRolesModal({
  user,
  onClose,
  onSuccess,
  roles,
}: {
  user: any;
  onClose: () => void;
  onSuccess: () => void;
  roles: any[];
}) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(
    user.roles?.map((r: any) => r.id) || []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users/${user.id}/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          roleIds: selectedRoles,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '分配角色失败');
        setLoading(false);
        return;
      }

      onSuccess();
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const toggleRole = (roleId: string) => {
    setSelectedRoles(prev =>
      prev.includes(roleId) ?
        prev.filter(id => id !== roleId)
      : [...prev, roleId]
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-dark-surface rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-100">
            分配角色 - {user.name || user.username}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-400 text-2xl">
            ×
          </button>
        </div>

        <form className="p-6 space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-900/20 border border-red-200 text-red-400 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              选择角色
            </label>
            <div className="space-y-2">
              {roles.map((role: any) => (
                <label
                  key={role.id}
                  className="flex items-center space-x-2 px-3 py-2 border border-gray-600 rounded-md cursor-pointer hover:bg-dark-surface-hover"
                >
                  <input
                    type="checkbox"
                    checked={selectedRoles.includes(role.id)}
                    onChange={() => toggleRole(role.id)}
                    className="rounded border-gray-600 text-blue-400 focus:ring-primary-500"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-100">
                      {role.name}
                    </div>
                    {role.description && (
                      <div className="text-xs text-gray-500">
                        {role.description}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A] disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
            >
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
