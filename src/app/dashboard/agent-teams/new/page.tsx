'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Users,
  ArrowLeft,
  Save,
  Play,
  Plus,
  Trash2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  Settings,
  Link2,
} from 'lucide-react';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';
import { RalphLoopConfigPanel } from '@/components/agent-team/RalphLoopConfigPanel';
import type { RalphLoopConfig } from '@/types/ralph-loop-config';
import { DEFAULT_RALPH_LOOP_CONFIG } from '@/types/ralph-loop-config';

interface AgentDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  model: string;
  allowedTools: string[];
  skills: string[];
  mcpServers: any[];
  isBuiltin: boolean;
  isActive: boolean;
}

interface TeamMember {
  id: string; // temporary ID for UI
  agentId: string;
  agent?: AgentDefinition;
  role: string;
  overrideModel: string | null;
  overrideTools: string[] | null;
  dependsOn: string[]; // IDs of other members this one depends on
}

interface TeamFormData {
  name: string;
  description: string;
  leadAgentId: string;
  taskStrategy: string;
  maxTeammates: number;
  members: TeamMember[];
  ralphConfig: RalphLoopConfig;
}

// Circular dependency detection using DFS
function hasCircularDependency(members: TeamMember[]): boolean {
  // Build dependency graph from member IDs
  const graph = new Map<string, Set<string>>();
  
  for (const member of members) {
    if (!graph.has(member.id)) graph.set(member.id, new Set());
    for (const depId of member.dependsOn) {
      graph.get(member.id)!.add(depId);
    }
  }
  
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  
  function dfs(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);
    const neighbors = graph.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true; // Cycle detected
      }
    }
    recursionStack.delete(node);
    return false;
  }
  
  for (const node of graph.keys()) {
    if (!visited.has(node) && dfs(node)) return true;
  }
  return false;
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

export default function NewAgentTeamPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <NewAgentTeamPageContent />
    </Suspense>
  );
}

