'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  TrendingUp,
  Award,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
  Settings,
  RefreshCw,
  Save,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Play,
  Target,
  Activity,
  History,
  Zap,
} from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Alert } from '@/components/ui/Alert';
import { SkillEvolutionArchitecture } from '@/components/skills/SkillEvolutionArchitecture';
import { PromptManagerButton } from '@/components/skills/PromptManager';

// Types
interface EvolutionOverview {
  totalSkills: number;
  skillsWithData: number;
  averagePrecision: number;
  totalFindings: number;
  totalConfirmed: number;
  totalFalsePositives: number;
  skillsNeedingEvolution: number;
  evolutionHistoryCount: number;
}

interface TaskStats {
  pending: number;
  analyzing: number;
  completed: number;
  rejected: number;
  total: number;
}

interface EvolutionConfig {
  precisionThreshold: number;
  minFalsePositives: number;
  minConfirmed: number;
  maxDailyTasks: number;
  isActive: boolean;
}

interface SkillNeedingEvolution {
  skillId: string;
  skillName: string;
  displayName: string;
  totalExecutions: number;
  successExecCount: number;
  successRate: number;
  totalFindings: number;
  confirmedCount: number;
  falsePositiveCount: number;
  precision: number;
}

interface EvolutionTask {
  id: string;
  skillId: string;
  triggerReason: string;
  falsePositiveCount: number;
  confirmedCount: number;
  precisionBefore: number | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  Skill: {
    id: string;
    name: string;
    displayName: string;
  };
}

