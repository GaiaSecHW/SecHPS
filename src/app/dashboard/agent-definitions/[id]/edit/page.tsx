'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Bot,
  ArrowLeft,
  Save,
  Settings,
  Wrench,
  FileText,
  AlertTriangle,
  Loader2,
  Copy,
  Lock,
} from 'lucide-react';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';

// Available models for selection
const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most capable model for complex tasks' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Balanced performance and speed' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude Haiku 3.5', description: 'Fast and efficient for simple tasks' },
];

// Available tools (excluding Agent - SDK limitation)
const AVAILABLE_TOOLS = [
  { id: 'Read', name: 'Read', description: 'Read file contents' },
  { id: 'Glob', name: 'Glob', description: 'Find files by pattern' },
  { id: 'Grep', name: 'Grep', description: 'Search file contents' },
  { id: 'Write', name: 'Write', description: 'Write/create files' },
  { id: 'Edit', name: 'Edit', description: 'Edit existing files' },
  { id: 'Bash', name: 'Bash', description: 'Execute shell commands' },
  { id: 'LspDiagnostics', name: 'LSP Diagnostics', description: 'Get code diagnostics' },
  { id: 'LS', name: 'LS', description: 'List directory contents' },
];

// Categories for agent definitions
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
}

interface FormData {
  name: string;
  displayName: string;
  description: string;
  category: string;
  model: string;
  systemPrompt: string;
  allowedTools: string[];
  skills: string[];
  isActive: boolean;
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

export default function EditAgentDefinitionPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <EditAgentDefinitionPageContent />
    </Suspense>
  );
}

function EditAgentDefinitionPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentId = searchParams.get('id');

  // Agent state
  const [agent, setAgent] = useState<AgentDefinition | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(true);

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(true);

  // Form state
  const [formData, setFormData] = useState<FormData>({
    name: '',
    displayName: '',
    description: '',
    category: 'custom',
    model: 'claude-sonnet-4-20250514',
    systemPrompt: '',
    allowedTools: [],
    skills: [],
    isActive: true,
  });

  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Permission state
  const [canUpdate, setCanUpdate] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);

  // Initialize permissions
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const permissions = payload.permissions || [];
        setUserId(payload.userId);
        setCanUpdate(hasPermission(permissions, PERMISSIONS.AGENT_DEFINITION_UPDATE));
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
      const agentData = data.agentDefinition;
      setAgent(agentData);

      // Initialize form data
      setFormData({
        name: agentData.name,
        displayName: agentData.displayName || '',
        description: agentData.description || '',
        category: agentData.category,
        model: agentData.model,
        systemPrompt: agentData.systemPrompt || '',
        allowedTools: agentData.allowedTools || [],
        skills: agentData.skills || [],
        isActive: agentData.isActive,
      });
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
      toast.error(err instanceof Error ? err.message : '获取 Skills 失败');
    } finally {
      setLoadingSkills(false);
    }
  };

  // Toggle tool selection
  const toggleTool = (toolId: string) => {
    setFormData(prev => ({
      ...prev,
      allowedTools: prev.allowedTools.includes(toolId)
        ? prev.allowedTools.filter(t => t !== toolId)
        : [...prev.allowedTools, toolId],
    }));
  };

  // Toggle skill selection
  const toggleSkill = (skillId: string) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(skillId)
        ? prev.skills.filter(s => s !== skillId)
        : [...prev.skills, skillId],
    }));
  };

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.displayName.trim()) {
      newErrors.displayName = '显示名称不能为空';
    } else if (formData.displayName.trim().length > 100) {
      newErrors.displayName = '显示名称不能超过100个字符';
    }

    if (!formData.description.trim()) {
      newErrors.description = '描述不能为空';
    } else if (formData.description.trim().length > 500) {
      newErrors.description = '描述不能超过500个字符';
    }

    if (!formData.model) {
      newErrors.model = '必须选择模型';
    }

    if (formData.allowedTools.length === 0) {
      newErrors.allowedTools = '必须至少选择一个工具';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Save agent definition
  const handleSave = async () => {
    if (!agentId || agent?.isBuiltin) {
      toast.error('内置 Agent 不可直接编辑，请使用克隆功能');
      return;
    }

    if (!validateForm()) {
      toast.error('请检查表单错误');
      return;
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/agent-definitions/${agentId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          displayName: formData.displayName.trim(),
          description: formData.description.trim(),
          category: formData.category,
          model: formData.model,
          systemPrompt: formData.systemPrompt.trim() || null,
          allowedTools: formData.allowedTools,
          skills: formData.skills.length > 0 ? formData.skills : null,
          isActive: formData.isActive,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '更新 Agent 定义失败');
      }

      toast.success('Agent 定义更新成功');

      // Redirect to list after short delay
      setTimeout(() => {
        router.push('/dashboard/agent-definitions');
      }, 500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新 Agent 定义失败');
    } finally {
      setSaving(false);
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

  // Loading state
  if (loadingAgent) {
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

  // Built-in agent - show clone option
  if (agent.isBuiltin) {
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
                内置 Agent - 不可直接编辑
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
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
                <span>{cloning ? '克隆中...' : '克隆为自定义 Agent'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Built-in Agent Info */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start">
          <Lock className="text-yellow-600 mr-3 mt-0.5" size={20} />
          <div>
            <h3 className="text-sm font-medium text-yellow-800">内置 Agent</h3>
            <p className="text-sm text-yellow-700 mt-1">
              此 Agent 是系统内置的，不可直接编辑。您可以克隆它来创建自己的自定义版本。
            </p>
          </div>
        </div>

        {/* Agent Details (Read-only) */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-6">
          {/* Basic Info */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Bot size={20} className="mr-2" />
              基本信息
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">名称</label>
                <p className="text-gray-900">{agent.name}</p>
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
                <label className="block text-sm font-medium text-gray-500 mb-1">状态</label>
                <p className="text-gray-900">{agent.isActive ? '启用' : '禁用'}</p>
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
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">模型</label>
              <p className="text-gray-900">
                {AVAILABLE_MODELS.find(m => m.id === agent.model)?.name || agent.model}
              </p>
            </div>
          </div>

          {/* Tools */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Wrench size={20} className="mr-2" />
              工具配置
            </h2>
            <div className="flex flex-wrap gap-2">
              {agent.allowedTools.map((tool) => (
                <span
                  key={tool}
                  className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>

          {/* Skills */}
          {agent.skills.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <FileText size={20} className="mr-2" />
                Skills 配置
              </h2>
              <div className="flex flex-wrap gap-2">
                {agent.skills.map((skillId) => {
                  const skill = skills.find(s => s.id === skillId);
                  return (
                    <span
                      key={skillId}
                      className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm"
                    >
                      {skill?.displayName || skill?.name || skillId}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* System Prompt */}
          {agent.systemPrompt && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <FileText size={20} className="mr-2" />
                系统提示
              </h2>
              <pre className="bg-gray-50 p-4 rounded-lg text-sm font-mono whitespace-pre-wrap">
                {agent.systemPrompt}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Permission check for custom agents
  if (!canUpdate) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">权限不足</h3>
          <p className="mt-2 text-sm text-gray-600">您没有编辑 Agent 定义的权限</p>
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

  // Ownership check
  if (agent.userId !== userId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">权限不足</h3>
          <p className="mt-2 text-sm text-gray-600">您只能编辑自己创建的 Agent 定义</p>
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

  // Edit form for custom agents
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
            <h1 className="text-2xl font-bold text-gray-900">编辑 Agent 定义</h1>
            <p className="mt-1 text-sm text-gray-600">
              {agent.displayName || agent.name}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Save size={20} />
            )}
            <span>{saving ? '保存中...' : '保存'}</span>
          </button>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-6">
        {/* Basic Info Section */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Bot size={20} className="mr-2" />
            基本信息
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name (Read-only for existing agents) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Agent 名称
              </label>
              <input
                type="text"
                value={formData.name}
                disabled
                className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
              />
              <p className="mt-1 text-xs text-gray-500">名称不可修改</p>
            </div>

            {/* Display Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                显示名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  errors.displayName ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="例如: Code Reviewer"
              />
              {errors.displayName && (
                <p className="mt-1 text-sm text-red-500">{errors.displayName}</p>
              )}
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                分类
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Active Status */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                状态
              </label>
              <select
                value={formData.isActive ? 'true' : 'false'}
                onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.value === 'true' }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="true">启用</option>
                <option value="false">禁用</option>
              </select>
            </div>

            {/* Description */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                描述 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  errors.description ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="描述 Agent 的功能和用途"
              />
              {errors.description && (
                <p className="mt-1 text-sm text-red-500">{errors.description}</p>
              )}
            </div>
          </div>
        </div>

        {/* Model Configuration Section */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Settings size={20} className="mr-2" />
            模型配置
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              选择模型 <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.model}
              onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                errors.model ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              {AVAILABLE_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} - {model.description}
                </option>
              ))}
            </select>
            {errors.model && (
              <p className="mt-1 text-sm text-red-500">{errors.model}</p>
            )}
          </div>
        </div>

        {/* Tools Section */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Wrench size={20} className="mr-2" />
            工具配置 <span className="text-red-500">*</span>
          </h2>

          {errors.allowedTools && (
            <p className="mb-3 text-sm text-red-500">{errors.allowedTools}</p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {AVAILABLE_TOOLS.map((tool) => (
              <button
                key={tool.id}
                onClick={() => toggleTool(tool.id)}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  formData.allowedTools.includes(tool.id)
                    ? 'bg-blue-100 border-blue-300 text-blue-800'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                <div className="font-medium text-sm">{tool.name}</div>
                <div className="text-xs mt-1 opacity-75">{tool.description}</div>
              </button>
            ))}
          </div>

          <p className="mt-2 text-xs text-gray-500">
            注意: "Agent" 工具不可用于自定义 Agent（SDK 限制，防止嵌套调用）
          </p>
        </div>

        {/* Skills Section */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <FileText size={20} className="mr-2" />
            Skills 配置（可选）
          </h2>

          {loadingSkills ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-blue-500" />
            </div>
          ) : skills.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <FileText className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">暂无可用 Skills</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {skills.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => toggleSkill(skill.id)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    formData.skills.includes(skill.id)
                      ? 'bg-green-100 border-green-300 text-green-800'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <div className="font-medium text-sm">{skill.displayName || skill.name}</div>
                  <div className="text-xs mt-1 opacity-75 truncate">{skill.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* System Prompt Section */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <FileText size={20} className="mr-2" />
            系统提示（可选）
          </h2>

          <textarea
            value={formData.systemPrompt}
            onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
            rows={8}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            placeholder="输入系统提示，定义 Agent 的行为和角色..."
          />
          <p className="mt-1 text-xs text-gray-500">
            系统提示将作为 Agent 的初始指令，影响其行为和输出风格
          </p>
        </div>
      </div>
    </div>
  );
}