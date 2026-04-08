'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Award,
  ArrowLeft,
  Play,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  AlertTriangle,
  Code,
  History,
  Copy,
  Save,
  X,
} from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe: string | null;
  severity: string;
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
  parameters: Record<string, unknown>;
  isActive: boolean;
  isBuiltin: boolean;
  version: number;
  successRate: number | null;
  avgDuration: number | null;
  execCount: number;
  createdAt: string;
  updatedAt: string;
  executions?: Execution[];
  evolutions?: Evolution[];
}

interface Execution {
  id: string;
  status: string;
  findingsCount: number;
  confirmedCount: number;
  falsePositiveCount: number;
  duration: number | null;
  createdAt: string;
}

interface Evolution {
  id: string;
  changeType: string;
  changeDesc: string;
  reason: string;
  fromVersion: number;
  toVersion: number;
  beforeRate: number | null;
  afterRate: number | null;
  createdAt: string;
}

const categoryLabels: Record<string, string> = {
  'code-audit': '代码安全审计',
  'auth': '认证与授权',
  'sensitive': '敏感信息泄露',
  'api': 'API 安全',
  'config': '依赖与配置',
  'crypto': '加密与数据',
  'web': 'Web 安全',
  'business': '业务逻辑',
  'client': '客户端安全',
  'cloud': '云与容器安全',
};

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
  info: 'bg-gray-100 text-gray-800 border-gray-200',
};

const severityLabels: Record<string, string> = {
  critical: '严重',
  high: '高危',
  medium: '中危',
  low: '低危',
  info: '信息',
};

