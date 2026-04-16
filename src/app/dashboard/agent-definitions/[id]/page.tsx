'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Bot,
  ArrowLeft,
  Edit2,
  Copy,
  Trash2,
  Settings,
  Wrench,
  FileText,
  AlertTriangle,
  Loader2,
  Lock,
  Calendar,
  User,
  Activity,
} from 'lucide-react';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';

// Available models for display
const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most capable model for complex tasks' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Balanced performance and speed' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude Haiku 3.5', description: 'Fast and efficient for simple tasks' },
];

// Categories for display
const CATEGORIES = [
  { id: 'security', name: 'Security', description: 'Security analysis and vulnerability detection' },
  { id: 'analysis', name: 'Analysis', description: 'Code analysis and review' },
  { id: 'documentation', name: 'Documentation', description: 'Documentation generation' },
  { id: 'custom', name: 'Custom', description: 'Custom agent definition' },
];

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
}

interface AgentDefinition {
  id: string;
  userId: string | null;
  name: string;
  displayName: string;
  description: string;
  category: string;
  model: string;
  systemPrompt: string | null;
  allowedTools: string[];
  skills: string[];
  mcpServers: string[];
  isActive: boolean;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    name: string | null;
    username: string | null;
  };
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

export default function AgentDefinitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AgentDefinitionDetailPageContent params={params} />
    </Suspense>
  );
}

