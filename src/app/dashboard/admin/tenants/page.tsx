'use client';

import { useState, useEffect } from 'react';
import { Plus, Search, Users, Edit, Trash2, RefreshCw } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Alert, ErrorAlert } from '@/components/ui/Alert';
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
            className="px-4 py-2 text-sm font-medium text-dark-text-secondary bg-dark-surface border border-dark-border rounded-lg hover:bg-dark-surface-hover"
          >
            取消
          </button>
          <button
            type="submit"
            form="tenant-form"
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? '保存中...' : '保存'}
          </button>
        </>
      }
    >
      <form id="tenant-form" onSubmit={handleSubmit} className="space-y-4 p-6">
        {error && <ErrorAlert>{error}</ErrorAlert>}

        <div>
          <label className="block text-sm font-medium text-dark-text-secondary mb-1">租户名称 <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-2 border border-dark-border rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="请输入租户名称"
          />
        </div>

        {!tenant && (
          <div>
            <label className="block text-sm font-medium text-dark-text-secondary mb-1">Slug <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              pattern="[a-z0-9-]+"
              className="w-full px-3 py-2 border border-dark-border rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="用于 URL，只能包含小写字母、数字和连字符"
            />
            <p className="mt-1 text-sm text-dark-text-muted">用于 URL，只能包含小写字母、数字和连字符</p>
          </div>
        )}

        <div className="flex items-center">
          <input
            type="checkbox"
            id="isIcsTenant"
            checked={isIcsTenant}
            onChange={(e) => setIsIcsTenant(e.target.checked)}
            className="h-4 w-4 text-indigo-500 border-dark-border rounded focus:ring-indigo-500"
          />
          <label htmlFor="isIcsTenant" className="ml-2 text-sm text-dark-text-secondary">
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
        <div className="border border-dark-border/40 rounded-lg p-4 bg-dark-bg">
          <h4 className="text-sm font-medium text-dark-text-secondary mb-3">添加用户到租户</h4>

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
              className="w-full px-3 py-2 border border-dark-border rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            />
            {searching && (
              <div className="absolute right-3 top-2">
                <LoadingSpinner size="sm" />
              </div>
            )}

            {/* 搜索结果下拉 */}
            {searchResults.length > 0 && !selectedUser && (
              <div className="absolute z-10 w-full mt-1 bg-dark-surface border border-dark-border/40 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {searchResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => {
                      setSelectedUser(user);
                      setSearchQuery(user.username);
                      setSearchResults([]);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-dark-surface-hover flex items-center gap-2"
                  >
                    <span className="font-medium">{user.username}</span>
                    <span className="text-dark-text-muted">({user.email})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 选中用户确认 */}
          {selectedUser && (
            <div className="mt-3 flex items-center justify-between bg-indigo-900/20 rounded-lg p-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white font-medium">
                  {selectedUser.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-dark-text">{selectedUser.username}</p>
                  <p className="text-sm text-dark-text-muted">{selectedUser.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedUser(null);
                    setSearchQuery('');
                  }}
                  className="text-dark-text-muted hover:text-dark-text-secondary"
                >
                  取消
                </button>
                <button
                  onClick={handleAddUser}
                  disabled={addingLoading}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50"
                >
                  {addingLoading ? '添加中...' : '确认添加'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 用户列表 */}
        <div>
          <h4 className="text-sm font-medium text-dark-text-secondary mb-3">
            租户用户 ({users.length})
          </h4>
          {loading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="border border-dark-border/40 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-dark-border/40">
                <thead className="bg-dark-surface-hover/50">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-dark-text-muted">用户</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-dark-text-muted">邮箱</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-dark-text-muted w-[100px]">状态</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-dark-text-muted">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-border/40">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-dark-text-muted">
                        暂无用户
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id} className="hover:bg-dark-surface-hover">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-dark-surface-hover rounded-full flex items-center justify-center text-xs font-medium">
                              {user.username.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium">{user.username}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-sm text-dark-text-muted">{user.email}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-1 rounded text-xs whitespace-nowrap ${user.isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                            {user.isActive ? '活跃' : '禁用'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => handleRemoveUser(user)}
                            className="text-red-400 hover:text-red-300 text-sm"
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
    <div className="space-y-6">
      {/* 提示信息 */}
      {alert && (
        <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>
          {alert.message}
        </Alert>
      )}

      {/* Search + Actions + Table combined */}
      <div className="bg-dark-surface rounded-lg shadow-sm overflow-hidden border border-dark-border/40">
        {/* Toolbar: search + actions */}
        <div className="px-5 py-4 border-b border-dark-border/40 flex items-center justify-between gap-4">
          <form onSubmit={handleSearch} className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-text-muted" size={18} />
            <input
              type="text"
              placeholder="搜索租户..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 bg-dark-bg border border-dark-border rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-dark-text placeholder-dark-text-muted text-sm"
            />
          </form>
          <div className="flex items-center gap-2">
            <button
              onClick={loadTenants}
              className="p-2.5 rounded-lg border border-dark-border text-dark-text-muted hover:bg-dark-surface-hover hover:text-dark-text-secondary transition-colors"
              title="刷新"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors bg-indigo-600 text-white hover:bg-indigo-500"
            >
              <Plus size={16} />
              创建租户
            </button>
          </div>
        </div>

        {/* Table section */}
        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <table className="min-w-full divide-y divide-dark-border/40">
            <thead className="bg-dark-surface-hover/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-dark-text-muted uppercase tracking-wider">租户名称</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-dark-text-muted uppercase tracking-wider">Slug</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-dark-text-muted uppercase tracking-wider">类型</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-dark-text-muted uppercase tracking-wider">用户数</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-dark-text-muted uppercase tracking-wider">创建时间</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-dark-text-muted uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-border/40">
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-dark-text-muted">
                    未找到租户
                  </td>
                </tr>
              ) : (
                tenants.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-dark-surface-hover">
                    <td className="px-6 py-4 font-medium text-dark-text">{tenant.name}</td>
                    <td className="px-6 py-4 text-dark-text-muted">{tenant.slug}</td>
                    <td className="px-6 py-4">
                      {tenant.isIcsTenant ? (
                        <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium">ICSL</span>
                      ) : (
                        <span className="px-2 py-1 bg-dark-surface-hover text-dark-text rounded text-xs font-medium">普通</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-dark-text-muted">{tenant.userCount}</td>
                    <td className="px-6 py-4 text-dark-text-muted">{new Date(tenant.createdAt).toLocaleDateString('zh-CN')}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-3">
                        <button
                          onClick={() => setUserModal({ id: tenant.id, name: tenant.name })}
                          className="text-indigo-400 hover:text-indigo-300"
                          title="管理用户"
                        >
                          <Users size={16} />
                        </button>
                        <button
                          onClick={() => openEditModal(tenant)}
                          className="text-dark-text-muted hover:text-dark-text-secondary"
                          title="编辑"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(tenant)}
                          className="text-red-400 hover:text-red-300"
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
        )}
      </div>

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
