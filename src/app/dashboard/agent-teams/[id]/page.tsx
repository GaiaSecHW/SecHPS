'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Users,
  ArrowLeft,
  Play,
  Edit2,
  Trash2,
  Settings,
  Activity,
  Clock,
  Brain,
  Zap,
  Loader2,
  Crown,
  Eye,
} from 'lucide-react';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';

interface AgentDefinition {
  id: string;
  name: string;
  displayName: string;
  model: string;
  category: string;
}

interface TeamMember {
  id: string;
  agentId: string;
  agentName: string | null;
  role: string;
  overrideModel: string | null;
}

interface AgentTeam {
  id: string;
  userId: string;
  userName: string | null;
  name: string;
  description: string | null;
  leadAgentId: string;
  leadAgentName: string | null;
  taskStrategy: string;
  maxTeammates: number;
  status: 'idle' | 'running';
  createdAt: string;
  updatedAt: string;
  members: TeamMember[];
  _count: {
    AgentTeamMember: number;
    AgentTeamExecution: number;
  };
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

export default function AgentTeamDetailPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AgentTeamDetailContent />
    </Suspense>
  );
}

function AgentTeamDetailContent() {
  const router = useRouter();
  const params = useParams();
  const teamId = params.id as string;

  const [team, setTeam] = useState<AgentTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id?: string; roles?: string[] } | null>(null);
  const [canExecute, setCanExecute] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    const token = localStorage.getItem('token');

    if (userData) {
      const parsedUser = JSON.parse(userData);
      setUser(parsedUser);

      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          const permissions = payload.permissions || [];
          setCanExecute(hasPermission(permissions, PERMISSIONS.AGENT_TEAM_EXECUTE));
          setCanUpdate(hasPermission(permissions, PERMISSIONS.AGENT_TEAM_UPDATE));
          setCanDelete(hasPermission(permissions, PERMISSIONS.AGENT_TEAM_DELETE));
        } catch {
          // Token parsing failed
        }
      }
    }
  }, []);

  useEffect(() => {
    fetchTeam();
  }, [teamId]);

  const fetchTeam = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/agent-teams/${teamId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          toast.error('团队不存在');
          router.push('/dashboard/agent-teams');
          return;
        }
        throw new Error('获取团队详情失败');
      }

      const data = await response.json();
      setTeam(data.team);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!team) return;

    if (!confirm(`确定要删除团队 "${team.name}" 吗？删除后将无法恢复。`)) {
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

      toast.success('团队已删除');
      router.push('/dashboard/agent-teams');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleExecute = async () => {
    if (!team) return;

    try {
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
      toast.success('团队开始执行');

      if (data.executionId) {
        router.push(`/dashboard/agent-teams/${teamId}/execution/${data.executionId}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '执行失败');
    }
  };

  const isAdmin = user?.roles?.includes('admin');
  const isOwner = team?.userId === user?.id;
  const canEdit = canUpdate && (isAdmin || isOwner);
  const canRemove = canDelete && (isAdmin || isOwner);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!team) {
    return (
      <div className="text-center py-12">
        <Users className="mx-auto h-16 w-16 text-gray-400" />
        <h3 className="mt-4 text-lg font-medium text-gray-900">团队不存在</h3>
        <Link
          href="/dashboard/agent-teams"
          className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <ArrowLeft size={16} className="mr-2" />
          返回列表
        </Link>
      </div>
    );
  }

  const getTaskStrategyText = (strategy: string) => {
    switch (strategy) {
      case 'parallel': return '并行执行';
      case 'sequential': return '顺序执行';
      case 'hierarchical': return '层级执行';
      default: return strategy;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'idle': return 'bg-gray-100 text-gray-800';
      case 'running': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'idle': return '空闲';
      case 'running': return '运行中';
      default: return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            href="/dashboard/agent-teams"
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{team.name}</h1>
            <p className="mt-1 text-sm text-gray-600">
              Agent 团队详情
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {canEdit && (
            <Link
              href={`/dashboard/agent-teams/${teamId}/edit`}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-100 text-blue-800 rounded-md hover:bg-blue-200"
            >
              <Edit2 size={18} />
              <span>编辑</span>
            </Link>
          )}
          {canEdit && (
            <Link
              href={`/dashboard/agent-teams/${teamId}/visual`}
              className="flex items-center space-x-2 px-4 py-2 bg-purple-100 text-purple-800 rounded-md hover:bg-purple-200"
            >
              <Eye size={18} />
              <span>可视化编辑</span>
            </Link>
          )}
          {canExecute && team.status === 'idle' && (
            <button
              onClick={handleExecute}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              <Play size={18} />
              <span>执行</span>
            </button>
          )}
          {team.status === 'running' && (
            <Link
              href={`/dashboard/agent-teams/${teamId}/execution`}
              className="flex items-center space-x-2 px-4 py-2 bg-purple-100 text-purple-800 rounded-md hover:bg-purple-200"
            >
              <Activity size={18} />
              <span>查看执行</span>
            </Link>
          )}
          {canRemove && (
            <button
              onClick={handleDelete}
              className="flex items-center space-x-2 px-4 py-2 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
            >
              <Trash2 size={18} />
              <span>删除</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Team Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info Card */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Settings size={20} className="mr-2" />
              基本信息
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">状态</p>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(team.status)}`}>
                  {team.status === 'running' ? <Activity size={12} className="mr-1" /> : <Clock size={12} className="mr-1" />}
                  {getStatusText(team.status)}
                </span>
              </div>
              <div>
                <p className="text-sm text-gray-500">执行策略</p>
                <p className="text-sm font-medium text-gray-900">{getTaskStrategyText(team.taskStrategy)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">最大成员数</p>
                <p className="text-sm font-medium text-gray-900">{team.maxTeammates}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">创建时间</p>
                <p className="text-sm font-medium text-gray-900">
                  {new Date(team.createdAt).toLocaleString('zh-CN')}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-gray-500">描述</p>
                <p className="text-sm font-medium text-gray-900">{team.description || '无描述'}</p>
              </div>
            </div>
          </div>

          {/* Lead Agent Card */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Crown size={20} className="mr-2 text-amber-500" />
              Lead Agent
            </h2>

            <div className="flex items-center space-x-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="p-3 bg-amber-100 rounded-lg">
                <Brain size={24} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{team.leadAgentName || '未指定'}</h3>
                <p className="text-sm text-gray-500">主控 Agent</p>
              </div>
            </div>
          </div>

          {/* Team Members Card */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Users size={20} className="mr-2" />
              团队成员 ({team.members.length})
            </h2>

            {team.members.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                暂无团队成员
              </div>
            ) : (
              <div className="space-y-3">
                {team.members.map((member, index) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <Brain size={18} className="text-blue-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">
                          {member.agentName || '未知 Agent'}
                        </h4>
                        <p className="text-sm text-gray-500">
                          {member.role === 'teammate' ? '成员' : member.role}
                        </p>
                      </div>
                    </div>
                    {member.overrideModel && (
                      <div className="flex items-center space-x-1 px-2 py-1 bg-blue-100 rounded text-sm text-blue-800">
                        <Zap size={14} />
                        <span>{member.overrideModel}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Stats Card */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">统计</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">成员数量</span>
                <span className="text-lg font-semibold text-gray-900">{team._count.AgentTeamMember}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">执行次数</span>
                <span className="text-lg font-semibold text-gray-900">{team._count.AgentTeamExecution}</span>
              </div>
            </div>
          </div>

          {/* Creator Info */}
          {team.userName && team.userId !== user?.id && (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">创建者</h2>
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gray-100 rounded-full">
                  <Users size={18} className="text-gray-600" />
                </div>
                <span className="font-medium text-gray-900">{team.userName}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
