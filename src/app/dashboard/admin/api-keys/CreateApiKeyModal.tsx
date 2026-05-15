'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { ErrorAlert } from '@/components/ui/Alert';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { apiGet, apiPost } from '@/lib/api-client';

interface Tenant {
  id: string;
  name: string;
}

interface AgentApp {
  id: string;
  name: string;
  tenantId: string | null;
  isPublic?: boolean;
}

interface CreateApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newKey: { id: string; key: string; name: string; keyPrefix: string }) => void;
}

interface CreateResponse {
  id: string;
  key: string;
  name: string;
  keyPrefix: string;
}

export default function CreateApiKeyModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateApiKeyModalProps) {
  const [name, setName] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [agentAppIds, setAgentAppIds] = useState<string[]>([]);
  const [rateLimitInterval, setRateLimitInterval] = useState(1);
  const [loading, setLoading] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [agents, setAgents] = useState<AgentApp[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [error, setError] = useState('');
  const [showKeyResult, setShowKeyResult] = useState(false);
  const [createdKey, setCreatedKey] = useState<{ id: string; key: string; name: string; keyPrefix: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // 加载租户列表
  useEffect(() => {
    if (isOpen) {
      loadTenants();
    }
  }, [isOpen]);

  // 当选中租户后，加载该租户的 Agent 列表
  useEffect(() => {
    if (tenantId) {
      loadAgents(tenantId);
      // 清空之前选中的 agents
      setAgentAppIds([]);
    } else {
      setAgents([]);
    }
  }, [tenantId]);

  const loadTenants = async () => {
    try {
      setLoadingTenants(true);
      setError('');
      const { data, error: apiError } = await apiGet<{ tenants: Tenant[] }>('/api/admin/tenants');
      if (apiError) {
        setError(apiError);
        return;
      }
      setTenants(data?.tenants || []);
    } catch (err) {
      setError('加载租户列表失败');
    } finally {
      setLoadingTenants(false);
    }
  };

  const loadAgents = async (selectedTenantId: string) => {
    try {
      setLoadingAgents(true);
      const { data, error: apiError } = await apiGet<{ apps: AgentApp[] }>('/api/agent-apps');
      if (apiError) {
        setError(apiError);
        return;
      }
      const filteredAgents = (data?.apps || []).filter(
        agent => agent.tenantId === selectedTenantId || (agent.isPublic && agent.tenantId === null)
      );
      setAgents(filteredAgents);
    } catch (err) {
      setError('加载 Agent 列表失败');
    } finally {
      setLoadingAgents(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!tenantId) {
      setError('请选择租户');
      return;
    }

    if (agentAppIds.length === 0) {
      setError('请至少选择一个 Agent');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data, error: apiError } = await apiPost<CreateResponse>('/api/api-keys', {
        name,
        tenantId,
        agentAppIds,
        rateLimitInterval,
      });

      if (apiError) {
        setError(apiError);
        return;
      }

      if (data) {
        setCreatedKey(data);
        setShowKeyResult(true);
      }
    } catch (err: any) {
      setError(err.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyKey = async () => {
    if (createdKey) {
      await navigator.clipboard.writeText(createdKey.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    // 只有在用户看到 key 后才允许关闭
    if (showKeyResult && createdKey) {
      onSuccess(createdKey);
    }
    // 重置状态
    setName('');
    setTenantId('');
    setAgentAppIds([]);
    setRateLimitInterval(1);
    setError('');
    setShowKeyResult(false);
    setCreatedKey(null);
    setCopied(false);
    onClose();
  };

  const handleAgentToggle = (agentId: string) => {
    setAgentAppIds(prev =>
      prev.includes(agentId)
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={showKeyResult ? 'API Key 创建成功' : '创建 API Key'}
      size="md"
      showCloseButton={false}
      showFooter
      footer={
        showKeyResult ? (
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            完成
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-300 bg-dark-surface border border-gray-600 rounded-md hover:bg-dark-surface-hover"
            >
              取消
            </button>
            <button
              type="submit"
              form="create-api-key-form"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '创建中...' : '创建'}
            </button>
          </>
        )
      }
    >
      <div className="p-6">
        {showKeyResult && createdKey ? (
          <div className="space-y-4">
            <ErrorAlert>
              此 Key 仅显示一次，请立即复制保存
            </ErrorAlert>

            <div className="bg-[#0F172A] rounded-lg p-4 border border-green-700/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">API Key</span>
                <button
                  onClick={handleCopyKey}
                  className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <div className="font-mono text-sm text-gray-100 break-all">
                {createdKey.key}
              </div>
            </div>

            <div className="text-sm text-gray-400 space-y-1">
              <div>名称: {createdKey.name}</div>
              <div>前缀: {createdKey.keyPrefix}</div>
            </div>
          </div>
        ) : (
          <>
            {error && <ErrorAlert>{error}</ErrorAlert>}

            <form id="create-api-key-form" onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  名称 *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="请输入 API Key 名称"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  租户
                </label>
                {loadingTenants ? (
                  <div className="flex items-center gap-2 text-gray-400">
                    <LoadingSpinner size="sm" />
                    <span className="text-sm">加载租户列表...</span>
                  </div>
                ) : (
                  <select
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-[#1E293B]"
                  >
                    <option value="">请选择租户</option>
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                )}
                <p className="mt-1 text-sm text-gray-500">
                  请选择此 Key 所属的租户
                </p>
              </div>

              {tenantId && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Agent
                  </label>
                  {loadingAgents ? (
                    <div className="flex items-center gap-2 text-gray-400">
                      <LoadingSpinner size="sm" />
                      <span className="text-sm">加载 Agent 列表...</span>
                    </div>
                  ) : agents.length === 0 ? (
                    <p className="text-sm text-gray-500">该租户暂无 Agent</p>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-600 rounded-md p-3">
                      {agents.map((agent) => (
                        <label
                          key={agent.id}
                          className="flex items-center space-x-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={agentAppIds.includes(agent.id)}
                            onChange={() => handleAgentToggle(agent.id)}
                            className="h-4 w-4 text-blue-400 border-gray-600 rounded focus:ring-primary-500"
                          />
                          <span className="text-sm text-gray-300">{agent.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 text-sm text-gray-500">
                    可选，限制此 Key 只能用于选定的 Agent。不选则可用于该租户所有 Agent。
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  限频间隔（分钟）
                </label>
                <input
                  type="number"
                  value={rateLimitInterval}
                  onChange={(e) => setRateLimitInterval(parseInt(e.target.value) || 1)}
                  min="1"
                  required
                  className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="mt-1 text-sm text-gray-500">
                  每个 Key 在此间隔内最多调用一次
                </p>
              </div>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}

// Import Check and Copy icons
import { Check, Copy } from 'lucide-react';