function AgentDefinitionDetailPageContent({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [agentId, setAgentId] = useState<string | null>(null);

  // Agent state
  const [agent, setAgent] = useState<AgentDefinition | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(true);

  // Skills state (for displaying skill names)
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(true);

  // Permission state
  const [canUpdate, setCanUpdate] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Action state
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Resolve params
  useEffect(() => {
    params.then(p => setAgentId(p.id));
  }, [params]);

  // Initialize permissions
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const permissions = payload.permissions || [];
        setUserId(payload.userId);
        setCanUpdate(hasPermission(permissions, PERMISSIONS.AGENT_DEFINITION_UPDATE));
        setCanDelete(hasPermission(permissions, PERMISSIONS.AGENT_DEFINITION_DELETE));
        setCanCreate(hasPermission(permissions, PERMISSIONS.AGENT_DEFINITION_CREATE));
      } catch {
        // Token parsing failed
      }
    }
  }, []);

  // Fetch agent definition
  useEffect(() => {
    if (agentId) {
      fetchAgent();
    }
  }, [agentId]);

  // Fetch skills
  useEffect(() => {
    fetchSkills();
  }, []);

  const fetchAgent = async () => {
    try {
      setLoadingAgent(true);
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/agent-definitions/${agentId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取 Agent 定义失败');
      }

      const data = await response.json();
      setAgent(data.agentDefinition);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '获取 Agent 定义失败');
      router.push('/dashboard/agent-definitions');
    } finally {
      setLoadingAgent(false);
    }
  };

  const fetchSkills = async () => {
    try {
      setLoadingSkills(true);
      const token = localStorage.getItem('token');

      const response = await fetch('/api/skills?scope=all&limit=100', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取 Skills 失败');
      }

      const data = await response.json();
      setSkills(data.data || []);
    } catch (err) {
      // Silently fail for skills - not critical
    } finally {
      setLoadingSkills(false);
    }
  };

  // Clone agent definition
  const handleClone = async () => {
    if (!agent) return;

    if (!canCreate) {
      toast.error('您没有创建 Agent 定义的权限');
      return;
    }

    try {
      setCloning(true);
      const token = localStorage.getItem('token');

      // Generate unique name for clone
      const cloneName = `copy-of-${agent.name}`;

      const response = await fetch('/api/agent-definitions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: cloneName,
          displayName: `Copy of ${agent.displayName || agent.name}`,
          description: agent.description,
          category: agent.category,
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          allowedTools: agent.allowedTools,
          skills: agent.skills,
          isActive: true,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '克隆 Agent 定义失败');
      }

      const data = await response.json();
      toast.success('Agent 定义克隆成功');

      // Redirect to edit the cloned agent
      setTimeout(() => {
        router.push(`/dashboard/agent-definitions/${data.agentDefinition.id}/edit`);
      }, 500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '克隆 Agent 定义失败');
    } finally {
      setCloning(false);
    }
  };

  // Delete agent definition
  const handleDelete = async () => {
    if (!agent || agent.isBuiltin) {
      toast.error('内置 Agent 不可删除');
      return;
    }

    if (!canDelete) {
      toast.error('您没有删除 Agent 定义的权限');
      return;
    }

    if (agent.userId !== userId) {
      toast.error('您只能删除自己创建的 Agent 定义');
      return;
    }

    // Confirm deletion
    if (!confirm(`确定要删除 Agent "${agent.displayName || agent.name}" 吗？此操作不可撤销。`)) {
      return;
    }

    try {
      setDeleting(true);
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/agent-definitions/${agent.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除 Agent 定义失败');
      }

      toast.success('Agent 定义已删除');

      // Redirect to list
      setTimeout(() => {
        router.push('/dashboard/agent-definitions');
      }, 500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除 Agent 定义失败');
    } finally {
      setDeleting(false);
    }
  };

  // Loading state
  if (loadingAgent || !agentId) {
    return <LoadingSpinner />;
  }

  // Agent not found
  if (!agent) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">Agent 定义不存在</h3>
          <Link
            href="/dashboard/agent-definitions"
            className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <ArrowLeft size={16} className="mr-2" />
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  // Determine if user can edit this agent
  const canEdit = !agent.isBuiltin && canUpdate && agent.userId === userId;
  const canDeleteThis = !agent.isBuiltin && canDelete && agent.userId === userId;

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            href="/dashboard/agent-definitions"
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{agent.displayName || agent.name}</h1>
            <p className="mt-1 text-sm text-gray-600">
              {agent.isBuiltin ? '内置 Agent' : '自定义 Agent'} · {CATEGORIES.find(c => c.id === agent.category)?.name || agent.category}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Clone button (for built-in or any agent) */}
          {canCreate && (
            <button
              onClick={handleClone}
              disabled={cloning}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cloning ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Copy size={20} />
              )}
              <span>{cloning ? '克隆中...' : '克隆'}</span>
            </button>
          )}

          {/* Edit button (only for custom agents owned by user) */}
          {canEdit && (
            <Link
              href={`/dashboard/agent-definitions/${agent.id}/edit`}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              <Edit2 size={20} />
              <span>编辑</span>
            </Link>
          )}

          {/* Delete button (only for custom agents owned by user) */}
          {canDeleteThis && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Trash2 size={20} />
              )}
              <span>{deleting ? '删除中...' : '删除'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Built-in Agent Warning */}
      {agent.isBuiltin && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start">
          <Lock className="text-yellow-600 mr-3 mt-0.5" size={20} />
          <div>
            <h3 className="text-sm font-medium text-yellow-800">内置 Agent</h3>
            <p className="text-sm text-yellow-700 mt-1">
              此 Agent 是系统内置的，不可直接编辑或删除。您可以克隆它来创建自己的自定义版本。
            </p>
          </div>
        </div>
      )}

      {/* Agent Details */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-6">
        {/* Status Badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Activity size={16} className={agent.isActive ? 'text-green-500' : 'text-gray-400'} />
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
              agent.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
            }`}>
              {agent.isActive ? '启用' : '禁用'}
            </span>
          </div>
          {agent.isBuiltin && (
            <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              内置
            </span>
          )}
        </div>

        {/* Basic Info */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Bot size={20} className="mr-2" />
            基本信息
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">名称</label>
              <p className="text-gray-900 font-mono">{agent.name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">显示名称</label>
              <p className="text-gray-900">{agent.displayName || '-'}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">分类</label>
              <p className="text-gray-900">{CATEGORIES.find(c => c.id === agent.category)?.name || agent.category}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">创建者</label>
              <p className="text-gray-900 flex items-center">
                <User size={14} className="mr-1 text-gray-400" />
                {agent.isBuiltin ? '系统' : (agent.user?.name || agent.user?.username || '未知')}
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-500 mb-1">描述</label>
              <p className="text-gray-900">{agent.description}</p>
            </div>
          </div>
        </div>

        {/* Model */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Settings size={20} className="mr-2" />
            模型配置
          </h2>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="flex-1">
                <p className="font-medium text-gray-900">
                  {AVAILABLE_MODELS.find(m => m.id === agent.model)?.name || agent.model}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {AVAILABLE_MODELS.find(m => m.id === agent.model)?.description || 'Custom model'}
                </p>
              </div>
              <code className="px-2 py-1 bg-gray-200 rounded text-xs font-mono text-gray-600">
                {agent.model}
              </code>
            </div>
          </div>
        </div>

        {/* Tools */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Wrench size={20} className="mr-2" />
            工具配置
          </h2>
          <div className="flex flex-wrap gap-2">
            {agent.allowedTools.length > 0 ? (
              agent.allowedTools.map((tool) => (
                <span
                  key={tool}
                  className="px-3 py-1.5 bg-blue-100 text-blue-800 rounded-lg text-sm font-medium"
                >
                  {tool}
                </span>
              ))
            ) : (
              <span className="text-gray-500 text-sm">无工具配置</span>
            )}
          </div>
          {agent.allowedTools.includes('Agent') && (
            <p className="mt-2 text-xs text-yellow-600">
              此 Agent 包含 "Agent" 工具，可以调用子 Agent
            </p>
          )}
        </div>

        {/* Skills */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <FileText size={20} className="mr-2" />
            Skills 配置
          </h2>
          {loadingSkills ? (
            <div className="flex items-center py-4">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : agent.skills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {agent.skills.map((skillId) => {
                const skill = skills.find(s => s.id === skillId);
                return (
                  <span
                    key={skillId}
                    className="px-3 py-1.5 bg-green-100 text-green-800 rounded-lg text-sm font-medium"
                  >
                    {skill?.displayName || skill?.name || skillId}
                  </span>
                );
              })}
            </div>
          ) : (
            <span className="text-gray-500 text-sm">无 Skills 配置</span>
          )}
        </div>

        {/* System Prompt */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <FileText size={20} className="mr-2" />
            系统提示
          </h2>
          {agent.systemPrompt ? (
            <pre className="bg-gray-50 p-4 rounded-lg text-sm font-mono whitespace-pre-wrap overflow-x-auto">
              {agent.systemPrompt}
            </pre>
          ) : (
            <span className="text-gray-500 text-sm">无系统提示配置</span>
          )}
        </div>

        {/* Timestamps */}
        <div className="border-t border-gray-200 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-500">
            <div className="flex items-center">
              <Calendar size={14} className="mr-2" />
              <span>创建时间: {formatDate(agent.createdAt)}</span>
            </div>
            <div className="flex items-center">
              <Calendar size={14} className="mr-2" />
              <span>更新时间: {formatDate(agent.updatedAt)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}