export default function SkillDetailPage() {
  const router = useRouter();
  const params = useParams();
  const skillId = params?.id as string;

  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'prompt' | 'test' | 'executions' | 'evolutions'>('overview');
  const [user, setUser] = useState<{ roles?: string[] } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<{
    displayName: string;
    description: string;
    category: string;
    cwe: string;
    severity: string;
    systemPrompt: string;
    userPrompt: string;
    tools: string[];
    isActive: boolean;
  }>({
    displayName: '',
    description: '',
    category: '',
    cwe: '',
    severity: '',
    systemPrompt: '',
    userPrompt: '',
    tools: [],
    isActive: true,
  });
  // 测试相关状态
  const [testMode, setTestMode] = useState<'project' | 'code'>('code');
  const [testProjectId, setTestProjectId] = useState('');
  const [testCode, setTestCode] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: string;
    summary: string;
    vulnerabilities: Array<{
      title: string;
      description: string;
      severity: string;
      filePath?: string;
      lineStart?: number;
    }>;
    toolCalls: Array<{ tool: string; parameters: Record<string, unknown>; result: unknown }>;
    duration: number;
    error?: string;
  } | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
  }, []);

  useEffect(() => {
    if (skillId) {
      fetchSkill();
    }
  }, [skillId]);

  useEffect(() => {
    // 获取项目列表用于测试
    const fetchProjects = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/projects', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setProjects(data.projects || []);
        }
      } catch (err) {
        console.error('获取项目列表失败:', err);
      }
    };
    fetchProjects();
  }, []);

  const fetchSkill = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取 Skill 详情失败');
      }

      const data = await response.json();
      setSkill(data.skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!skill || !confirm(`确定要删除 Skill "${skill.displayName}" 吗？`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }

      router.push('/dashboard/skills');
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleToggleActive = async () => {
    if (!skill) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: !skill.isActive }),
      });

      if (!response.ok) {
        throw new Error('更新失败');
      }

      fetchSkill();
    } catch (err) {
      alert(err instanceof Error ? err.message : '更新失败');
    }
  };

  const startEditing = () => {
    if (!skill) return;
    setEditForm({
      displayName: skill.displayName,
      description: skill.description,
      category: skill.category,
      cwe: skill.cwe || '',
      severity: skill.severity,
      systemPrompt: skill.systemPrompt,
      userPrompt: skill.userPrompt,
      tools: skill.tools,
      isActive: skill.isActive,
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!skill) return;

    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editForm),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '保存失败');
      }

      setIsEditing(false);
      fetchSkill();
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('已复制到剪贴板');
  };

  const handleTestSkill = async () => {
    if (!skill) return;
    if (testMode === 'project' && !testProjectId) {
      alert('请选择测试项目');
      return;
    }
    if (testMode === 'code' && !testCode.trim()) {
      alert('请输入测试代码');
      return;
    }

    setTestLoading(true);
    setTestResult(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}/test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: testMode,
          projectId: testMode === 'project' ? testProjectId : undefined,
          code: testMode === 'code' ? testCode : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '测试失败');
      }

      const data = await response.json();
      setTestResult(data.result);
    } catch (err) {
      setTestResult({
        status: 'failed',
        summary: '',
        vulnerabilities: [],
        toolCalls: [],
        duration: 0,
        error: err instanceof Error ? err.message : '测试失败',
      });
    } finally {
      setTestLoading(false);
    }
  };

  const isAdmin = user?.roles?.includes('admin');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回
        </button>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error || 'Skill 不存在'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-2xl font-bold text-gray-900">{skill.displayName}</h1>
              <span className={`px-2 py-0.5 text-xs font-medium rounded border ${severityColors[skill.severity] || 'bg-gray-100 text-gray-800'}`}>
                {severityLabels[skill.severity] || skill.severity}
              </span>
              {skill.isBuiltin && (
                <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded-full">
                  内置
                </span>
              )}
              {!skill.isActive && (
                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                  已禁用
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">{skill.name}</p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center space-x-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save size={16} className="mr-2" />
                  {saving ? '保存中...' : '保存'}
                </button>
                <button
                  onClick={cancelEditing}
                  disabled={saving}
                  className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200"
                >
                  <X size={16} className="mr-2" />
                  取消
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={startEditing}
                  className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-800 rounded-lg hover:bg-blue-200"
                >
                  <Edit size={16} className="mr-2" />
                  编辑
                </button>
                <button
                  onClick={handleToggleActive}
                  className={`inline-flex items-center px-4 py-2 rounded-lg ${
                    skill.isActive
                      ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                      : 'bg-green-100 text-green-800 hover:bg-green-200'
                  }`}
                >
                  {skill.isActive ? (
                    <>
                      <XCircle size={16} className="mr-2" />
                      禁用
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} className="mr-2" />
                      启用
                    </>
                  )}
                </button>
                {!skill.isBuiltin && (
                  <button
                    onClick={handleDelete}
                    className="inline-flex items-center px-4 py-2 bg-red-100 text-red-800 rounded-lg hover:bg-red-200"
                  >
                    <Trash2 size={16} className="mr-2" />
                    删除
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Play className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">执行次数</p>
              <p className="text-2xl font-bold text-gray-900">{skill.execCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <TrendingUp className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">成功率</p>
              <p className="text-2xl font-bold text-gray-900">
                {skill.successRate ? `${(skill.successRate * 100).toFixed(1)}%` : 'N/A'}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Clock className="h-6 w-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">平均耗时</p>
              <p className="text-2xl font-bold text-gray-900">
                {skill.avgDuration ? `${skill.avgDuration}ms` : 'N/A'}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Code className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">版本</p>
              <p className="text-2xl font-bold text-gray-900">v{skill.version}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {[
            { id: 'overview', label: '概览', icon: Award },
            { id: 'prompt', label: 'Prompt', icon: Code },
            { id: 'test', label: '测试', icon: Play },
            { id: 'executions', label: '执行历史', icon: History },
            { id: 'evolutions', label: '进化记录', icon: TrendingUp },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon size={16} className="mr-2" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {isEditing ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">显示名称</label>
                  <input
                    type="text"
                    value={editForm.displayName}
                    onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
                    <select
                      value={editForm.category}
                      onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      {Object.entries(categoryLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">严重程度</label>
                    <select
                      value={editForm.severity}
                      onChange={(e) => setEditForm({ ...editForm, severity: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      {Object.entries(severityLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CWE</label>
                  <input
                    type="text"
                    value={editForm.cwe}
                    onChange={(e) => setEditForm({ ...editForm, cwe: e.target.value })}
                    placeholder="例如: CWE-79"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">使用工具（逗号分隔）</label>
                  <input
                    type="text"
                    value={editForm.tools.join(', ')}
                    onChange={(e) => setEditForm({ ...editForm, tools: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">描述</h3>
                  <p className="text-gray-600">{skill.description}</p>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">分类</h3>
                    <p className="text-gray-600">{categoryLabels[skill.category] || skill.category}</p>
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">CWE</h3>
                    <p className="text-gray-600">{skill.cwe || '无'}</p>
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">使用工具</h3>
                  <div className="flex flex-wrap gap-2">
                    {skill.tools.map((tool) => (
                      <span key={tool} className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">参数定义</h3>
                  <pre className="bg-gray-50 p-4 rounded-lg overflow-x-auto text-sm">
                    {JSON.stringify(skill.parameters, null, 2)}
                  </pre>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'prompt' && (
          <div className="space-y-6">
            {isEditing ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">系统提示词</label>
                  <textarea
                    value={editForm.systemPrompt}
                    onChange={(e) => setEditForm({ ...editForm, systemPrompt: e.target.value })}
                    rows={10}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">用户提示词模板</label>
                  <textarea
                    value={editForm.userPrompt}
                    onChange={(e) => setEditForm({ ...editForm, userPrompt: e.target.value })}
                    rows={10}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-medium text-gray-900">系统提示词</h3>
                    <button
                      onClick={() => copyToClipboard(skill.systemPrompt)}
                      className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                    >
                      <Copy size={14} className="mr-1" />
                      复制
                    </button>
                  </div>
                  <pre className="bg-gray-50 p-4 rounded-lg overflow-x-auto text-sm whitespace-pre-wrap">
                    {skill.systemPrompt}
                  </pre>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-medium text-gray-900">用户提示词模板</h3>
                    <button
                      onClick={() => copyToClipboard(skill.userPrompt)}
                      className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                    >
                      <Copy size={14} className="mr-1" />
                      复制
                    </button>
                  </div>
                  <pre className="bg-gray-50 p-4 rounded-lg overflow-x-auto text-sm whitespace-pre-wrap">
                    {skill.userPrompt}
                  </pre>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'test' && (
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                测试功能可以帮助您验证Skill的提示词是否正确，以及工具调用是否符合预期。测试不会保存结果到数据库。
              </p>
            </div>

            {/* 测试模式选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">测试模式</label>
              <div className="flex space-x-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="code"
                    checked={testMode === 'code'}
                    onChange={() => setTestMode('code')}
                    className="mr-2"
                  />
                  <span className="text-sm">代码片段</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="project"
                    checked={testMode === 'project'}
                    onChange={() => setTestMode('project')}
                    className="mr-2"
                  />
                  <span className="text-sm">项目文件</span>
                </label>
              </div>
            </div>

            {/* 测试输入 */}
            {testMode === 'code' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">测试代码</label>
                <textarea
                  value={testCode}
                  onChange={(e) => setTestCode(e.target.value)}
                  rows={10}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  placeholder="粘贴要测试的代码片段..."
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">选择项目</label>
                <select
                  value={testProjectId}
                  onChange={(e) => setTestProjectId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">请选择项目</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {projects.length === 0 && (
                  <p className="mt-1 text-sm text-gray-500">暂无项目，请先在「我的项目」中创建项目</p>
                )}
              </div>
            )}

            {/* 执行按钮 */}
            <div className="flex justify-end">
              <button
                onClick={handleTestSkill}
                disabled={testLoading || !skill?.isActive}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    测试中...
                  </>
                ) : (
                  <>
                    <Play size={16} className="mr-2" />
                    执行测试
                  </>
                )}
              </button>
            </div>

            {/* 测试结果 */}
            {testResult && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className={`px-4 py-3 ${
                  testResult.status === 'completed' ? 'bg-green-50' : 'bg-red-50'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${
                      testResult.status === 'completed' ? 'text-green-800' : 'text-red-800'
                    }`}>
                      {testResult.status === 'completed' ? '测试完成' : '测试失败'}
                    </span>
                    <span className="text-sm text-gray-500">
                      耗时: {testResult.duration}ms
                    </span>
                  </div>
                </div>

                {testResult.error && (
                  <div className="px-4 py-3 bg-red-50 border-t border-red-200">
                    <p className="text-sm text-red-800">{testResult.error}</p>
                  </div>
                )}

                {testResult.summary && (
                  <div className="px-4 py-3 border-t border-gray-200">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">执行摘要</h4>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{testResult.summary}</p>
                  </div>
                )}

                {testResult.toolCalls && testResult.toolCalls.length > 0 && (
                  <div className="px-4 py-3 border-t border-gray-200">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      工具调用 ({testResult.toolCalls.length})
                    </h4>
                    <div className="space-y-2">
                      {testResult.toolCalls.map((call, index) => (
                        <div key={index} className="bg-gray-50 rounded p-2">
                          <div className="flex items-center space-x-2">
                            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">
                              {call.tool}
                            </span>
                            <span className="text-xs text-gray-500">
                              {JSON.stringify(call.parameters).slice(0, 100)}...
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {testResult.vulnerabilities && testResult.vulnerabilities.length > 0 && (
                  <div className="px-4 py-3 border-t border-gray-200">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      发现漏洞 ({testResult.vulnerabilities.length})
                    </h4>
                    <div className="space-y-2">
                      {testResult.vulnerabilities.map((vuln, index) => (
                        <div key={index} className="bg-yellow-50 border border-yellow-200 rounded p-3">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-900">{vuln.title}</span>
                            <span className={`px-2 py-0.5 text-xs rounded ${
                              vuln.severity === 'critical' ? 'bg-red-100 text-red-800' :
                              vuln.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                              vuln.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-blue-100 text-blue-800'
                            }`}>
                              {vuln.severity}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{vuln.description}</p>
                          {vuln.filePath && (
                            <p className="text-xs text-gray-500 mt-1">
                              {vuln.filePath}{vuln.lineStart ? `:${vuln.lineStart}` : ''}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'executions' && (
          <div className="space-y-4">
            {skill.executions && skill.executions.length > 0 ? (
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">发现</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">确认</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">误报</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">耗时</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {skill.executions.map((exec) => (
                    <tr key={exec.id}>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs rounded ${
                          exec.status === 'completed' ? 'bg-green-100 text-green-800' :
                          exec.status === 'failed' ? 'bg-red-100 text-red-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {exec.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{exec.findingsCount}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{exec.confirmedCount}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{exec.falsePositiveCount}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {exec.duration ? `${exec.duration}ms` : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {new Date(exec.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <History className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                <p>暂无执行记录</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'evolutions' && (
          <div className="space-y-4">
            {skill.evolutions && skill.evolutions.length > 0 ? (
              skill.evolutions.map((evolution) => (
                <div key={evolution.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded">
                      v{evolution.fromVersion} → v{evolution.toVersion}
                    </span>
                    <span className="text-sm text-gray-500">
                      {new Date(evolution.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <h4 className="font-medium text-gray-900">{evolution.changeDesc}</h4>
                  <p className="text-sm text-gray-600 mt-1">
                    类型: {evolution.changeType} | 原因: {evolution.reason}
                  </p>
                  {evolution.beforeRate !== null && evolution.afterRate !== null && (
                    <div className="mt-2 flex items-center text-sm">
                      <span className="text-gray-500">成功率变化:</span>
                      <span className="ml-2 text-red-600">{(evolution.beforeRate * 100).toFixed(1)}%</span>
                      <span className="mx-2">→</span>
                      <span className="text-green-600">{(evolution.afterRate * 100).toFixed(1)}%</span>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <TrendingUp className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                <p>暂无进化记录</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
