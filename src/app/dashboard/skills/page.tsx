'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Award,
  Plus,
  Search,
  Filter,
  Play,
  Edit,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe: string | null;
  severity: string;
  isActive: boolean;
  isBuiltin: boolean;
  version: number;
  successRate: number | null;
  avgDuration: number | null;
  execCount: number;
  tools: string[];
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
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-blue-100 text-blue-800',
  info: 'bg-gray-100 text-gray-800',
};

const severityLabels: Record<string, string> = {
  critical: '严重',
  high: '高危',
  medium: '中危',
  low: '低危',
  info: '信息',
};

export default function SkillsPage() {
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [categories, setCategories] = useState<{ name: string; label: string; count: number }[]>([]);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [user, setUser] = useState<{ roles?: string[] } | null>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
  }, []);

  useEffect(() => {
    fetchSkills();
    fetchCategories();
  }, [selectedCategory]);

  const fetchSkills = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const url = selectedCategory
        ? `/api/skills?category=${selectedCategory}`
        : '/api/skills';

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取 Skills 列表失败');
      }

      const data = await response.json();
      setSkills(data.skills || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills/categories', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories || []);
      }
    } catch (err) {
      console.error('获取分类失败:', err);
    }
  };

  const handleDelete = async (skillId: string, skillName: string) => {
    if (!confirm(`确定要删除 Skill "${skillName}" 吗？`)) {
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

      fetchSkills();
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleToggleActive = async (skillId: string, currentActive: boolean) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: !currentActive }),
      });

      if (!response.ok) {
        throw new Error('更新失败');
      }

      fetchSkills();
    } catch (err) {
      alert(err instanceof Error ? err.message : '更新失败');
    }
  };

  const filteredSkills = skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      skill.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isAdmin = user?.roles?.includes('admin');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Skills 库</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理 AI 漏洞检测技能，共 {skills.length} 个 Skills
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => router.push('/dashboard/skills/create')}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={20} className="mr-2" />
            创建 Skill
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="搜索 Skills..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={20} className="text-gray-400" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">所有分类</option>
            {categories.map((cat) => (
              <option key={cat.name} value={cat.name}>
                {cat.label} ({cat.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Skills List */}
      <div className="space-y-4">
        {filteredSkills.length === 0 ? (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
            <div className="text-center">
              <Award className="mx-auto h-16 w-16 text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">暂无 Skills</h3>
              <p className="mt-2 text-sm text-gray-600">
                {searchTerm || selectedCategory
                  ? '没有找到匹配的 Skills'
                  : '请先运行种子数据脚本初始化 Skills'}
              </p>
              {!searchTerm && !selectedCategory && isAdmin && (
                <button
                  onClick={() => {
                    // 运行种子数据脚本提示
                    alert('请在服务器上运行: npx tsx prisma/seed-skills.ts');
                  }}
                  className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  初始化 Skills 数据
                </button>
              )}
            </div>
          </div>
        ) : (
          filteredSkills.map((skill) => (
            <div
              key={skill.id}
              className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden"
            >
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedSkill(expandedSkill === skill.id ? null : skill.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className={`p-2 rounded-lg ${skill.isActive ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <Award className={skill.isActive ? 'text-green-600' : 'text-gray-400'} size={24} />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="font-semibold text-gray-900">{skill.displayName}</h3>
                        <span className={`px-2 py-0.5 text-xs rounded-full ${severityColors[skill.severity]}`}>
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
                      <p className="text-sm text-gray-500">{skill.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <span className="text-sm text-gray-500">
                      {categoryLabels[skill.category] || skill.category}
                    </span>
                    {expandedSkill === skill.id ? (
                      <ChevronUp size={20} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={20} className="text-gray-400" />
                    )}
                  </div>
                </div>
              </div>

              {expandedSkill === skill.id && (
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">描述</h4>
                      <p className="text-sm text-gray-600">{skill.description}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">CWE</h4>
                      <p className="text-sm text-gray-600">{skill.cwe || '无'}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">工具</h4>
                      <div className="flex flex-wrap gap-1">
                        {skill.tools.map((tool) => (
                          <span key={tool} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">
                            {tool}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">统计</h4>
                      <div className="flex items-center space-x-4 text-sm text-gray-600">
                        <span>执行次数: {skill.execCount}</span>
                        {skill.successRate !== null && (
                          <span>成功率: {(skill.successRate * 100).toFixed(1)}%</span>
                        )}
                        {skill.avgDuration !== null && (
                          <span>平均耗时: {skill.avgDuration}ms</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="mt-4 flex items-center space-x-2">
                      <button
                        onClick={() => handleToggleActive(skill.id, skill.isActive)}
                        className={`inline-flex items-center px-3 py-1.5 text-sm rounded ${
                          skill.isActive
                            ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                            : 'bg-green-100 text-green-800 hover:bg-green-200'
                        }`}
                      >
                        {skill.isActive ? (
                          <>
                            <XCircle size={16} className="mr-1" />
                            禁用
                          </>
                        ) : (
                          <>
                            <CheckCircle size={16} className="mr-1" />
                            启用
                          </>
                        )}
                      </button>
                      {!skill.isBuiltin && (
                        <button
                          onClick={() => handleDelete(skill.id, skill.displayName)}
                          className="inline-flex items-center px-3 py-1.5 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
                        >
                          <Trash2 size={16} className="mr-1" />
                          删除
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
