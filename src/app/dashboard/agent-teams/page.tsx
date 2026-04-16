'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Users,
  Plus,
  Search,
  Filter,
  Play,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Activity,
  Clock,
  User,
  Loader2,
  Zap,
  Globe,
  Lock,
} from 'lucide-react';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';

interface AgentTeamMember {
  id: string;
  agentId: string;
  agentName: string | null;
  role: string;
  overrideModel: string | null;
  overrideTools: string[] | null;
}

interface AgentTeam {
  id: string;
  userId: string;
  userName: string | null;
  userUsername: string | null;
  name: string;
  description: string | null;
  leadAgentId: string;
  leadAgentName: string | null;
  taskStrategy: string;
  maxTeammates: number;
  status: 'idle' | 'running';
  createdAt: string;
  updatedAt: string;
  members: AgentTeamMember[];
  _count: {
    members: number;
    teamExecutions: number;
  };
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

export default function AgentTeamsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AgentTeamsPageContent />
    </Suspense>
  );
}

function AgentTeamsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [totalTeams, setTotalTeams] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // User and permission state
  const [user, setUser] = useState<{ id?: string; roles?: string[]; permissions?: string[] } | null>(null);
  const [canExecute, setCanExecute] = useState(false);
  const [canCreate, setCanCreate] = useState(false);

  // Filter state from URL params
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [selectedStatus, setSelectedStatus] = useState(searchParams.get('status') || '');

  // Pagination state from URL params
  const [currentPage, setCurrentPage] = useState(Number(searchParams.get('page') || '1'));
  const [pageSize, setPageSize] = useState(Number(searchParams.get('limit') || '20'));
  const [totalPages, setTotalPages] = useState(1);

  // Expanded card state
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  // Execution state
  const [executingTeamId, setExecutingTeamId] = useState<string | null>(null);

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
          setCanExecute(hasPermission(permissions, PERMISSIONS.AGENT_TEAM_EXECUTE));
          setCanCreate(hasPermission(permissions, PERMISSIONS.AGENT_TEAM_CREATE));
        } catch {
          // Token parsing failed
        }
      }
    }
  }, []);

  // Fetch teams when filters/pagination change
  useEffect(() => {
    fetchTeams();
  }, [selectedStatus, currentPage, pageSize]);

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
      fetchTeams();
    }, 300);
    setSearchDebounce(timer);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [searchTerm]);

  const fetchTeams = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const params = new URLSearchParams();
      if (selectedStatus) params.append('status', selectedStatus);
      if (searchTerm) params.append('search', searchTerm);
      params.append('page', currentPage.toString());
      params.append('limit', pageSize.toString());

      const response = await fetch(`/api/agent-teams?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '获取 Agent 团队列表失败');
      }

      const data = await response.json();
      setTeams(data.data || []);
      setTotalTeams(data.pagination?.total || 0);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async (teamId: string, teamName: string) => {
    if (!canExecute) {
      toast.error('您没有执行 Agent 团队的权限');
      return;
    }

    if (!confirm(`确定要执行团队 "${teamName}" 吗？`)) {
      return;
    }

    try {
      setExecutingTeamId(teamId);
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/agent-teams/${teamId}/execute`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '执行失败');
      }

      const data = await response.json();
      toast.success(`团队 "${teamName}" 开始执行`);

      // Navigate to execution monitoring page or show stream URL
      if (data.streamUrl) {
        // Could navigate to a monitoring page or open SSE connection
        router.push(`/dashboard/agent-teams/${teamId}/execution/${data.executionId}`);
      }

      // Refresh list to show updated status
      fetchTeams();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '执行失败');
    } finally {
      setExecutingTeamId(null);
    }
  };

  const handleDelete = async (teamId: string, teamName: string) => {
    if (!confirm(`确定要删除团队 "${teamName}" 吗？删除后将无法恢复。`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/agent-teams/${teamId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }

      toast.success(`团队 "${teamName}" 已删除`);
      fetchTeams();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'idle':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'running':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'idle':
        return <Clock size={14} />;
      case 'running':
        return <Activity size={14} className="animate-pulse" />;
      default:
        return <Clock size={14} />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'idle':
        return '空闲';
      case 'running':
        return '运行中';
      default:
        return status;
    }
  };

  const getTaskStrategyText = (strategy: string) => {
    switch (strategy) {
      case 'parallel':
        return '并行执行';
      case 'sequential':
        return '顺序执行';
      case 'hierarchical':
        return '层级执行';
      default:
        return strategy;
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
          <h1 className="text-2xl font-bold text-gray-900">Agent 团队管理</h1>
          <p className="mt-1 text-sm text-gray-600">
            创建和管理多 Agent 协作团队，共 {totalTeams} 个团队
          </p>
        </div>

        {canCreate && (
          <Link
            href="/dashboard/agent-teams/new"
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Plus size={20} />
            <span>创建新团队</span>
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
              <p className="text-sm font-medium text-gray-600">总团队</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{totalTeams}</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">空闲</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {teams.filter(t => t.status === 'idle').length}
              </p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <Clock className="h-6 w-6 text-gray-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">运行中</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {teams.filter(t => t.status === 'running').length}
              </p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <Activity className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">总执行次数</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {teams.reduce((sum, t) => sum + t._count.teamExecutions, 0)}
              </p>
            </div>
            <div className="p-3 bg-purple-50 rounded-lg">
              <Zap className="h-6 w-6 text-purple-600" />
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
              placeholder="搜索团队名称或描述..."
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
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setCurrentPage(1);
                updateUrlParams({ status: e.target.value || null, page: null });
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">全部状态</option>
              <option value="idle">空闲</option>
              <option value="running">运行中</option>
            </select>
          </div>
        </div>
      </div>

      {/* Teams list */}
      <div className="space-y-4">
        {teams.length === 0 ? (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
            <div className="text-center">
              <Users className="mx-auto h-16 w-16 text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">暂无 Agent 团队</h3>
              <p className="mt-2 text-sm text-gray-600">
                {searchTerm || selectedStatus
                  ? '没有找到匹配的团队'
                  : '创建您的第一个 Agent 团队开始协作'}
              </p>
              {canCreate && !searchTerm && !selectedStatus && (
                <Link
                  href="/dashboard/agent-teams/new"
                  className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <Plus size={16} className="mr-2" />
                  创建团队
                </Link>
              )}
            </div>
          </div>
        ) : (
          teams.map((team) => (
            <div
              key={team.id}
              className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden"
            >
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className={`p-2 rounded-lg ${team.status === 'running' ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <Users className={team.status === 'running' ? 'text-green-600' : 'text-gray-400'} size={24} />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="font-semibold text-gray-900">{team.name}</h3>
                        <span
                          className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(team.status)}`}
                        >
                          {getStatusIcon(team.status)}
                          <span>{getStatusText(team.status)}</span>
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">
                        Lead Agent: {team.leadAgentName || '未指定'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2 text-sm text-gray-500">
                      <Users size={14} />
                      <span>{team._count.members} 成员</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-gray-500">
                      <Zap size={14} />
                      <span>{team._count.teamExecutions} 次执行</span>
                    </div>
                    {expandedTeam === team.id ? (
                      <ChevronUp size={20} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={20} className="text-gray-400" />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded details */}
              {expandedTeam === team.id && (
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">描述</h4>
                      <p className="text-sm text-gray-600">{team.description || '无描述'}</p>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">执行策略</h4>
                      <p className="text-sm text-gray-600">{getTaskStrategyText(team.taskStrategy)}</p>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">最大成员数</h4>
                      <p className="text-sm text-gray-600">{team.maxTeammates}</p>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">创建时间</h4>
                      <p className="text-sm text-gray-600">
                        {new Date(team.createdAt).toLocaleString('zh-CN')}
                      </p>
                    </div>

                    {/* Team members */}
                    <div className="md:col-span-2">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">团队成员</h4>
                      {team.members.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {team.members.map((member) => (
                            <span
                              key={member.id}
                              className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                            >
                              {member.agentName || '未知 Agent'}
                              {member.role !== 'teammate' && (
                                <span className="ml-1 text-xs text-blue-600">({member.role})</span>
                              )}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-600">暂无团队成员</p>
                      )}
                    </div>

                    {/* Creator info */}
                    {team.userName && team.userId !== user?.id && (
                      <div className="md:col-span-2">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">创建者</h4>
                        <p className="text-sm text-gray-600 flex items-center gap-1">
                          <User size={14} />
                          {team.userName || team.userUsername}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="mt-4 flex items-center space-x-2">
                    <Link
                      href={`/dashboard/agent-teams/${team.id}`}
                      className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                    >
                      <Edit2 size={16} className="mr-1" />
                      {(isAdmin || team.userId === user?.id) ? '编辑' : '查看详情'}
                    </Link>

                    {canExecute && team.status === 'idle' && (
                      <button
                        onClick={() => handleExecute(team.id, team.name)}
                        disabled={executingTeamId === team.id}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-green-100 text-green-800 rounded hover:bg-green-200 disabled:opacity-50"
                      >
                        {executingTeamId === team.id ? (
                          <>
                            <Loader2 size={16} className="mr-1 animate-spin" />
                            执行中...
                          </>
                        ) : (
                          <>
                            <Play size={16} className="mr-1" />
                            执行
                          </>
                        )}
                      </button>
                    )}

                    {team.status === 'running' && (
                      <Link
                        href={`/dashboard/agent-teams/${team.id}/execution`}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-purple-100 text-purple-800 rounded hover:bg-purple-200"
                      >
                        <Activity size={16} className="mr-1" />
                        查看执行
                      </Link>
                    )}

                    {(isAdmin || team.userId === user?.id) && (
                      <button
                        onClick={() => handleDelete(team.id, team.name)}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
                      >
                        <Trash2 size={16} className="mr-1" />
                        删除
                      </button>
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
              共 {totalTeams} 条记录，第 {currentPage} / {totalPages} 页
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