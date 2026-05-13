'use client';

import { useState, useEffect } from 'react';
import { Plus, Search, Users, Edit, Trash2, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Alert, ErrorAlert, SuccessAlert } from '@/components/ui/Alert';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  isIcsTenant: boolean;
  userCount: number;
  createdAt: string;
}

interface TenantModalProps {
  tenant?: Tenant | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function TenantFormModal({ tenant, isOpen, onClose, onSuccess }: TenantModalProps) {
  const [name, setName] = useState(tenant?.name || '');
  const [slug, setSlug] = useState(tenant?.slug || '');
  const [isIcsTenant, setIsIcsTenant] = useState(tenant?.isIcsTenant || false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (tenant) {
      setName(tenant.name);
      setSlug(tenant.slug);
      setIsIcsTenant(tenant.isIcsTenant);
    } else {
      setName('');
      setSlug('');
      setIsIcsTenant(false);
    }
    setError('');
  }, [tenant, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (tenant) {
        const { data, error: apiError } = await apiPatch<Tenant>(`/api/admin/tenants/${tenant.id}`, {
          name,
          isIcsTenant,
        });
        if (apiError) {
          setError(apiError);
          return;
        }
      } else {
        const { data, error: apiError } = await apiPost<Tenant>('/api/admin/tenants', {
          name,
          slug,
          isIcsTenant,
        });
        if (apiError) {
          setError(apiError);
          return;
        }
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tenant ? '编辑租户' : '创建租户'}
      size="md"
      showFooter
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-300 bg-dark-surface border border-gray-600 rounded-md hover:bg-dark-surface-hover"
          >
            取消
          </button>
          <button
            type="submit"
            form="tenant-form"
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '保存中...' : '保存'}
          </button>
        </>
      }
    >
      <form id="tenant-form" onSubmit={handleSubmit} className="space-y-4 p-6">
        {error && <ErrorAlert>{error}</ErrorAlert>}

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">租户名称 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="请输入租户名称"
          />
        </div>

        {!tenant && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Slug *</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              pattern="[a-z0-9-]+"
              className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="用于 URL，只能包含小写字母、数字和连字符"
            />
            <p className="mt-1 text-sm text-gray-500">用于 URL，只能包含小写字母、数字和连字符</p>
          </div>
        )}

        <div className="flex items-center">
          <input
            type="checkbox"
            id="isIcsTenant"
            checked={isIcsTenant}
            onChange={(e) => setIsIcsTenant(e.target.checked)}
            className="h-4 w-4 text-blue-400 border-gray-600 rounded focus:ring-primary-500"
          />
          <label htmlFor="isIcsTenant" className="ml-2 text-sm text-gray-300">
            ICSL 租户（拥有所有权限）
          </label>
        </div>
      </form>
    </Modal>
  );
}

