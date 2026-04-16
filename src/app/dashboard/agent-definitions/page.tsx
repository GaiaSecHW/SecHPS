'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Bot,
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Lock,
  Globe,
  Cpu,
  Tag,
  Clock,
  Loader2,
  Shield,
  Bug,
  FileText,
} from 'lucide-react';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';

interface AgentDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  category: string;
  model: string;
  modelConfigId: string | null;
  systemPrompt: string | null;
  allowedTools: string[];
  skills: string[];
  mcpServers: string[];
  userId: string | null;
  isBuiltin: boolean;
  isActive: boolean;
  updatedAt: string;
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

export default function AgentDefinitionsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AgentDefinitionsPageContent />
    </Suspense>
  );
}

function AgentDefinitionsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [totalAgents, setTotalAgents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // User and permission state
  const [user, setUser] = useState<{ id?: string; roles?: string[]; permissions?: string[] } | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  // Filter state from URL params
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');
  const [selectedScope, setSelectedScope] = useState(searchParams.get('scope') || 'all');

  // Pagination state from URL params
  const [currentPage, setCurrentPage] = useState(Number(searchParams.get('page') || '1'));
  const [pageSize, setPageSize] = useState(Number(searchParams.get('limit') || '20'));
  const [totalPages, setTotalPages] = useState(1);

  // Expanded card state
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  // Search debounce
  const [searchDebounce, setSearchDebounce] = useState<NodeJS.Timeout | null>(null);

  // Update URL params helper
  const updateUrlParams = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key);
      } else if (key === 'page' && value === 1) {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    });

    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  };

  // Initialize user and permissions
  useEffect(() => {
    const userData = localStorage.getItem('user');
    const token = localStorage.getItem('token');

    if (userData) {
      const parsedUser = JSON.parse(userData);
      setUser(parsedUser);

      // Check permissions from token
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          const permissions = payload.permissions || [];
          setCanCreate(hasPermission(permissions, PERMISSIONS.AGENT_DEFINITION_CREATE));
          setCanUpdate(hasPermission(permissions, PERMISSIONS.AGENT_DEFINITION_UPDATE));
          setCanDelete(hasPermission(permissions, PERMISSIONS.AGENT_DEFINITION_DELETE));
        } catch {
          // Token parsing failed
        }
      }
    }
  }, []);

  // Fetch agents when filters/pagination change
  useEffect(() => {
    fetchAgents();
  }, [selectedCategory, selectedScope, currentPage, pageSize]);

  // Search debounce effect
  useEffect(() => {
    if (searchDebounce) {
      clearTimeout(searchDebounce);
    }
    const timer = setTimeout(() => {
      if (searchTerm !== (searchParams.get('search') || '')) {
        setCurrentPage(1);
        updateUrlParams({ search: searchTerm || null, page: null });
      }
      fetchAgents();
    }, 300);
    setSearchDebounce(timer);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [searchTerm]);

  const fetchAgents = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const params = new URLSearchParams();
      if (selectedCategory) params.append('category', selectedCategory);
      if (selectedScope) params.append('scope', selectedScope);
      if (searchTerm) params.append('search', searchTerm);
      params.append('page', currentPage.toString());
      params.append('limit', pageSize.toString());

      const response = await fetch(`/api/agent-definitions?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '获取 Agent 定义列表失败');
      }

      const data = await response.json();
      setAgents(data.agentDefinitions || []);
      setTotalAgents(data.agentDefinitions?.length || 0);
      // API doesn't return pagination, calculate from results
      setTotalPages(Math.ceil((data.agentDefinitions?.length || 0) / pageSize) || 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (agentId: string, agentName: string) => {
    if (!confirm(`确定要删除 Agent 定义 "${agentName}" 吗？删除后将无法恢复。`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/agent-definitions/${agentId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }

      toast.success(`Agent 定义 "${agentName}" 已删除`);
      fetchAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'security':
        return <Shield size={14} />;
      case 'vulnerability':
        return <Bug size={14} />;
      case 'documentation':
        return <FileText size={14} />;
      default:
        return <Bot size={14} />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'security':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'vulnerability':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'documentation':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getCategoryText = (category: string) => {
    switch (category) {
      case 'security':
        return '安全分析';
      case 'vulnerability':
        return '漏洞挖掘';
      case 'documentation':
        return '文档生成';
      case 'general':
        return '通用';
      default:
        return category;
    }
  };

  const isAdmin = user?.roles?.includes('admin');

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agent 定义管理</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理内置和自定义 Agent 定义模板，共 {totalAgents} 个定义
          </p>
        </div>

        {canCreate && (
          <Link
            href="/dashboard/agent-definitions/new"
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Plus size={20} />
            <span>创建新定义</span>
          </Link>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">总定义数</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{totalAgents}</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <Bot className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">内置 Agent</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {agents.filter(a => a.isBuiltin).length}
              </p>
            </div>
            <div className="p-3 bg-purple-50 rounded-lg">
              <Lock className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">自定义 Agent</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {agents.filter(a => !a.isBuiltin).length}
              </p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <Globe className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">活跃定义</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {agents.filter(a => a.isActive).length}
              </p>
            </div>
            <div className="p-3 bg-yellow-50 rounded-lg">
              <Cpu className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="搜索 Agent 名称或描述..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter size={20} className="text-gray-400" />
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setCurrentPage(1);
                updateUrlParams({ category: e.target.value || null, page: null });
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">全部类别</option>
              <option value="security">安全分析</option>
              <option value="vulnerability">漏洞挖掘</option>
              <option value="documentation">文档生成</option>
              <option value="general">通用</option>
            </select>
          </div>

          <select
            value={selectedScope}
            onChange={(e) => {
              setSelectedScope(e.target.value);
              setCurrentPage(1);
              updateUrlParams({ scope: e.target.value, page: null });
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">全部</option>
            <option value="public">内置 Agent</option>
            <option value="mine">我的定义</option>
          </select>
        </div>
      </div>

      {/* Agents list */}
      <div className="space-y-4">
        {agents.length === 0 ? (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
            <div className="text-center">
              <Bot className="mx-auto h-16 w-16 text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">暂无 Agent 定义</h3>
              <p className="mt-2 text-sm text-gray-600">
                {searchTerm || selectedCategory || selectedScope !== 'all'
                  ? '没有找到匹配的 Agent 定义'
                  : '创建您的第一个自定义 Agent 定义'}
              </p>
              {canCreate && !searchTerm && !selectedCategory && selectedScope === 'all' && (
                <Link
                  href="/dashboard/agent-definitions/new"
                  className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <Plus size={16} className="mr-2" />
                  创建定义
                </Link>
              )}
            </div>
          </div>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden"
            >
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedAgent(expandedAgent === agent.id ? null : agent.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className={`p-2 rounded-lg ${agent.isBuiltin ? 'bg-purple-100' : 'bg-blue-100'}`}>
                      <Bot className={agent.isBuiltin ? 'text-purple-600' : 'text-blue-600'} size={24} />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="font-semibold text-gray-900">{agent.displayName}</h3>
                        {agent.isBuiltin && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium border bg-purple-100 text-purple-800 border-purple-200">
                            <Lock size={12} />
                            <span>内置</span>
                          </span>
                        )}
                        {!agent.isActive && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-600 border-gray-200">
                            已禁用
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {agent.name} · {agent.model}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <span
                      className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${getCategoryColor(agent.category)}`}
                    >
                      {getCategoryIcon(agent.category)}
                      <span>{getCategoryText(agent.category)}</span>
                    </span>
                    <div className="flex items-center space-x-2 text-sm text-gray-500">
                      <Cpu size={14} />
                      <span>{agent.model}</span>
                    </div>
                    {expandedAgent === agent.id ? (
                      <ChevronUp size={20} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={20} className="text-gray-400" />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded details */}
              {expandedAgent === agent.id && (
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">描述</h4>
                      <p className="text-sm text-gray-600">{agent.description || '无描述'}</p>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">模型</h4>
                      <p className="text-sm text-gray-600">{agent.model}</p>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">类别</h4>
                      <p className="text-sm text-gray-600">{getCategoryText(agent.category)}</p>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">更新时间</h4>
                      <p className="text-sm text-gray-600">
                        {new Date(agent.updatedAt).toLocaleString('zh-CN')}
                      </p>
                    </div>

                    {/* Allowed Tools */}
                    {agent.allowedTools && agent.allowedTools.length > 0 && (
                      <div className="md:col-span-2">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">允许的工具</h4>
                        <div className="flex flex-wrap gap-2">
                          {agent.allowedTools.map((tool, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm"
                            >
                              {tool}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Skills */}
                    {agent.skills && agent.skills.length > 0 && (
                      <div className="md:col-span-2">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">技能</h4>
                        <div className="flex flex-wrap gap-2">
                          {agent.skills.map((skill, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* MCP Servers */}
                    {agent.mcpServers && agent.mcpServers.length > 0 && (
                      <div className="md:col-span-2">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">MCP 服务器</h4>
                        <div className="flex flex-wrap gap-2">
                          {agent.mcpServers.map((server, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm"
                            >
                              {server}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* System Prompt preview */}
                    {agent.systemPrompt && (
                      <div className="md:col-span-2">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">系统提示词</h4>
                        <p className="text-sm text-gray-600 bg-white p-3 rounded border border-gray-200 max-h-32 overflow-y-auto">
                          {agent.systemPrompt.length > 200
                            ? `${agent.systemPrompt.substring(0, 200)}...`
                            : agent.systemPrompt}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="mt-4 flex items-center space-x-2">
                    <Link
                      href={`/dashboard/agent-definitions/${agent.id}/edit`}
                      className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                    >
                      <Edit2 size={16} className="mr-1" />
                      {canUpdate && (isAdmin || !agent.isBuiltin) ? '编辑' : '查看详情'}
                    </Link>

                    {/* Built-in agents cannot be deleted */}
                    {!agent.isBuiltin && (isAdmin || agent.userId === user?.id) && canDelete && (
                      <button
                        onClick={() => handleDelete(agent.id, agent.displayName)}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
                      >
                        <Trash2 size={16} className="mr-1" />
                        删除
                      </button>
                    )}

                    {agent.isBuiltin && (
                      <span className="inline-flex items-center px-3 py-1.5 text-sm text-gray-500">
                        <Lock size={14} className="mr-1" />
                        内置 Agent 不可删除
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-lg shadow border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              共 {totalAgents} 条记录，第 {currentPage} / {totalPages} 页
            </span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
                updateUrlParams({ limit: Number(e.target.value), page: null });
              }}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            >
              <option value="10">10 条/页</option>
              <option value="20">20 条/页</option>
              <option value="50">50 条/页</option>
              <option value="100">100 条/页</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCurrentPage(1);
                updateUrlParams({ page: null });
              }}
              disabled={currentPage === 1}
              className="flex items-center p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="首页"
            >
              <ChevronLeft size={16} />
              <ChevronLeft size={16} className="-ml-2" />
            </button>

            <button
              onClick={() => {
                const newPage = Math.max(1, currentPage - 1);
                setCurrentPage(newPage);
                updateUrlParams({ page: newPage === 1 ? null : newPage });
              }}
              disabled={currentPage === 1}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="上一页"
            >
              <ChevronLeft size={20} />
            </button>

            <span className="px-3 py-1 text-sm text-gray-700">
              {currentPage} / {totalPages}
            </span>

            <button
              onClick={() => {
                const newPage = Math.min(totalPages, currentPage + 1);
                setCurrentPage(newPage);
                updateUrlParams({ page: newPage === 1 ? null : newPage });
              }}
              disabled={currentPage === totalPages}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="下一页"
            >
              <ChevronRight size={20} />
            </button>

            <button
              onClick={() => {
                setCurrentPage(totalPages);
                updateUrlParams({ page: totalPages === 1 ? null : totalPages });
              }}
              disabled={currentPage === totalPages}
              className="flex items-center p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="末页"
            >
              <ChevronRight size={16} />
              <ChevronRight size={16} className="-ml-2" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}