interface MetricsResponse {
  overview: EvolutionOverview;
  taskStats: TaskStats;
  config: EvolutionConfig;
  skillsNeedingEvolution: SkillNeedingEvolution[];
  skillsPagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface TasksResponse {
  tasks: EvolutionTask[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  stats: TaskStats;
}

interface ConfigResponse {
  config: {
    id: string;
    precisionThreshold: number;
    minFalsePositives: number;
    minConfirmed: number;
    falsePositiveLimit: number;
    confirmedLimit: number;
    scheduleCron: string;
    maxDailyTasks: number;
    maxDescriptionLength: number;
    codeSnippetLines: number;
    isActive: boolean;
    updatedAt: string;
  };
}

export default function SkillsEvolutionPage() {
  return (
    <AdminGuard>
      <SkillsEvolutionContent />
    </AdminGuard>
  );
}

function SkillsEvolutionContent() {
  const router = useRouter();
  
  // State
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [tasks, setTasks] = useState<TasksResponse | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Config editing state
  const [editingConfig, setEditingConfig] = useState(false);
  const [configForm, setConfigForm] = useState({
    precisionThreshold: 0.7,
    minFalsePositives: 5,
    minConfirmed: 3,
    maxDailyTasks: 10,
    isActive: true,
  });
  const [savingConfig, setSavingConfig] = useState(false);
  
  // Expanded sections
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  
  // Pagination for tasks
  const [tasksPage, setTasksPage] = useState(1);
  const tasksLimit = 10;
  
  // Pagination for skills needing evolution
  const [skillsPage, setSkillsPage] = useState(1);
  const skillsLimit = 20;

  // Fetch all data on mount
  useEffect(() => {
    fetchAllData();
  }, []);

  // Fetch tasks when page changes
  useEffect(() => {
    if (!loading) {
      fetchTasks();
    }
  }, [tasksPage]);

  // Fetch metrics when skills page changes
  useEffect(() => {
    if (!loading) {
      fetchMetrics();
    }
  }, [skillsPage]);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      // Fetch metrics, tasks, and config in parallel
      const [metricsRes, tasksRes, configRes] = await Promise.all([
        fetch(`/api/skills/evolution/metrics?skillsPage=${skillsPage}&skillsLimit=${skillsLimit}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/skills/evolution/tasks?page=${tasksPage}&limit=${tasksLimit}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/skills/evolution/config', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!metricsRes.ok || !tasksRes.ok || !configRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const metricsData = await metricsRes.json();
      const tasksData = await tasksRes.json();
      const configData = await configRes.json();

      setMetrics(metricsData);
      setTasks(tasksData);
      setConfig(configData);
      
      // Initialize config form
      setConfigForm({
        precisionThreshold: configData.config.precisionThreshold,
        minFalsePositives: configData.config.minFalsePositives,
        minConfirmed: configData.config.minConfirmed,
        maxDailyTasks: configData.config.maxDailyTasks,
        isActive: configData.config.isActive,
      });
      
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchTasks = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/evolution/tasks?page=${tasksPage}&limit=${tasksLimit}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch tasks');
      }

      const data = await response.json();
      setTasks(data);
    } catch (err) {
      console.error('Error fetching tasks:', err);
    }
  };

  const fetchMetrics = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/evolution/metrics?skillsPage=${skillsPage}&skillsLimit=${skillsLimit}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch metrics');
      }

      const data = await response.json();
      setMetrics(data);
    } catch (err) {
      console.error('Error fetching metrics:', err);
    }
  };

  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/skills/evolution/config', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(configForm),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '保存失败');
      }

      const data = await response.json();
      setConfig(data);
      setEditingConfig(false);
      toast.success('配置已保存');
      
      // Refresh metrics to reflect new threshold
      fetchAllData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleResetConfig = async () => {
    if (!confirm('确定要重置为默认配置吗？')) {
      return;
    }

    try {
      setSavingConfig(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/skills/evolution/config', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'reset' }),
      });

      if (!response.ok) {
        throw new Error('重置失败');
      }

      const data = await response.json();
      setConfig(data);
      setConfigForm({
        precisionThreshold: data.config.precisionThreshold,
        minFalsePositives: data.config.minFalsePositives,
        minConfirmed: data.config.minConfirmed,
        maxDailyTasks: data.config.maxDailyTasks,
        isActive: data.config.isActive,
      });
      setEditingConfig(false);
      toast.success('配置已重置为默认值');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重置失败');
    } finally {
      setSavingConfig(false);
    }
  };

  // Navigation handlers
  const navigateToVulnerabilities = (skillId: string, status: 'false-positive' | 'confirmed') => {
    router.push(`/vulnerabilities?skillId=${skillId}&status=${status}`);
  };

  const navigateToSkillDetail = (skillId: string) => {
    router.push(`/dashboard/skills/${skillId}`);
  };

  const navigateToAnalysis = (taskId: string) => {
    router.push(`/dashboard/admin/skills-evolution/analysis/${taskId}`);
  };

  // Manual trigger evolution for a skill
  const handleManualTriggerEvolution = async (skillId: string) => {
    if (!confirm('确定要手动触发此 Skill 的进化分析吗？')) {
      return;
    }
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}/analyze`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '触发失败');
      }
      
      const data = await response.json();
      toast.success('进化分析已完成');
      
      if (data.taskId) {
        router.push(`/dashboard/admin/skills-evolution/analysis/${data.taskId}`);
      } else {
        fetchAllData();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '触发失败');
    }
  };

  // Re-trigger pending evolution task
  const handleTriggerEvolution = async (skillId: string, taskId: string) => {
    if (!confirm('确定要触发此任务的进化分析吗？')) {
      return;
    }
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/evolution/tasks/${taskId}/trigger`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '触发失败');
      }
      
      toast.success('进化分析已触发');
      fetchAllData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '触发失败');
    }
  };

  // Format precision as percentage
  const formatPrecision = (value: number | null) => {
    if (value === null) return 'N/A';
    return `${(value * 100).toFixed(1)}%`;
  };

  // Get status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30';
      case 'analyzing':
        return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
      case 'completed':
        return 'bg-green-500/20 text-green-400 border border-green-500/30';
      case 'rejected':
        return 'bg-red-500/20 text-red-400 border border-red-500/30';
      default:
        return 'bg-dark-surface-hover text-gray-400';
    }
  };

  // Get trigger reason label
  const getTriggerReasonLabel = (reason: string) => {
    switch (reason) {
      case 'low_precision':
        return '低精准率';
      case 'high_false_positive':
        return '高误报数';
      case 'manual':
        return '手动触发';
      default:
        return reason;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" text="加载进化数据..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
              <TrendingUp size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Skills 进化管理</h1>
              <p className="text-sm text-gray-400 mt-0.5">管理 AI 技能的进化和优化</p>
            </div>
          </div>
        </div>
        <Alert type="error">{error}</Alert>
        <button
          onClick={fetchAllData}
          className="group flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 bg-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400"
        >
          <RefreshCw size={18} className="transition-transform group-hover:rotate-90 duration-200" />
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <TrendingUp size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Skills 进化管理</h1>
            <p className="text-sm text-gray-400 mt-0.5">监控 Skill 精准率，自动触发进化优化</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchAllData}
            className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            <RefreshCw size={20} className="mr-2" />
            刷新数据
          </button>
        </div>
      </div>

      {/* Evolution Architecture Diagram */}
<SkillEvolutionArchitecture />

        {/* Prompt Config Button */}
        <div className="flex justify-end">
          <PromptManagerButton />
        </div>

        {/* Global Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Skills */}
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">总 Skills</p>
              <p className="text-2xl font-bold text-gray-100">{metrics?.overview.totalSkills || 0}</p>
              <p className="text-xs text-gray-400 mt-1">
                有数据: {metrics?.overview.skillsWithData || 0}
              </p>
            </div>
            <div className="p-3 bg-purple-100 rounded-lg">
              <Award className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </div>

        {/* Average Precision */}
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">平均精准率</p>
              <p className="text-2xl font-bold text-gray-100">
                {formatPrecision(metrics?.overview.averagePrecision || 0)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                阈值: {formatPrecision(metrics?.config.precisionThreshold || 0.7)}
              </p>
            </div>
            <div className={`p-3 rounded-lg ${
              (metrics?.overview.averagePrecision || 0) >= (metrics?.config.precisionThreshold || 0.7)
                ? 'bg-green-100'
                : 'bg-yellow-100'
            }`}>
              <Target className={`h-6 w-6 ${
                (metrics?.overview.averagePrecision || 0) >= (metrics?.config.precisionThreshold || 0.7)
                  ? 'text-green-400'
                  : 'text-yellow-400'
              }`} />
            </div>
          </div>
        </div>

        {/* Evolution Tasks */}
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">进化任务</p>
              <p className="text-2xl font-bold text-gray-100">{metrics?.taskStats.total || 0}</p>
              <p className="text-xs text-gray-400 mt-1">
                待处理: {metrics?.taskStats.pending || 0} | 分析中: {metrics?.taskStats.analyzing || 0}
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <Activity className="h-6 w-6 text-blue-400" />
            </div>
          </div>
        </div>

        {/* Evolution History */}
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">进化历史</p>
              <p className="text-2xl font-bold text-gray-100">{metrics?.overview.evolutionHistoryCount || 0}</p>
              <p className="text-xs text-gray-400 mt-1">
                完成: {metrics?.taskStats.completed || 0} | 拒绝: {metrics?.taskStats.rejected || 0}
              </p>
            </div>
            <div className="p-3 bg-indigo-100 rounded-lg">
              <History className="h-6 w-6 text-indigo-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Findings Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500">正确发现</p>
              <p className="text-xl font-bold text-green-400">{metrics?.overview.totalConfirmed || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <XCircle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500">误报</p>
              <p className="text-xl font-bold text-red-400">{metrics?.overview.totalFalsePositives || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <BarChart3 className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500">总发现数</p>
              <p className="text-xl font-bold text-blue-400">{metrics?.overview.totalFindings || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Evolution Config Section */}
      <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-[#162032] border-b border-gray-700/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-100">进化配置</h2>
          </div>
          <div className="flex items-center gap-2">
            {config?.config.isActive ? (
              <span className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded-full border border-green-500/30">
                已启用
              </span>
            ) : (
              <span className="px-2 py-1 text-xs bg-gray-500/20 text-gray-400 rounded-full border border-gray-500/30">
                已禁用
              </span>
            )}
            {!editingConfig && (
              <button
                onClick={() => setEditingConfig(true)}
                className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 border border-blue-500/30"
              >
                <Settings size={16} className="mr-1" />
                编辑
              </button>
            )}
          </div>
        </div>
        
        <div className="p-4">
          {editingConfig ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    精准率阈值 (0-1)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={configForm.precisionThreshold}
                    onChange={(e) => setConfigForm({ ...configForm, precisionThreshold: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">低于此值的 Skill 将触发进化</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    最小误报数
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={configForm.minFalsePositives}
                    onChange={(e) => setConfigForm({ ...configForm, minFalsePositives: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">至少需要这么多误报才能触发进化</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    最小确认数
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={configForm.minConfirmed}
                    onChange={(e) => setConfigForm({ ...configForm, minConfirmed: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">至少需要这么多确认才能触发进化</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    每日最大任务数
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={configForm.maxDailyTasks}
                    onChange={(e) => setConfigForm({ ...configForm, maxDailyTasks: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">每天最多创建的进化任务数</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={configForm.isActive}
                    onChange={(e) => setConfigForm({ ...configForm, isActive: e.target.checked })}
                    className="w-4 h-4 text-blue-400 border-gray-600 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-300">启用自动进化</span>
                </label>
              </div>
              
              <div className="flex items-center gap-3 pt-4 border-t border-gray-700/50">
                <button
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingConfig ? (
                    <>
                      <RefreshCw size={16} className="mr-2 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Save size={16} className="mr-2" />
                      保存配置
                    </>
                  )}
                </button>
                <button
                  onClick={handleResetConfig}
                  disabled={savingConfig}
                  className="inline-flex items-center px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-dark-surface-hover disabled:opacity-50"
                >
                  重置为默认
                </button>
                <button
                  onClick={() => {
                    setEditingConfig(false);
                    setConfigForm({
                      precisionThreshold: config?.config.precisionThreshold || 0.7,
                      minFalsePositives: config?.config.minFalsePositives || 5,
                      minConfirmed: config?.config.minConfirmed || 3,
                      maxDailyTasks: config?.config.maxDailyTasks || 10,
                      isActive: config?.config.isActive || true,
                    });
                  }}
                  className="inline-flex items-center px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-dark-surface-hover"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-500">精准率阈值</p>
                <p className="text-lg font-semibold text-gray-100">
                  {formatPrecision(config?.config.precisionThreshold || 0.7)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">最小误报数</p>
                <p className="text-lg font-semibold text-gray-100">
                  {config?.config.minFalsePositives || 5}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">最小确认数</p>
                <p className="text-lg font-semibold text-gray-100">
                  {config?.config.minConfirmed || 3}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">每日最大任务数</p>
                <p className="text-lg font-semibold text-gray-100">
                  {config?.config.maxDailyTasks || 10}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Skills Needing Evolution */}
      <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-[#162032] border-b border-gray-700/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-400" />
            <h2 className="text-lg font-semibold text-gray-100">待进化 Skills</h2>
            <span className="px-2 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded-full border border-yellow-500/30">
              {metrics?.overview.skillsNeedingEvolution || 0} 个
            </span>
          </div>
        </div>
        
        {/* 触发条件说明 */}
        <div className="px-4 py-2 bg-blue-900/20 border-b border-blue-500/30">
          <div className="text-xs text-blue-300">
            <span className="font-medium text-blue-200">触发条件：</span> 有执行记录 + 有误报记录 + 精准率 &lt; {formatPrecision(metrics?.config.precisionThreshold || 0.7)}
            <span className="mx-2 text-blue-400/50">|</span>
            <span className="font-medium text-blue-200">精准率公式：</span> confirmedCount / (confirmedCount + falsePositiveCount)
          </div>
        </div>
        
        <div className="divide-y divide-gray-700/50">
          {metrics?.skillsNeedingEvolution.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle className="mx-auto h-12 w-12 text-green-400" />
              <p className="mt-2 text-sm text-gray-400">
                所有 Skills 精准率达标，无需进化
              </p>
            </div>
          ) : (
            metrics?.skillsNeedingEvolution.map((skill) => (
              <div key={skill.skillId} className="p-4">
                <div
                  className="cursor-pointer hover:bg-[#0F172A] transition-colors -mx-4 -my-4 px-4 py-4"
                  onClick={() => setExpandedSkill(expandedSkill === skill.skillId ? null : skill.skillId)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-yellow-100 rounded-lg">
                        <AlertTriangle className="h-5 w-5 text-yellow-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-100">{skill.displayName}</h3>
                        <p className="text-sm text-gray-500">{skill.skillName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-4 text-sm">
                        <div className="text-center">
                          <p className="text-xs text-gray-500">执行次数</p>
                          <p className="font-medium text-gray-100">{skill.totalExecutions}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500">发现漏洞</p>
                          <p className="font-medium text-gray-100">{skill.totalFindings}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500">已确认</p>
                          <p className="font-medium text-green-400">{skill.confirmedCount}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500">误报</p>
                          <p className="font-medium text-red-400">{skill.falsePositiveCount}</p>
                        </div>
                        <div className="text-center px-3 py-1 bg-red-900/20 rounded">
                          <p className="text-xs text-gray-500">精准率</p>
                          <p className="font-semibold text-red-400">{formatPrecision(skill.precision)}</p>
                        </div>
                      </div>
                      {expandedSkill === skill.skillId ? (
                        <ChevronUp size={20} className="text-gray-400" />
                      ) : (
                        <ChevronDown size={20} className="text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>
                
                {expandedSkill === skill.skillId && (
                  <div className="mt-4 pt-4 border-t border-gray-700/50 bg-[#0F172A] -mx-4 px-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigateToSkillDetail(skill.skillId)}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 border border-blue-500/30"
                      >
                        <ExternalLink size={16} className="mr-1" />
                        详情
                      </button>
                      <button
                        onClick={() => handleManualTriggerEvolution(skill.skillId)}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-yellow-500/20 text-yellow-400 rounded hover:bg-yellow-500/30 border border-yellow-500/30"
                      >
                        <Play size={16} className="mr-1" />
                        触发进化
                      </button>
                      <button
                        onClick={() => navigateToVulnerabilities(skill.skillId, 'false-positive')}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 border border-red-500/30"
                      >
                        <XCircle size={16} className="mr-1" />
                        查看误报
                      </button>
                      <button
                        onClick={() => navigateToVulnerabilities(skill.skillId, 'confirmed')}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 border border-green-500/30"
                      >
                        <CheckCircle size={16} className="mr-1" />
                        查看正确发现
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        
        {/* Pagination for skills needing evolution */}
        {metrics?.skillsPagination?.totalPages && metrics.skillsPagination.totalPages > 1 && (
          <div className="px-4 py-3 bg-[#0F172A] border-t border-gray-700/50 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              第 {skillsPage} / {metrics.skillsPagination.totalPages} 页 (共 {metrics.skillsPagination.total} 个)
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSkillsPage(Math.max(1, skillsPage - 1))}
                disabled={skillsPage === 1}
                className="p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronDown size={16} className="rotate-90" />
              </button>
              <button
                onClick={() => setSkillsPage(Math.min(metrics.skillsPagination.totalPages, skillsPage + 1))}
                disabled={skillsPage === metrics.skillsPagination.totalPages}
                className="p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronUp size={16} className="rotate-90" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Evolution Task History */}
      <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-[#162032] border-b border-gray-700/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-100">进化任务历史</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">
              共 {tasks?.pagination.total || 0} 条记录
            </span>
          </div>
        </div>
        
        <div className="divide-y divide-gray-700/50">
          {tasks?.tasks.length === 0 ? (
            <div className="p-8 text-center">
              <Clock className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-400">
                暂无进化任务记录
              </p>
            </div>
          ) : (
            tasks?.tasks.map((task) => (
              <div key={task.id} className="p-4">
                <div
                  className="cursor-pointer hover:bg-[#0F172A] transition-colors -mx-4 -my-4 px-4 py-4"
                  onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${
                        task.status === 'completed' ? 'bg-green-100' :
                        task.status === 'rejected' ? 'bg-red-100' :
                        task.status === 'analyzing' ? 'bg-blue-100' :
                        'bg-yellow-100'
                      }`}>
                        {task.status === 'completed' ? (
                          <CheckCircle className="h-5 w-5 text-green-400" />
                        ) : task.status === 'rejected' ? (
                          <XCircle className="h-5 w-5 text-red-400" />
                        ) : task.status === 'analyzing' ? (
                          <Play className="h-5 w-5 text-blue-400" />
                        ) : (
                          <Clock className="h-5 w-5 text-yellow-400" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-100">{task.Skill.displayName}</h3>
                        <p className="text-sm text-gray-500">{task.Skill.name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(task.status)}`}>
                          {task.status === 'pending' ? '待处理' :
                           task.status === 'analyzing' ? '分析中' :
                           task.status === 'completed' ? '已完成' :
                           task.status === 'rejected' ? '已拒绝' : task.status}
                        </span>
                        <span className="px-2 py-1 text-xs bg-dark-surface-hover text-gray-400 rounded-full">
                          {getTriggerReasonLabel(task.triggerReason)}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">
                          {new Date(task.createdAt).toLocaleDateString('zh-CN')}
                        </p>
                      </div>
                      {expandedTask === task.id ? (
                        <ChevronUp size={20} className="text-gray-400" />
                      ) : (
                        <ChevronDown size={20} className="text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>
                
                {expandedTask === task.id && (
                  <div className="mt-4 pt-4 border-t border-gray-700/50 bg-[#0F172A] -mx-4 px-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-gray-500">触发原因</p>
                        <p className="text-sm font-medium text-gray-100">
                          {getTriggerReasonLabel(task.triggerReason)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">误报数</p>
                        <p className="text-sm font-medium text-red-400">
                          {task.falsePositiveCount}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">确认数</p>
                        <p className="text-sm font-medium text-green-400">
                          {task.confirmedCount}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">进化前精准率</p>
                        <p className="text-sm font-medium text-gray-100">
                          {formatPrecision(task.precisionBefore)}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigateToSkillDetail(task.skillId)}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 border border-blue-500/30"
                      >
                        <ExternalLink size={16} className="mr-1" />
                        Skill 详情
                      </button>
                      {(task.status === 'completed' || task.status === 'rejected' || task.status === 'analyzing') && (
                        <button
                          onClick={() => navigateToAnalysis(task.id)}
                          className="inline-flex items-center px-3 py-1.5 text-sm bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 border border-green-500/30"
                        >
                          <Zap size={16} className="mr-1" />
                          查看分析
                        </button>
                      )}
                      {task.status === 'pending' && (
                        <button
                          onClick={() => handleTriggerEvolution(task.skillId, task.id)}
                          className="inline-flex items-center px-3 py-1.5 text-sm bg-purple-500/20 text-purple-400 rounded hover:bg-purple-500/30 border border-purple-500/30"
                        >
                          <Play size={16} className="mr-1" />
                          触发分析
                        </button>
                      )}
                    </div>
                    
                    {task.completedAt && (
                      <p className="text-xs text-gray-500 mt-2">
                        完成时间: {new Date(task.completedAt).toLocaleString('zh-CN')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        
        {/* Pagination */}
        {tasks?.pagination?.totalPages && tasks.pagination.totalPages > 1 && (
          <div className="px-4 py-3 bg-[#0F172A] border-t border-gray-700/50 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              第 {tasksPage} / {tasks.pagination.totalPages} 页
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTasksPage(Math.max(1, tasksPage - 1))}
                disabled={tasksPage === 1}
                className="p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronDown size={16} className="rotate-90" />
              </button>
              <button
                onClick={() => setTasksPage(Math.min(tasks.pagination.totalPages, tasksPage + 1))}
                disabled={tasksPage === tasks.pagination.totalPages}
                className="p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronUp size={16} className="rotate-90" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}