function NewAgentTeamPageContent() {
  const router = useRouter();
  
  // Agent definitions state
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  
  // Form state
  const [formData, setFormData] = useState<TeamFormData>({
    name: '',
    description: '',
    leadAgentId: '',
    taskStrategy: 'parallel',
    maxTeammates: 5,
    members: [],
    ralphConfig: DEFAULT_RALPH_LOOP_CONFIG,
  });
  
  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasCircularDep, setHasCircularDep] = useState(false);
  
  // Permission state
  const [canExecute, setCanExecute] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  
  // Save state
  const [saving, setSaving] = useState(false);
  const [savedTeamId, setSavedTeamId] = useState<string | null>(null);
  
  // Initialize permissions
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const permissions = payload.permissions || [];
        setCanCreate(hasPermission(permissions, PERMISSIONS.AGENT_TEAM_CREATE));
        setCanExecute(hasPermission(permissions, PERMISSIONS.AGENT_TEAM_EXECUTE));
      } catch {
        // Token parsing failed
      }
    }
  }, []);
  
  // Fetch agent definitions
  useEffect(() => {
    fetchAgents();
  }, []);
  
  const fetchAgents = async () => {
    try {
      setLoadingAgents(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/agent-definitions', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      if (!response.ok) {
        throw new Error('获取 Agent 定义失败');
      }
      
      const data = await response.json();
      setAgents(data.agentDefinitions || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '获取 Agent 定义失败');
    } finally {
      setLoadingAgents(false);
    }
  };
  
  // Check circular dependency whenever members change
  useEffect(() => {
    setHasCircularDep(hasCircularDependency(formData.members));
  }, [formData.members]);
  
  // Generate temporary ID for new member
  const generateTempId = () => `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Add new teammate
  const handleAddTeammate = () => {
    if (formData.members.length >= formData.maxTeammates) {
      toast.error(`团队成员数量已达上限 (${formData.maxTeammates})`);
      return;
    }
    
    const newMember: TeamMember = {
      id: generateTempId(),
      agentId: '',
      agent: undefined,
      role: 'teammate',
      overrideModel: null,
      overrideTools: null,
      dependsOn: [],
    };
    
    setFormData(prev => ({
      ...prev,
      members: [...prev.members, newMember],
    }));
  };
  
  // Remove teammate
  const handleRemoveTeammate = (memberId: string) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.filter(m => m.id !== memberId),
    }));
    
    // Also remove this member from other members' dependencies
    setFormData(prev => ({
      ...prev,
      members: prev.members.map(m => ({
        ...m,
        dependsOn: m.dependsOn.filter(d => d !== memberId),
      })),
    }));
  };
  
  // Update teammate agent selection
  const handleTeammateAgentChange = (memberId: string, agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    setFormData(prev => ({
      ...prev,
      members: prev.members.map(m => 
        m.id === memberId 
          ? { ...m, agentId, agent, overrideModel: null, overrideTools: null }
          : m
      ),
    }));
  };
  
  // Update teammate override model
  const handleTeammateModelChange = (memberId: string, model: string) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.map(m => 
        m.id === memberId 
          ? { ...m, overrideModel: model || null }
          : m
      ),
    }));
  };
  
  // Update teammate dependency
  const handleDependencyChange = (memberId: string, dependsOnIds: string[]) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.map(m => 
        m.id === memberId 
          ? { ...m, dependsOn: dependsOnIds }
          : m
      ),
    }));
  };
  
  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.name.trim()) {
      newErrors.name = '团队名称不能为空';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = '团队名称至少需要2个字符';
    } else if (formData.name.trim().length > 100) {
      newErrors.name = '团队名称不能超过100个字符';
    }
    
    if (!formData.leadAgentId) {
      newErrors.leadAgentId = '必须选择 Lead Agent';
    }
    
    if (formData.maxTeammates < 1 || formData.maxTeammates > 10) {
      newErrors.maxTeammates = '最大成员数必须在 1-10 之间';
    }
    
    // Check for duplicate agents in members
    const agentIds = formData.members.map(m => m.agentId).filter(id => id);
    const uniqueAgentIds = new Set(agentIds);
    if (agentIds.length !== uniqueAgentIds.size) {
      newErrors.members = '团队成员不能重复选择同一个 Agent';
    }
    
    // Check for members without agent selection
    const emptyMembers = formData.members.filter(m => !m.agentId);
    if (emptyMembers.length > 0) {
      newErrors.members = '所有团队成员必须选择 Agent';
    }
    
    // Check circular dependency
    if (hasCircularDep) {
      newErrors.dependencies = '检测到循环依赖，请检查依赖配置';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  // Save team
  const handleSave = async () => {
    if (!validateForm()) {
      toast.error('请检查表单错误');
      return;
    }
    
    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      
      // Build dependencies array for API
      const dependencies: { from: string; to: string }[] = [];
      for (const member of formData.members) {
        for (const depId of member.dependsOn) {
          dependencies.push({ from: member.id, to: depId });
        }
      }
      
      const response = await fetch('/api/agent-teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          leadAgentId: formData.leadAgentId,
          taskStrategy: formData.taskStrategy,
          maxTeammates: formData.maxTeammates,
          members: formData.members
            .filter(m => m.agentId)
            .map(m => ({
              agentId: m.agentId,
              role: m.role,
              overrideModel: m.overrideModel,
              overrideTools: m.overrideTools,
            })),
          dependencies,
          ralphConfig: formData.ralphConfig.enabled ? formData.ralphConfig : null,
        }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '创建团队失败');
      }
      
      const data = await response.json();
      setSavedTeamId(data.team.id);
      toast.success('团队创建成功');
      
      // Redirect to edit page after short delay
      setTimeout(() => {
        router.push(`/dashboard/agent-teams/${data.team.id}`);
      }, 500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建团队失败');
    } finally {
      setSaving(false);
    }
  };
  
  // Execute team (only after save)
  const handleExecute = async () => {
    if (!savedTeamId) {
      toast.error('请先保存团队');
      return;
    }
    
    if (!canExecute) {
      toast.error('您没有执行 Agent 团队的权限');
      return;
    }
    
    try {
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/agent-teams/${savedTeamId}/execute`, {
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
      
      // Navigate to execution monitoring page
      if (data.executionId) {
        router.push(`/dashboard/agent-teams/${savedTeamId}/execution/${data.executionId}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '执行失败');
    }
  };
  
  // Get available models (from agents)
  const availableModels = Array.from(new Set(agents.map(a => a.model))).sort();
  
  // Get available tools (from agents)
  const availableTools = Array.from(
    new Set(agents.flatMap(a => a.allowedTools || []))
  ).sort();
  
  if (!canCreate) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">权限不足</h3>
          <p className="mt-2 text-sm text-gray-600">您没有创建 Agent 团队的权限</p>
          <Link
            href="/dashboard/agent-teams"
            className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <ArrowLeft size={16} className="mr-2" />
            返回列表
          </Link>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
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
            <h1 className="text-2xl font-bold text-gray-900">创建 Agent 团队</h1>
            <p className="mt-1 text-sm text-gray-600">
              配置 Lead Agent 和团队成员，设置执行策略
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
            <span>{saving ? '保存中...' : '保存团队'}</span>
          </button>
          
          {savedTeamId && canExecute && (
            <button
              onClick={handleExecute}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              <Play size={20} />
              <span>执行团队</span>
            </button>
          )}
        </div>
      </div>
      
      {/* Form */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-6">
        {/* Basic Info Section */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Users size={20} className="mr-2" />
            基本信息
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Team Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                团队名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  errors.name ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="输入团队名称"
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-500">{errors.name}</p>
              )}
            </div>
            
            {/* Task Strategy */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                执行策略
              </label>
              <select
                value={formData.taskStrategy}
                onChange={(e) => setFormData(prev => ({ ...prev, taskStrategy: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="parallel">并行执行</option>
                <option value="sequential">顺序执行</option>
                <option value="hierarchical">层级执行</option>
              </select>
            </div>
            
            {/* Max Teammates */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                最大成员数
              </label>
              <input
                type="number"
                value={formData.maxTeammates}
                onChange={(e) => setFormData(prev => ({ ...prev, maxTeammates: parseInt(e.target.value) || 5 }))}
                min={1}
                max={10}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  errors.maxTeammates ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.maxTeammates && (
                <p className="mt-1 text-sm text-red-500">{errors.maxTeammates}</p>
              )}
            </div>
            
            {/* Description */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                团队描述
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="描述团队的功能和用途"
              />
            </div>
          </div>
        </div>
        
        {/* Lead Agent Section */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Settings size={20} className="mr-2" />
            Lead Agent <span className="text-red-500">*</span>
          </h2>
          
          {loadingAgents ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-blue-500" />
            </div>
          ) : (
            <div>
              <select
                value={formData.leadAgentId}
                onChange={(e) => setFormData(prev => ({ ...prev, leadAgentId: e.target.value }))}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  errors.leadAgentId ? 'border-red-500' : 'border-gray-300'
                }`}
              >
                <option value="">选择 Lead Agent...</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.displayName || agent.name} ({agent.category}) - {agent.model}
                  </option>
                ))}
              </select>
              {errors.leadAgentId && (
                <p className="mt-1 text-sm text-red-500">{errors.leadAgentId}</p>
              )}
              
              {/* Show selected agent details */}
              {formData.leadAgentId && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                  {(() => {
                    const selectedAgent = agents.find(a => a.id === formData.leadAgentId);
                    if (!selectedAgent) return null;
                    return (
                      <div className="space-y-2">
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">模型:</span> {selectedAgent.model}
                        </p>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">描述:</span> {selectedAgent.description}
                        </p>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">工具:</span> {selectedAgent.allowedTools?.join(', ') || '无'}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Teammates Section */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center justify-between">
            <div className="flex items-center">
              <Users size={20} className="mr-2" />
              团队成员 ({formData.members.length}/{formData.maxTeammates})
            </div>
            <button
              onClick={handleAddTeammate}
              disabled={formData.members.length >= formData.maxTeammates}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} />
              <span>添加成员</span>
            </button>
          </h2>
          
          {errors.members && (
            <p className="mb-3 text-sm text-red-500">{errors.members}</p>
          )}
          
          {formData.members.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <Users className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">暂无团队成员，点击"添加成员"开始配置</p>
            </div>
          ) : (
            <div className="space-y-4">
              {formData.members.map((member, index) => (
                <div
                  key={member.id}
                  className="border border-gray-200 rounded-lg p-4 bg-gray-50"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-gray-900">
                      成员 #{index + 1}
                    </h3>
                    <button
                      onClick={() => handleRemoveTeammate(member.id)}
                      className="p-1 text-red-600 hover:bg-red-100 rounded"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Agent Selection */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Agent
                      </label>
                      <select
                        value={member.agentId}
                        onChange={(e) => handleTeammateAgentChange(member.id, e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">选择 Agent...</option>
                        {agents
                          .filter(a => a.id !== formData.leadAgentId) // Exclude lead agent
                          .map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.displayName || agent.name} ({agent.model})
                            </option>
                          ))}
                      </select>
                    </div>
                    
                    {/* Model Override */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        模型覆盖 (可选)
                      </label>
                      <select
                        value={member.overrideModel || ''}
                        onChange={(e) => handleTeammateModelChange(member.id, e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">使用默认模型</option>
                        {availableModels.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    {/* Dependencies */}
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center">
                        <Link2 size={14} className="mr-1" />
                        依赖关系 (可选)
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {formData.members
                          .filter(m => m.id !== member.id && m.agentId) // Exclude self and members without agent
                          .map((otherMember) => {
                            const otherAgent = agents.find(a => a.id === otherMember.agentId);
                            return (
                              <button
                                key={otherMember.id}
                                onClick={() => {
                                  const currentDeps = member.dependsOn;
                                  const newDeps = currentDeps.includes(otherMember.id)
                                    ? currentDeps.filter(d => d !== otherMember.id)
                                    : [...currentDeps, otherMember.id];
                                  handleDependencyChange(member.id, newDeps);
                                }}
                                className={`px-2 py-1 text-xs rounded border ${
                                  member.dependsOn.includes(otherMember.id)
                                    ? 'bg-blue-100 text-blue-800 border-blue-300'
                                    : 'bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200'
                                }`}
                              >
                                {otherAgent?.displayName || otherAgent?.name || '未知'}
                              </button>
                            );
                          })}
                        {formData.members.filter(m => m.id !== member.id && m.agentId).length === 0 && (
                          <span className="text-xs text-gray-500">暂无其他成员可选</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Show selected agent info */}
                  {member.agent && (
                    <div className="mt-2 text-xs text-gray-500">
                      默认模型: {member.agent.model} | 工具: {member.agent.allowedTools?.slice(0, 3).join(', ') || '无'}...
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Circular Dependency Warning */}
        {hasCircularDep && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
            <AlertTriangle className="text-red-500 mr-3 mt-0.5" size={20} />
            <div>
              <h3 className="text-sm font-medium text-red-800">检测到循环依赖</h3>
              <p className="text-sm text-red-600 mt-1">
                团队成员之间存在循环依赖关系，这将导致执行失败。请检查并修正依赖配置。
              </p>
            </div>
          </div>
        )}
        
        {errors.dependencies && !hasCircularDep && (
          <p className="text-sm text-red-500">{errors.dependencies}</p>
        )}
        
        {/* Ralph Loop Configuration */}
        <div>
          <RalphLoopConfigPanel
            config={formData.ralphConfig}
            onChange={(config) => setFormData(prev => ({ ...prev, ralphConfig: config }))}
            disabled={saving}
          />
        </div>
      </div>
    </div>
  );
}