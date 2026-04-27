'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  FileText,
  Save,
  RefreshCw,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface EvolutionPrompt {
  id: string;
  promptKey: string;
  displayName: string;
  description: string | null;
  content: string;
  isActive: boolean;
}

interface PromptsResponse {
  success: boolean;
  prompts: EvolutionPrompt[];
  total: number;
}

export function PromptManager() {
  const [prompts, setPrompts] = useState<EvolutionPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [editActive, setEditActive] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const fetchPrompts = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/admin/skill-evolution/prompts', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('获取提示词失败');
      }

      const data: PromptsResponse = await response.json();
      setPrompts(data.prompts);
    } catch (err) {
      console.error('Error fetching prompts:', err);
      toast.error(err instanceof Error ? err.message : '获取提示词失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, []);

  const handleEdit = (prompt: EvolutionPrompt) => {
    setEditingKey(prompt.promptKey);
    setEditContent(prompt.content);
    setEditActive(prompt.isActive);
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditContent('');
    setEditActive(true);
  };

  const handleSave = async (promptKey: string) => {
    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/admin/skill-evolution/prompts', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          promptKey,
          content: editContent,
          isActive: editActive,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '保存失败');
      }

      toast.success('提示词已保存');
      setEditingKey(null);
      fetchPrompts();
    } catch (err) {
      console.error('Error saving prompt:', err);
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSeed = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/admin/skill-evolution/prompts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('初始化失败');
      }

      const data = await response.json();
      toast.success(data.message);
      fetchPrompts();
    } catch (err) {
      console.error('Error seeding prompts:', err);
      toast.error(err instanceof Error ? err.message : '初始化失败');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (promptKey: string) => {
    setExpandedKey(expandedKey === promptKey ? null : promptKey);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">LLM 提示词配置</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">
            {prompts.length} 个提示词
          </span>
          <button
            onClick={handleSeed}
            className="inline-flex items-center px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            <RefreshCw size={16} className="mr-1" />
            初始化默认值
          </button>
        </div>
      </div>

      {/* Prompt List */}
      <div className="divide-y divide-gray-100">
        {prompts.map((prompt) => (
          <div key={prompt.promptKey} className="p-4">
            {/* Header Row */}
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900">{prompt.displayName}</h3>
                  {prompt.isActive ? (
                    <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full flex items-center gap-1">
                      <CheckCircle size={12} />
                      已启用
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full flex items-center gap-1">
                      <XCircle size={12} />
                      使用默认
                    </span>
                  )}
                </div>
                {prompt.description && (
                  <p className="text-sm text-gray-500 mt-1">{prompt.description}</p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  Key: {prompt.promptKey}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleExpand(prompt.promptKey)}
                  className="inline-flex items-center px-2 py-1 text-sm text-gray-600 hover:text-gray-900"
                >
                  {expandedKey === prompt.promptKey ? (
                    <EyeOff size={16} />
                  ) : (
                    <Eye size={16} />
                  )}
                  {expandedKey === prompt.promptKey ? '收起' : '查看'}
                </button>
                <button
                  onClick={() => handleEdit(prompt)}
                  className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                >
                  编辑
                </button>
              </div>
            </div>

            {/* Expanded Content (View Mode) */}
            {expandedKey === prompt.promptKey && editingKey !== prompt.promptKey && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono overflow-auto max-h-96">
                  {prompt.content}
                </pre>
              </div>
            )}

            {/* Edit Mode */}
            {editingKey === prompt.promptKey && (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={editActive}
                      onChange={(e) => setEditActive(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    启用此提示词（启用后覆盖代码默认值）
                  </label>
                </div>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={12}
                  className="w-full p-3 text-sm font-mono border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="输入提示词内容..."
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    使用 {'{{placeholder}}'} 占位符可动态替换内容
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCancelEdit}
                      className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => handleSave(prompt.promptKey)}
                      disabled={saving}
                      className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <Save size={16} className="mr-1" />
                      )}
                      保存
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Help Section */}
      <div className="px-4 py-3 bg-blue-50 border-t border-blue-100">
        <h4 className="text-sm font-medium text-blue-900 mb-2">占位符说明</h4>
        <div className="grid grid-cols-2 gap-2 text-xs text-blue-800">
          <div>
            <p className="font-medium">平衡分析模板:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li><code className="bg-blue-100 px-1 rounded">{'{{SKILL_CONTENT}}'}</code> - Skill 定义内容</li>
              <li><code className="bg-blue-100 px-1 rounded">{'{{FALSE_POSITIVE_CASES}}'}</code> - 误报案例列表</li>
              <li><code className="bg-blue-100 px-1 rounded">{'{{CONFIRMED_CASES}}'}</code> - 正确发现案例列表</li>
            </ul>
          </div>
          <div>
            <p className="font-medium">改进生成模板:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li><code className="bg-blue-100 px-1 rounded">{'{{SKILL_CONTENT}}'}</code> - 原 Skill 内容</li>
              <li><code className="bg-blue-100 px-1 rounded">{'{{FALSE_POSITIVE_PATTERNS}}'}</code> - 误报模式</li>
              <li><code className="bg-blue-100 px-1 rounded">{'{{RECOMMENDATIONS}}'}</code> - 改进建议</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}