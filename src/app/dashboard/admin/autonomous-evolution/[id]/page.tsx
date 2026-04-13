'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle,
  Circle,
  Edit2,
  Save,
  X,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Trash2,
} from 'lucide-react';

interface Experience {
  id: string;
  title: string;
  errorCategory: string;
  errorPatterns: string;
  sourceModel: string;
  sourceSessionId: string;
  sourceProjectId: string | null;
  attemptSequence: string;
  directSolution: string;
  lesson: string;
  isInjected: boolean;
  injectedAt: string | null;
  hitCount: number;
  savedAttempts: number;
  createdAt: string;
  updatedAt: string;
}

interface AttemptSequence {
  failures: Array<{ toolName: string; toolInput: Record<string, unknown>; errorMessage: string; timestamp: string }>;
  success: { toolName: string; toolInput: Record<string, unknown>; result: unknown; timestamp: string };
}

const CATEGORY_LABELS: Record<string, string> = {
  tool_failure: '工具失败',
  path_error: '路径错误',
  permission: '权限问题',
  mcp_timeout: 'MCP超时',
  other: '其他',
};

export default function ExperienceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [exp, setExp] = useState<Experience | null>(null);
  const [loading, setLoading] = useState(true);
  const [sequenceExpanded, setSequenceExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editSolution, setEditSolution] = useState('');
  const [editLesson, setEditLesson] = useState('');
  const [saving, setSaving] = useState(false);

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const fetchDetail = async () => {
    setLoading(true);
    const res = await fetch(`/api/autonomous-evolution/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json() as Experience;
      setExp(data);
      setEditSolution(data.directSolution);
      setEditLesson(data.lesson);
    }
    setLoading(false);
  };

  const handleToggleInject = async () => {
    if (!exp) return;
    const res = await fetch(`/api/autonomous-evolution/${id}/inject`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setExp(await res.json());
  };

  const handleSave = async () => {
    if (!exp) return;
    setSaving(true);
    const res = await fetch(`/api/autonomous-evolution/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ directSolution: editSolution, lesson: editLesson }),
    });
    if (res.ok) {
      const updated = await res.json() as Experience;
      setExp(updated);
      setEditing(false);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!exp || !confirm(`确定删除「${exp.title}」？`)) return;
    await fetch(`/api/autonomous-evolution/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    router.push('/dashboard/admin/autonomous-evolution');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!exp) {
    return (
      <div className="text-center py-12 text-gray-500">
        未找到该经验记录
      </div>
    );
  }

  let patterns: string[] = [];
  try { patterns = JSON.parse(exp.errorPatterns); } catch { /* ignore */ }

  let sequence: AttemptSequence | null = null;
  try { sequence = JSON.parse(exp.attemptSequence); } catch { /* ignore */ }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Top nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard/admin/autonomous-evolution')}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-800 text-sm"
          >
            <ArrowLeft size={16} />
            返回
          </button>
          <span className="text-gray-300">|</span>
          {exp.isInjected ? (
            <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
              <CheckCircle size={12} /> 已注入
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Circle size={12} /> 未注入
            </span>
          )}
          <h2 className="text-lg font-bold text-gray-900">{exp.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleInject}
            className={`px-3 py-1.5 text-sm rounded-lg border ${
              exp.isInjected
                ? 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
            }`}
          >
            {exp.isInjected ? '停用注入' : '启用注入'}
          </button>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100"
            >
              <Edit2 size={13} /> 编辑
            </button>
          )}
          <button
            onClick={handleDelete}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100"
          >
            <Trash2 size={13} /> 删除
          </button>
        </div>
      </div>

      {/* Basic info */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">基本信息</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-xs text-gray-500">错误类型</span>
            <p className="font-medium text-gray-900">{CATEGORY_LABELS[exp.errorCategory] || exp.errorCategory}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">来源模型</span>
            <p className="font-medium text-gray-900">{exp.sourceModel || '未知'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">出现次数</span>
            <p className="font-medium text-gray-900">{exp.hitCount} 次</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">创建时间</span>
            <p className="font-medium text-gray-900">{new Date(exp.createdAt).toLocaleString('zh-CN')}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">来源会话</span>
            <div className="flex items-center gap-1">
              <p className="font-medium text-gray-900 truncate max-w-[120px]">{exp.sourceSessionId || '—'}</p>
              {exp.sourceSessionId && (
                <button
                  onClick={() => router.push(`/dashboard/sessions/${exp.sourceSessionId}`)}
                  className="text-blue-500 hover:text-blue-700"
                  title="跳转会话"
                >
                  <ExternalLink size={12} />
                </button>
              )}
            </div>
          </div>
          {exp.injectedAt && (
            <div>
              <span className="text-xs text-gray-500">注入时间</span>
              <p className="font-medium text-gray-900">{new Date(exp.injectedAt).toLocaleString('zh-CN')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Error patterns */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">触发特征（遇到以下错误时命中此经验）</h3>
        <div className="space-y-1">
          {patterns.length > 0 ? patterns.map((p, i) => (
            <div key={i} className="px-3 py-1.5 bg-orange-50 border border-orange-100 rounded text-sm text-orange-800 font-mono">
              {p}
            </div>
          )) : (
            <p className="text-sm text-gray-400">无触发特征</p>
          )}
        </div>
      </div>

      {/* Attempt sequence (collapsible) */}
      {sequence && (
        <div>
          <button
            onClick={() => setSequenceExpanded(!sequenceExpanded)}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            {sequenceExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            尝试序列（{sequence.failures.length} 次失败 → 1 次成功）
          </button>
          {sequenceExpanded && (
            <div className="mt-2 space-y-2">
              {sequence.failures.map((f, i) => (
                <div key={i} className="bg-red-50 border border-red-100 rounded-lg p-3 text-xs">
                  <div className="font-medium text-red-700 mb-1">失败 {i + 1} — {f.toolName}</div>
                  <div className="text-gray-600 font-mono break-all">{f.errorMessage}</div>
                </div>
              ))}
              <div className="bg-green-50 border border-green-100 rounded-lg p-3 text-xs">
                <div className="font-medium text-green-700 mb-1">成功 — {sequence.success.toolName}</div>
                <div className="text-gray-600 font-mono break-all">
                  {JSON.stringify(sequence.success.toolInput)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Direct solution */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">直达方案（注入到 System Prompt 的内容）</h3>
        {editing ? (
          <textarea
            value={editSolution}
            onChange={e => setEditSolution(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-none"
          />
        ) : (
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap">
            {exp.directSolution}
          </div>
        )}
      </div>

      {/* Lesson */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">教训（大模型提炼）</h3>
        {editing ? (
          <textarea
            value={editLesson}
            onChange={e => setEditLesson(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-none"
          />
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">
            {exp.lesson}
          </div>
        )}
      </div>

      {/* Edit actions */}
      {editing && (
        <div className="flex justify-end gap-2">
          <button
            onClick={() => { setEditing(false); setEditSolution(exp.directSolution); setEditLesson(exp.lesson); }}
            className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <X size={14} /> 取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={14} /> {saving ? '保存中...' : '保存'}
          </button>
        </div>
      )}
    </div>
  );
}