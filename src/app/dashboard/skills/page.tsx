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
  Save,
  RefreshCw,
  Eye,
  X,
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
  isActive: boolean;
  isBuiltin: boolean;
  version: number;
  parentId: string | null;
  isLatest: boolean;
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
  parameters: Record<string, unknown>;
  successRate: number | null;
  avgDuration: number | null;
  execCount: number;
  createdAt: string;
  updatedAt: string;
  // 官方标准字段
  disableModelInvocation: boolean;
  userInvocable: boolean;
  context: string | null;
  agent: string | null;
  argumentHint: string | null;
  model: string | null;
  effort: string | null;
  paths: string | null;
  shell: string | null;
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
  const [totalSkills, setTotalSkills] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [categories, setCategories] = useState<{ name: string; label: string; count: number }[]>([]);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [user, setUser] = useState<{ roles?: string[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [previewSkill, setPreviewSkill] = useState<Skill | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [batchOperating, setBatchOperating] = useState(false);

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
      // API returns { data: [...], pagination: {...} }
      setSkills(data.data || []);
      setTotalSkills(data.pagination?.total || 0);
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

  const handleSyncToDisk = async () => {
    if (!confirm('确定要将所有 Skills 同步到磁盘吗？此操作将更新 data/skills/ 目录。')) {
      return;
    }

    try {
      setSyncing(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/sync/skills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'sync' }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '同步失败');
      }

      const data = await response.json();
      alert(`同步成功！\n\n总计: ${data.total}\n成功: ${data.success}\n失败: ${data.failed}`);
      
      // 刷新列表
      fetchSkills();
    } catch (err) {
      alert(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncing(false);
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
        const data = await response.json();
        throw new Error(data.error || '更新失败');
      }

      fetchSkills();
    } catch (err) {
      alert(err instanceof Error ? err.message : '更新失败');
    }
  };

  // 批量选择相关函数
  const handleSelectSkill = (skillId: string) => {
    const newSelected = new Set(selectedSkills);
    if (newSelected.has(skillId)) {
      newSelected.delete(skillId);
    } else {
      newSelected.add(skillId);
    }
    setSelectedSkills(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedSkills.size === filteredSkills.length) {
      setSelectedSkills(new Set());
    } else {
      setSelectedSkills(new Set(filteredSkills.map(s => s.id)));
    }
  };

  const handleBatchOperation = async (action: 'enable' | 'disable' | 'delete') => {
    if (selectedSkills.size === 0) {
      alert('请先选择要操作的 Skill');
      return;
    }

    const actionText = action === 'enable' ? '启用' : action === 'disable' ? '禁用' : '删除';
    if (!confirm(`确定要批量${actionText} ${selectedSkills.size} 个 Skill 吗？`)) {
      return;
    }

    try {
      setBatchOperating(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills/batch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          skillIds: Array.from(selectedSkills),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '操作失败');
      }

      setSelectedSkills(new Set());
      fetchSkills();
      alert(`成功${actionText} ${selectedSkills.size} 个 Skill`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBatchOperating(false);
    }
  };

  const filteredSkills = skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      skill.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isAdmin = user?.roles?.includes('admin');

  // 生成 SKILL.md 格式内容
  const generateSkillMd = (skill: Skill): string => {
    // 构建 YAML frontmatter
    const frontmatter: Record<string, unknown> = {
      name: skill.name,
      description: skill.description,
    };

    // 添加官方字段（仅在有值时）
    if (skill.disableModelInvocation) {
      frontmatter['disable-model-invocation'] = true;
    }
    if (!skill.userInvocable) {
      frontmatter['user-invocable'] = false;
    }
    if (skill.context) {
      frontmatter.context = skill.context;
    }
    if (skill.agent) {
      frontmatter.agent = skill.agent;
    }
    if (skill.argumentHint) {
      frontmatter['argument-hint'] = skill.argumentHint;
    }
    if (skill.model) {
      frontmatter.model = skill.model;
    }
    if (skill.effort) {
      frontmatter.effort = skill.effort;
    }
    if (skill.paths) {
      try {
        const paths = typeof skill.paths === 'string' ? JSON.parse(skill.paths) : skill.paths;
        if (Array.isArray(paths) && paths.length > 0) {
          frontmatter.paths = paths;
        }
      } catch {
        // 忽略解析错误
      }
    }
    if (skill.shell) {
      frontmatter.shell = skill.shell;
    }
    if (skill.tools && Array.isArray(skill.tools) && skill.tools.length > 0) {
      frontmatter['allowed-tools'] = skill.tools.join(' ');
    }

    // 构建 YAML 字符串
    const yamlLines = ['---'];
    for (const [key, value] of Object.entries(frontmatter)) {
      if (typeof value === 'boolean') {
        yamlLines.push(`${key}: ${value}`);
      } else if (Array.isArray(value)) {
        yamlLines.push(`${key}: ${JSON.stringify(value)}`);
      } else {
        yamlLines.push(`${key}: ${value}`);
      }
    }
    yamlLines.push('---');

    // 构建 markdown 内容
    const sections: string[] = [];

    if (skill.systemPrompt) {
      sections.push('## 系统提示词\n', skill.systemPrompt);
    }

    if (skill.userPrompt) {
      sections.push('## 用户提示词\n', skill.userPrompt);
    }

    if (skill.cwe) {
      sections.push('## 相关 CWE\n', skill.cwe);
    }

    if (skill.severity) {
      const severityMap: Record<string, string> = {
        critical: '严重',
        high: '高危',
        medium: '中危',
        low: '低危',
        info: '信息',
      };
      sections.push('## 安全等级\n', severityMap[skill.severity] || skill.severity);
    }

    if (skill.parameters && Object.keys(skill.parameters).length > 0) {
      sections.push('## 参数配置\n', '```json\n', JSON.stringify(skill.parameters, null, 2), '\n```');
    }

    // 组合最终内容
    const content = [yamlLines.join('\n'), ...sections].join('\n\n');
    return content;
  };

  // 复制 SKILL.md 到剪贴板
  const handleCopySkillMd = async (skill: Skill) => {
    try {
      const content = generateSkillMd(skill);
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

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
            管理 AI 漏洞检测技能，共 {totalSkills} 个 Skills
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-3">
            {/* 批量操作按钮 */}
            {selectedSkills.size > 0 && (
              <>
                <span className="text-sm text-gray-600">
                  已选择 {selectedSkills.size} 项
                </span>
                <button
                  onClick={() => handleBatchOperation('enable')}
                  disabled={batchOperating}
                  className="inline-flex items-center px-3 py-2 bg-green-100 text-green-800 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
                  title="批量启用选中的 Skills"
                >
                  <CheckCircle size={16} className="mr-1" />
                  批量启用
                </button>
                <button
                  onClick={() => handleBatchOperation('disable')}
                  disabled={batchOperating}
                  className="inline-flex items-center px-3 py-2 bg-yellow-100 text-yellow-800 rounded-lg hover:bg-yellow-200 transition-colors disabled:opacity-50"
                  title="批量禁用选中的 Skills"
                >
                  <XCircle size={16} className="mr-1" />
                  批量禁用
                </button>
                <button
                  onClick={() => handleBatchOperation('delete')}
                  disabled={batchOperating}
                  className="inline-flex items-center px-3 py-2 bg-red-100 text-red-800 rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50"
                  title="批量删除选中的 Skills"
                >
                  <Trash2 size={16} className="mr-1" />
                  批量删除
                </button>
              </>
            )}
            <button
              onClick={handleSyncToDisk}
              disabled={syncing}
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="将所有 Skills 同步到磁盘存储"
            >
              {syncing ? (
                <>
                  <RefreshCw size={20} className="mr-2 animate-spin" />
                  同步中...
                </>
              ) : (
                <>
                  <Save size={20} className="mr-2" />
                  同步到磁盘
                </>
              )}
            </button>
            <button
              onClick={() => router.push('/dashboard/skills/create')}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={20} className="mr-2" />
              创建 Skill
            </button>
          </div>
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
        <div className="flex items-center gap-4">
          {/* 全选复选框 */}
          {isAdmin && filteredSkills.length > 0 && (
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedSkills.size === filteredSkills.length && filteredSkills.length > 0}
                onChange={handleSelectAll}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">全选</span>
            </label>
          )}
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
                    {/* 复选框 */}
                    {isAdmin && (
                      <input
                        type="checkbox"
                        checked={selectedSkills.has(skill.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleSelectSkill(skill.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        disabled={skill.isBuiltin || !skill.isLatest}
                        title={
                          skill.isBuiltin
                            ? '内置 Skill 不能选择'
                            : !skill.isLatest
                            ? '只能选择最新版本'
                            : ''
                        }
                      />
                    )}
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
                      <h4 className="text-sm font-medium text-gray-700 mb-2">版本信息</h4>
                      <div className="flex items-center space-x-2 text-sm text-gray-600">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded">
                          v{skill.version}
                        </span>
                        {skill.isLatest && (
                          <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs">
                            最新版本
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">工具</h4>
                      <div className="flex flex-wrap gap-1">
                        {skill.tools && Array.isArray(skill.tools) && skill.tools.length > 0 ? (
                          skill.tools.map((tool: string) => (
                            <span key={tool} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">
                              {tool}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-gray-500">无</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">系统提示词</h4>
                      <p className="text-sm text-gray-600 line-clamp-3">
                        {skill.systemPrompt ? skill.systemPrompt.substring(0, 200) + (skill.systemPrompt.length > 200 ? '...' : '') : '无'}
                      </p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">用户提示词</h4>
                      <p className="text-sm text-gray-600 line-clamp-3">
                        {skill.userPrompt ? skill.userPrompt.substring(0, 200) + (skill.userPrompt.length > 200 ? '...' : '') : '无'}
                      </p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">参数配置</h4>
                      <div className="text-sm text-gray-600">
                        {skill.parameters && Object.keys(skill.parameters).length > 0 ? (
                          <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto max-h-24">
                            {JSON.stringify(skill.parameters, null, 2)}
                          </pre>
                        ) : (
                          <span className="text-gray-500">无</span>
                        )}
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
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">创建时间</h4>
                      <p className="text-sm text-gray-600">
                        {new Date(skill.createdAt).toLocaleString('zh-CN')}
                      </p>
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="mt-4 flex items-center space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewSkill(skill);
                        }}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-purple-100 text-purple-800 rounded hover:bg-purple-200"
                        title="预览 SKILL.md"
                      >
                        <Eye size={16} className="mr-1" />
                        预览
                      </button>
                      <button
                        onClick={() => router.push(`/dashboard/skills/${skill.id}`)}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                      >
                        <Edit size={16} className="mr-1" />
                        查看详情
                      </button>
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
                  {!isAdmin && (
                    <div className="mt-4 flex items-center space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewSkill(skill);
                        }}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-purple-100 text-purple-800 rounded hover:bg-purple-200"
                        title="预览 SKILL.md"
                      >
                        <Eye size={16} className="mr-1" />
                        预览
                      </button>
                      <button
                        onClick={() => router.push(`/dashboard/skills/${skill.id}`)}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                      >
                        <Edit size={16} className="mr-1" />
                        查看详情
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* SKILL.md 预览模态框 */}
      {previewSkill && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  SKILL.md 预览 - {previewSkill.displayName}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  这是最终生成的 SKILL.md 文件内容，可直接用于 Claude Code
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopySkillMd(previewSkill)}
                  className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200 transition-colors"
                >
                  <Copy size={16} className="mr-1" />
                  {copied ? '已复制!' : '复制'}
                </button>
                <button
                  onClick={() => {
                    setPreviewSkill(null);
                    setCopied(false);
                  }}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-auto p-4">
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm font-mono whitespace-pre-wrap break-all leading-relaxed">
                {generateSkillMd(previewSkill)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
