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
  const [activeTab, setActiveTab] = useState<'overview' | 'prompt' | 'executions' | 'evolutions'>('overview');
  const [user, setUser] = useState<{ roles?: string[] } | null>(null);

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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('已复制到剪贴板');
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
          </div>
        )}

        {activeTab === 'prompt' && (
          <div className="space-y-6">
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
