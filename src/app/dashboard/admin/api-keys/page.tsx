'use client';

import { useState, useEffect } from 'react';
import { Plus, Search, Trash2, Key, Copy, Check } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { apiGet, apiDelete } from '@/lib/api-client';
import { safeClipboardWrite } from '@/lib/clipboard';
import CreateApiKeyModal from './CreateApiKeyModal';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  rateLimitInterval: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  tenant?: {
    id: string;
    name: string;
  } | null;
}

interface NewlyCreatedKey {
  id: string;
  key: string;
  name: string;
  keyPrefix: string;
}

export default function ApiKeysPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<NewlyCreatedKey | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    try {
      setLoading(true);
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const { data, error: apiError } = await apiGet<{ apiKeys: ApiKey[] }>(`/api/api-keys${params}`);
      if (apiError) {
        setAlert({ type: 'error', message: apiError });
        return;
      }
      setApiKeys(data?.apiKeys || []);
    } catch (err) {
      setAlert({ type: 'error', message: '加载 API Key 列表失败' });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadApiKeys();
  };

  const handleRevoke = async (id: string, name: string) => {
    if (!window.confirm(`确定要撤销 API Key "${name}" 吗？此操作不可撤销。`)) return;

    try {
      const { error: apiError } = await apiDelete(`/api/api-keys/${id}`);
      if (apiError) {
        setAlert({ type: 'error', message: apiError });
        return;
      }
      setAlert({ type: 'success', message: 'API Key 已撤销' });
      loadApiKeys();
    } catch (err: any) {
      setAlert({ type: 'error', message: err.message || '撤销失败' });
    }
  };

  const handleCreateSuccess = (newKey: NewlyCreatedKey) => {
    setNewlyCreatedKey(newKey);
    setShowCreateModal(false);
    loadApiKeys();
  };

  const handleCopyKey = async () => {
    if (newlyCreatedKey) {
      await safeClipboardWrite(newlyCreatedKey.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDismissNewKey = () => {
    setNewlyCreatedKey(null);
    setCopied(false);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const filteredApiKeys = apiKeys.filter(key =>
    key.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <Key size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">API Key 管理</h1>
            <p className="text-sm text-gray-400 mt-0.5">管理外部调用 API 的访问密钥</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="group flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 bg-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400"
        >
          <Plus size={18} className="transition-transform group-hover:rotate-90 duration-200" />
          创建 API Key
        </button>
      </div>

      {/* 提示信息 */}
      {alert && (
        <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>
          {alert.message}
        </Alert>
      )}

      {/* 新创建的 Key 显示 */}
      {newlyCreatedKey && (
        <div className="bg-green-900/20 border border-green-800/40 rounded-lg p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Key size={20} className="text-green-400" />
                <h3 className="text-lg font-semibold text-green-300">API Key 创建成功</h3>
              </div>
              <p className="text-sm text-green-400 mb-4">此 Key 仅显示一次，请立即保存</p>
              <div className="bg-dark-bg rounded-lg p-4 font-mono text-sm text-gray-100 break-all border border-green-700/30">
                {newlyCreatedKey.key}
              </div>
              <div className="mt-3 flex items-center gap-4 text-sm text-gray-400">
                <span>名称: {newlyCreatedKey.name}</span>
                <span>前缀: {newlyCreatedKey.keyPrefix}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleCopyKey}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
                {copied ? '已复制' : '复制'}
              </button>
              <button
                onClick={handleDismissNewKey}
                className="px-4 py-2 text-gray-400 hover:text-gray-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 搜索 + 表格 */}
      <div className="bg-dark-surface rounded-lg shadow-sm overflow-hidden border border-gray-700/50">
        {/* 搜索栏 */}
        <div className="px-5 py-4 border-b border-gray-700/50">
          <div className="flex gap-3 w-full sm:max-w-md">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="搜索 API Key 名称..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(searchInput); loadApiKeys(); } }}
                className="w-full pl-10 pr-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-primary-500 text-gray-100 placeholder-gray-500 text-sm"
              />
            </div>
            <button onClick={() => { setSearch(searchInput); loadApiKeys(); }} className="px-4 py-2.5 bg-primary-500 text-white rounded-lg font-medium text-sm shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400 transition-all">
              搜索
            </button>
            {search && (
              <button onClick={() => { setSearchInput(''); setSearch(''); loadApiKeys(); }} className="px-4 py-2.5 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm transition-colors">
                清除
              </button>
            )}
          </div>
        </div>

        {/* API Key 表格 */}
        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-700/50">
            <thead className="bg-dark-bg">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名称</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Key 前缀</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">限频间隔</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">租户</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">最后使用</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {filteredApiKeys.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    {search ? '未找到匹配的 API Key' : '暂无 API Key'}
                  </td>
                </tr>
              ) : (
                filteredApiKeys.map((apiKey) => (
                  <tr key={apiKey.id} className="hover:bg-dark-surface-hover">
                    <td className="px-6 py-4 font-medium text-gray-100">{apiKey.name}</td>
                    <td className="px-6 py-4 text-gray-500 font-mono text-sm">{apiKey.keyPrefix}...</td>
                    <td className="px-6 py-4 text-gray-500">{apiKey.rateLimitInterval} 分钟</td>
                    <td className="px-6 py-4 text-gray-500">{apiKey.tenant?.name || '-'}</td>
                    <td className="px-6 py-4 text-gray-500">{formatDate(apiKey.lastUsedAt)}</td>
                    <td className="px-6 py-4">
                      {apiKey.revokedAt ? (
                        <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">
                          已撤销
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">
                          有效
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500">{formatDate(apiKey.createdAt)}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleRevoke(apiKey.id, apiKey.name)}
                        disabled={!!apiKey.revokedAt}
                        className={`text-red-400 hover:text-red-300 ${
                          apiKey.revokedAt ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                        title={apiKey.revokedAt ? '已撤销' : '撤销'}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* 创建 Modal */}
      <CreateApiKeyModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}