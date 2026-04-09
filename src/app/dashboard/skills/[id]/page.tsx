'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Play,
  Edit,
  Trash2,
  Save,
  X,
  Award,
  Copy,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  FileText,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/auth';
import { getCategories, Category } from '@/lib/categories';
import { exportAsSkillFile, copySkillMdToClipboard } from '@/lib/skill-export';

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe: string | null;
  severity: string;
  content: string;
  isActive: boolean;
  isBuiltin: boolean;
  version: number;
  parentId: string | null;
  isLatest: boolean;
  successRate: number | null;
  avgDuration: number | null;
  execCount: number;
  createdAt: string;
  updatedAt: string;
}

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

export default function SkillDetailPage() {
  const params = useParams();
  const router = useRouter();
  const skillId = params.id as string;

  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsAdmin(hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE));
      } catch (error) {
        console.error('解析 token 失败:', error);
      }
    }
  }, []);

  useEffect(() => {
    // 加载分类
    getCategories().then((cats) => {
      setCategories(cats);
    });
  }, []);

  useEffect(() => {
    fetchSkill();
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
    if (!skill) return;

    if (!confirm(`确定要删除 Skill "${skill.displayName}" 吗？此操作不可恢复。`)) {
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
        const data = await response.json();
        throw new Error(data.error || '更新失败');
      }

      fetchSkill();
    } catch (err) {
      alert(err instanceof Error ? err.message : '更新失败');
    }
  };

  const startEditing = () => {
    if (!skill) return;
    setEditName(skill.displayName);
    setEditCategory(skill.category);
    setEditContent(skill.content || '');
    setEditIsActive(skill.isActive);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!skill) return;

    if (!editName.trim()) {
      alert('请输入 Skill 名称');
      return;
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: editName.trim(),
          description: editName.trim(),
          category: editCategory,
          content: editContent,
          isActive: editIsActive,
        }),
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
  };

  const handleExport = async () => {
    if (!skill) return;
    
    setExporting(true);
    try {
      await exportAsSkillFile(skill);
    } catch (error) {
      console.error('导出失败:', error);
      alert('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  const handleCopyMd = async () => {
    if (!skill) return;
    
    try {
      await copySkillMdToClipboard(skill);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('复制失败:', error);
      alert('复制失败，请重试');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        {error || 'Skill 不存在'}
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
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold text-gray-900">{skill.displayName}</h1>
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
            <p className="text-sm text-gray-600">{skill.name}</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {/* 导出按钮 */}
          <button
            onClick={handleCopyMd}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {copied ? (
              <>
                <CheckCircle size={16} className="mr-2 text-green-600" />
                已复制
              </>
            ) : (
              <>
                <Copy size={16} className="mr-2" />
                复制 MD
              </>
            )}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            {exporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                导出中...
              </>
            ) : (
              <>
                <Download size={16} className="mr-2" />
                导出 .skill
              </>
            )}
          </button>
          
          {isAdmin && (
            <>
              {!isEditing ? (
                <>
                  <button
                    onClick={handleToggleActive}
                    className={`inline-flex items-center px-4 py-2 rounded-lg transition-colors ${
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
                  <button
                    onClick={startEditing}
                    className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Edit size={16} className="mr-2" />
                    编辑
                  </button>
                  <button
                    onClick={handleDelete}
                    className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    <Trash2 size={16} className="mr-2" />
                    删除
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={cancelEditing}
                    disabled={saving}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving}
                    className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        保存中...
                      </>
                    ) : (
                      <>
                        <Save size={16} className="mr-2" />
                        保存
                      </>
                    )}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        {isEditing ? (
          /* 编辑模式 */
          <div className="space-y-6">
            {/* 基本信息 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Skill 名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  漏洞分类 <span className="text-red-500">*</span>
                </label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {categories.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Markdown 内容 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Skill 内容（Markdown 格式）
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (skill) {
                      setEditContent(skill.content || '');
                    }
                  }}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  重置为原始内容
                </button>
              </div>
              <div className="mb-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">格式建议：</p>
                <div className="text-xs text-gray-500 font-mono space-y-1">
                  <p># Skill 名称</p>
                  <p>## 描述</p>
                  <p>## 严重程度 (critical | high | medium | low | info)</p>
                  <p>## CWE 编号</p>
                  <p>## 系统提示词</p>
                  <p>## 用户提示词</p>
                  <p>## 工具 (使用 - 列表)</p>
                </div>
              </div>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-[500px] px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                placeholder="输入 Markdown 格式的 Skill 定义..."
              />
            </div>

            {/* 是否启用 */}
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">启用此 Skill</span>
              </label>
            </div>
          </div>
        ) : (
          /* 查看模式 */
          <div className="space-y-6">
            {/* 基本信息 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">分类</h3>
                <p className="text-gray-900">
                  {categories.find(c => c.value === skill.category)?.label || skill.category}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">严重程度</h3>
                <span className={`px-2 py-1 text-sm rounded-full ${severityColors[skill.severity]}`}>
                  {severityLabels[skill.severity] || skill.severity}
                </span>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">CWE</h3>
                <p className="text-gray-900">{skill.cwe || '无'}</p>
              </div>
            </div>

            {/* Markdown 内容 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-medium text-gray-900">Skill 内容</h3>
                <button
                  onClick={() => {
                    if (skill.content) {
                      copyToClipboard(skill.content);
                    }
                  }}
                  className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                >
                  <Copy size={14} className="mr-1" />
                  复制 Markdown
                </button>
              </div>
              <pre className="bg-gray-50 p-4 rounded-lg overflow-x-auto text-sm whitespace-pre-wrap font-mono">
                {skill.content || '暂无内容'}
              </pre>
            </div>

            {/* 元信息 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">版本</h3>
                <p className="text-gray-900">v{skill.version}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">执行次数</h3>
                <p className="text-gray-900">{skill.execCount}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">成功率</h3>
                <p className="text-gray-900">{skill.successRate ? `${(skill.successRate * 100).toFixed(1)}%` : 'N/A'}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">创建时间</h3>
                <p className="text-gray-900">{new Date(skill.createdAt).toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