interface TenantUserModalProps {
  tenantId: string;
  tenantName: string;
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

interface SearchableUser {
  id: string;
  username: string;
  email: string;
  name: string;
}

function TenantUserModal({ tenantId, tenantName, isOpen, onClose, onRefresh }: TenantUserModalProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 用户搜索相关状态
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchableUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SearchableUser | null>(null);
  const [addingLoading, setAddingLoading] = useState(false);

  // 搜索可用用户（不在当前租户的用户）
  const searchAvailableUsers = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const { data, error: apiError } = await apiGet<{ users: SearchableUser[] }>(
        `/api/users?search=${encodeURIComponent(query)}`
      );
      if (apiError) {
        setError(apiError);
        return;
      }
      // 过滤掉已在当前租户的用户
      const tenantUserIds = users.map(u => u.id);
      const available = (data?.users || []).filter(
        (u: SearchableUser) => !tenantUserIds.includes(u.id)
      );
      setSearchResults(available);
    } catch (err) {
      setError('搜索用户失败');
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (isOpen && tenantId) {
      loadUsers();
    }
  }, [isOpen, tenantId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchAvailableUsers(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const { data, error: apiError } = await apiGet<{ users: any[] }>(`/api/admin/tenants/${tenantId}/users`);
      if (apiError) {
        setError(apiError);
        return;
      }
      setUsers(data?.users || []);
    } catch (err) {
      setError('加载用户失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async () => {
    if (!selectedUser) return;
    setAddingLoading(true);
    setError('');
    setSuccess('');
    try {
      const { error: apiError } = await apiPost(`/api/admin/tenants/${tenantId}/users`, { userId: selectedUser.id });
      if (apiError) {
        setError(apiError);
        return;
      }
      setSuccess(`用户 "${selectedUser.username}" 已添加`);
      setSelectedUser(null);
      setSearchQuery('');
      setSearchResults([]);
      loadUsers();
      onRefresh();
    } catch (err: any) {
      setError(err.message || '添加用户失败');
    } finally {
      setAddingLoading(false);
    }
  };

  const handleRemoveUser = async (user: any) => {
    if (!confirm(`确定要将用户 "${user.username}" 从 "${tenantName}" 租户移除吗？`)) return;

    setError('');
    setSuccess('');
    try {
      const { error: apiError } = await apiDelete(`/api/admin/tenants/${tenantId}/users?userId=${user.id}`);
      if (apiError) {
        setError(apiError);
        return;
      }
      setSuccess(`用户 "${user.username}" 已从租户移除`);
      loadUsers();
      onRefresh();
    } catch (err: any) {
      setError(err.message || '移除用户失败');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${tenantName} - 用户管理`}
      size="lg"
    >
      <div className="p-6 space-y-4">
        {error && (
          <Alert type="error" dismissible onDismiss={() => setError('')}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert type="success" dismissible onDismiss={() => setSuccess('')}>
            {success}
          </Alert>
        )}

        {/* 添加用户区域 */}
        <div className="border border-gray-700/50 rounded-lg p-4 bg-[#0F172A]">
          <h4 className="text-sm font-medium text-gray-300 mb-3">添加用户到租户</h4>

          {/* 用户搜索 */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedUser(null);
              }}
              placeholder="搜索用户名或邮箱..."
              className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {searching && (
              <div className="absolute right-3 top-2">
                <LoadingSpinner size="sm" />
              </div>
            )}

            {/* 搜索结果下拉 */}
            {searchResults.length > 0 && !selectedUser && (
              <div className="absolute z-10 w-full mt-1 bg-dark-surface border border-gray-700/50 rounded-md shadow-lg max-h-48 overflow-y-auto">
                {searchResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => {
                      setSelectedUser(user);
                      setSearchQuery(user.username);
                      setSearchResults([]);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-blue-900/20 flex items-center gap-2"
                  >
                    <span className="font-medium">{user.username}</span>
                    <span className="text-gray-400">({user.email})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 选中用户确认 */}
          {selectedUser && (
            <div className="mt-3 flex items-center justify-between bg-blue-900/20 rounded-lg p-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-medium">
                  {selectedUser.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-gray-100">{selectedUser.username}</p>
                  <p className="text-sm text-gray-500">{selectedUser.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedUser(null);
                    setSearchQuery('');
                  }}
                  className="text-gray-400 hover:text-gray-400"
                >
                  取消
                </button>
                <button
                  onClick={handleAddUser}
                  disabled={addingLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {addingLoading ? '添加中...' : '确认添加'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 用户列表 */}
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">
            租户用户 ({users.length})
          </h4>
          {loading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="border border-gray-700/50 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-700/50">
                <thead className="bg-[#0F172A]">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">用户</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">邮箱</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">状态</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        暂无用户
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id} className="hover:bg-dark-surface-hover">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center text-xs font-medium">
                              {user.username.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium">{user.username}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">{user.email}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-1 rounded text-xs ${user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {user.isActive ? '活跃' : '禁用'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => handleRemoveUser(user)}
                            className="text-red-400 hover:text-red-800 text-sm"
                          >
                            移除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTenant, setEditTenant] = useState<Tenant | null>(null);
  const [userModal, setUserModal] = useState<{ id: string; name: string } | null>(null);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    loadTenants();
  }, []);

  const loadTenants = async () => {
    try {
      setLoading(true);
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const { data, error: apiError } = await apiGet<{ tenants: Tenant[] }>(`/api/admin/tenants${params}`);
      if (apiError) {
        setAlert({ type: 'error', message: apiError });
        return;
      }
      setTenants(data?.tenants || []);
    } catch (err) {
      setAlert({ type: 'error', message: '加载租户列表失败' });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadTenants();
  };

  const handleDelete = async (tenant: Tenant) => {
    if (!confirm(`确定要删除租户 "${tenant.name}" 吗？此操作不可撤销。`)) return;

    try {
      const { error: apiError } = await apiDelete(`/api/admin/tenants/${tenant.id}`);
      if (apiError) {
        setAlert({ type: 'error', message: apiError });
        return;
      }
      setAlert({ type: 'success', message: '租户已删除' });
      loadTenants();
    } catch (err: any) {
      setAlert({ type: 'error', message: err.message || '删除失败' });
    }
  };

  const handleSuccess = () => {
    setAlert({ type: 'success', message: editTenant ? '租户已更新' : '租户已创建' });
    loadTenants();
  };

  const openCreateModal = () => {
    setEditTenant(null);
    setShowModal(true);
  };

  const openEditModal = (tenant: Tenant) => {
    setEditTenant(tenant);
    setShowModal(true);
  };

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题和操作 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">租户管理</h1>
          <p className="mt-1 text-sm text-gray-400">
            管理平台租户及其用户
            <span className="ml-2 text-xs text-blue-400">（平台管理员可访问所有数据；ICSL租户可访问所有数据+创建公共资源；普通租户只能访问本租户数据+公共资源）</span>
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus size={20} />
          <span>创建租户</span>
        </button>
      </div>

      {/* 提示信息 */}
      {alert && (
        <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>
          {alert.message}
        </Alert>
      )}

      {/* 搜索栏 */}
      <form onSubmit={handleSearch} className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="text"
          placeholder="搜索租户..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </form>

      {/* 租户表格 */}
      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="bg-dark-surface rounded-lg shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-700/50">
            <thead className="bg-[#0F172A]">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">租户名称</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Slug</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">类型</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用户数</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    未找到租户
                  </td>
                </tr>
              ) : (
                tenants.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-dark-surface-hover">
                    <td className="px-6 py-4 font-medium text-gray-100">{tenant.name}</td>
                    <td className="px-6 py-4 text-gray-500">{tenant.slug}</td>
                    <td className="px-6 py-4">
                      {tenant.isIcsTenant ? (
                        <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium">ICSL</span>
                      ) : (
                        <span className="px-2 py-1 bg-dark-surface-hover text-gray-200 rounded text-xs font-medium">普通</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500">{tenant.userCount}</td>
                    <td className="px-6 py-4 text-gray-500">{new Date(tenant.createdAt).toLocaleDateString('zh-CN')}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-3">
                        <button
                          onClick={() => setUserModal({ id: tenant.id, name: tenant.name })}
                          className="text-blue-400 hover:text-blue-800"
                          title="管理用户"
                        >
                          <Users size={16} />
                        </button>
                        <button
                          onClick={() => openEditModal(tenant)}
                          className="text-gray-400 hover:text-gray-400"
                          title="编辑"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(tenant)}
                          className="text-red-400 hover:text-red-400"
                          title="删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 模态框 */}
      <TenantFormModal
        tenant={editTenant}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={handleSuccess}
      />

      {userModal && (
        <TenantUserModal
          tenantId={userModal.id}
          tenantName={userModal.name}
          isOpen={true}
          onClose={() => setUserModal(null)}
          onRefresh={loadTenants}
        />
      )}
    </div>
  );
}
