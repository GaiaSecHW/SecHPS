'use client';

import { useState, useEffect } from 'react';
import { Plus, Search, Trash2, Key, Copy, Check, BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { apiGet, apiDelete } from '@/lib/api-client';
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

// --- API Doc types (mirroring CodeSwarm) ---
interface ApiParam {
  name: string;
  type: string;
  required?: boolean;
  desc: string;
}

interface ApiEndpoint {
  method: string;
  path: string;
  desc: string;
  requestParams?: ApiParam[];
  requestBody?: ApiParam[];
  response?: ApiParam[];
}

// --- ApiDocCard (same style as CodeSwarm) ---
function ApiDocCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center space-x-3 p-4 bg-[#0F172A] hover:bg-dark-surface-hover transition-colors"
      >
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
          endpoint.method === 'GET' ? 'bg-green-500/15 text-green-400' :
          endpoint.method === 'POST' ? 'bg-blue-500/15 text-blue-400' :
          endpoint.method === 'PATCH' ? 'bg-yellow-500/15 text-yellow-400' :
          'bg-red-500/15 text-red-400'
        }`}>
          {endpoint.method}
        </span>
        <code className="text-sm text-gray-200 font-mono flex-1 text-left">{endpoint.path}</code>
        <span className="text-sm text-gray-500">{endpoint.desc}</span>
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4 border-t">
          {endpoint.requestParams && endpoint.requestParams.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">URL 参数</h5>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1">参数</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">必填</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {endpoint.requestParams.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-400">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.type}</td>
                      <td className="py-2">{p.required ? <span className="text-red-500">是</span> : <span className="text-gray-400">否</span>}</td>
                      <td className="py-2">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {endpoint.requestBody && endpoint.requestBody.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">请求体 (JSON)</h5>
              <pre className="bg-gray-900 text-cyan-400 p-3 rounded text-xs overflow-x-auto border border-gray-700">
{JSON.stringify(
  endpoint.requestBody.reduce((acc, p) => ({ ...acc, [p.name]: p.type }), {}),
  null, 2
)}
              </pre>
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1">字段</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">必填</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {endpoint.requestBody.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-400">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.type}</td>
                      <td className="py-2">{p.required ? <span className="text-red-500">是</span> : <span className="text-gray-400">否</span>}</td>
                      <td className="py-2">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {endpoint.response && endpoint.response.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">响应示例</h5>
              <pre className="bg-gray-900 text-cyan-400 p-3 rounded text-xs overflow-x-auto border border-gray-700">
{JSON.stringify(
  endpoint.response.reduce((acc, p) => ({ ...acc, [p.name]: p.type }), {}),
  null, 2
)}
              </pre>
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1">字段</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {endpoint.response.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-400">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.type}</td>
                      <td className="py-2">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- API docs data ---
const apiDocs = [
  {
    category: '认证方式',
    endpoints: [],
    description: '所有 API 请求需在 Header 中携带 API Key：\n\n```\nAuthorization: Bearer icsl-xxxxxxxxxxxxxxxx\n```\n\n认证失败返回 `401`，权限不足返回 `403`，限频返回 `429`。',
  },
  {
    category: 'Agent 查询',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/agents',
        desc: '获取可用的 Agent 列表',
        response: [
          { name: 'agents', type: 'Agent[]', desc: 'Agent 数组' },
        ],
      } as ApiEndpoint,
    ],
  },
  {
    category: '任务管理',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/tasks',
        desc: '创建任务',
        requestBody: [
          { name: 'agentId', type: 'string', required: true, desc: 'Agent ID' },
          { name: 'name', type: 'string', required: true, desc: '任务名称' },
          { name: 'notes', type: 'string', required: true, desc: '任务描述/指令' },
          { name: 'modelId', type: 'string', required: false, desc: '模型 ID' },
          { name: 'modelName', type: 'string', required: false, desc: '模型名称' },
          { name: 'parameters', type: 'object', required: false, desc: '额外参数 (JSON)' },
          { name: 'fileUrls', type: 'string[]', required: false, desc: '附件 URL 列表 (JSON 模式)' },
        ],
        response: [
          { name: 'taskId', type: 'string', desc: '任务 ID' },
          { name: 'status', type: 'string', desc: '初始状态 (pending)' },
          { name: 'createdAt', type: 'string', desc: '创建时间' },
        ],
      },
      {
        method: 'GET',
        path: '/api/v1/tasks',
        desc: '获取任务列表（分页）',
        requestParams: [
          { name: 'page', type: 'number', required: false, desc: '页码 (默认 1)' },
          { name: 'limit', type: 'number', required: false, desc: '每页数量 (默认 10)' },
          { name: 'status', type: 'string', required: false, desc: '按状态筛选' },
        ],
        response: [
          { name: 'tasks', type: 'Task[]', desc: '任务数组' },
          { name: 'pagination', type: 'object', desc: '{ total, page, limit, totalPages }' },
        ],
      },
      {
        method: 'GET',
        path: '/api/v1/tasks/:taskId/status',
        desc: '获取任务状态',
        response: [
          { name: 'taskId', type: 'string', desc: '任务 ID' },
          { name: 'status', type: 'string', desc: '当前状态' },
          { name: 'startedAt', type: 'string', desc: '开始时间' },
          { name: 'completedAt', type: 'string', desc: '完成时间' },
          { name: 'errorMessage', type: 'string', desc: '错误信息 (如有)' },
        ],
      },
      {
        method: 'GET',
        path: '/api/v1/tasks/:taskId/result',
        desc: '获取任务结果',
        response: [
          { name: 'taskId', type: 'string', desc: '任务 ID' },
          { name: 'status', type: 'string', desc: '当前状态' },
          { name: 'executionResult', type: 'object', desc: '执行结果' },
          { name: 'startedAt', type: 'string', desc: '开始时间' },
          { name: 'completedAt', type: 'string', desc: '完成时间' },
        ],
      },
      {
        method: 'POST',
        path: '/api/v1/tasks/:taskId/stop',
        desc: '停止任务',
        response: [
          { name: 'taskId', type: 'string', desc: '任务 ID' },
          { name: 'status', type: 'string', desc: '最终状态 (failed)' },
          { name: 'message', type: 'string', desc: '操作结果' },
        ],
      },
      {
        method: 'GET',
        path: '/api/v1/tasks/:taskId/report',
        desc: '获取任务报告文件',
        response: [
          { name: '(binary)', type: 'file', desc: '报告文件流' },
        ],
      },
    ],
  },
];

export default function ApiKeysPage() {
  const [activeTab, setActiveTab] = useState<'keys' | 'docs'>('keys');
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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
      await navigator.clipboard.writeText(newlyCreatedKey.key);
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
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">API Key 管理</h1>
          <p className="mt-1 text-sm text-gray-400">
            管理外部调用 API 的访问密钥与接口文档
          </p>
        </div>
        {activeTab === 'keys' && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus size={20} />
            <span>创建 API Key</span>
          </button>
        )}
      </div>

      {/* Tab 导航 */}
      <div className="flex space-x-1 bg-dark-surface-hover p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('keys')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'keys'
              ? 'bg-dark-surface shadow text-blue-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <Key className="w-4 h-4" />
          <span>密钥管理</span>
        </button>
        <button
          onClick={() => setActiveTab('docs')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'docs'
              ? 'bg-dark-surface shadow text-blue-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>接口文档</span>
        </button>
      </div>

      {/* 提示信息 */}
      {alert && (
        <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>
          {alert.message}
        </Alert>
      )}

      {/* 密钥管理 Tab */}
      {activeTab === 'keys' && (
        <>
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
                  <div className="bg-[#0F172A] rounded-lg p-4 font-mono text-sm text-gray-100 break-all border border-green-700/30">
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

          {/* 搜索栏 */}
          <form onSubmit={handleSearch} className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="搜索 API Key 名称..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </form>

          {/* API Key 表格 */}
          {loading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <div className="bg-dark-surface rounded-lg shadow-sm overflow-hidden">
              <table className="min-w-full divide-y divide-gray-700/50">
                <thead className="bg-[#0F172A]">
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
            </div>
          )}
        </>
      )}

      {/* 接口文档 Tab */}
      {activeTab === 'docs' && (
        <div className="bg-dark-surface rounded-lg">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold text-gray-100">开放 API 接口文档</h2>
            <p className="text-sm text-gray-500 mt-1">通过 API Key 调用的外部接口，点击查看详细参数说明</p>
          </div>
          <div className="p-6 space-y-6">
            {/* 认证说明 */}
            <div className="p-4 bg-blue-900/20 border border-blue-700/40 rounded-lg">
              <h4 className="text-sm font-medium text-blue-400 mb-2">认证方式</h4>
              <p className="text-sm text-gray-300 mb-2">
                所有 API 请求需在 HTTP Header 中携带 API Key：
              </p>
              <pre className="text-xs bg-gray-900 text-cyan-400 p-3 rounded overflow-x-auto border border-gray-700">
{`Authorization: Bearer icsl-xxxxxxxxxxxxxxxx`}
              </pre>
              <div className="mt-3 text-xs text-gray-400 space-y-1">
                <p><span className="text-red-400">401</span> — API Key 缺失或格式错误</p>
                <p><span className="text-red-400">403</span> — 无权访问该 Agent</p>
                <p><span className="text-yellow-400">429</span> — 请求频率超出限制</p>
              </div>
            </div>

            {/* 按分类展示接口 */}
            {apiDocs.filter(s => s.endpoints.length > 0).map((section) => (
              <div key={section.category}>
                <h3 className="text-sm font-medium text-gray-300 mb-3 uppercase tracking-wide">
                  {section.category}
                </h3>
                <div className="space-y-2">
                  {section.endpoints.map((ep) => (
                    <ApiDocCard key={`${ep.method}-${ep.path}`} endpoint={ep} />
                  ))}
                </div>
              </div>
            ))}

            {/* 任务状态说明 */}
            <div className="p-4 bg-gray-800/50 border border-gray-700/40 rounded-lg">
              <h4 className="text-sm font-medium text-gray-300 mb-2">任务状态流转</h4>
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span className="px-2 py-1 bg-yellow-900/30 text-yellow-400 rounded">pending</span>
                <span className="text-gray-500">→</span>
                <span className="px-2 py-1 bg-blue-900/30 text-blue-400 rounded">running</span>
                <span className="text-gray-500">→</span>
                <span className="px-2 py-1 bg-green-900/30 text-green-400 rounded">completed</span>
                <span className="text-gray-500">/</span>
                <span className="px-2 py-1 bg-red-900/30 text-red-400 rounded">failed</span>
              </div>
            </div>

            {/* 创建任务支持两种 Content-Type */}
            <div className="p-4 bg-gray-800/50 border border-gray-700/40 rounded-lg">
              <h4 className="text-sm font-medium text-gray-300 mb-2">创建任务支持两种请求格式</h4>
              <div className="space-y-2 text-xs text-gray-400">
                <div>
                  <span className="text-cyan-400 font-mono">application/json</span> — 传 <code className="text-blue-400">fileUrls</code> 字段（URL 数组），服务端自动下载
                </div>
                <div>
                  <span className="text-cyan-400 font-mono">multipart/form-data</span> — 直接上传 <code className="text-blue-400">file</code> 字段（支持多文件）
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 创建 Modal */}
      <CreateApiKeyModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
