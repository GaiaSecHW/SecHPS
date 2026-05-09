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
  X,
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

interface PromptManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PromptManagerModal({ isOpen, onClose }: PromptManagerModalProps) {
  const [prompts, setPrompts] = useState<EvolutionPrompt[]>([]);
  const [loading, setLoading] = useState(false);
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
    if (isOpen) {
      fetchPrompts();
    }
  }, [isOpen]);

  const handleEdit = (prompt: EvolutionPrompt) => {
    setEditingKey(prompt.promptKey);
    setEditContent(prompt.content);
    setEditActive(prompt.isActive);
    setExpandedKey(null); // 关闭展开状态
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
    setEditingKey(null); // 关闭编辑状态
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-dark-surface rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 bg-[#0F172A] border-b border-gray-700/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-gray-400" />
              <h2 className="text-xl font-semibold text-gray-100">LLM 提示词配置</h2>
              <span className="text-sm text-gray-500">
                {prompts.length} 个提示词
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSeed}
                disabled={loading}
                className="inline-flex items-center px-3 py-1.5 text-sm bg-dark-surface-hover text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 border border-gray-600"
              >
                <RefreshCw size={16} className={`mr-1 ${loading ? 'animate-spin' : ''}`} />
                初始化默认值
              </button>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-200 hover:bg-dark-surface-hover rounded-full"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner size="lg" />
              </div>
            ) : (
              <div className="space-y-4">
                {prompts.map((prompt) => (
                  <div key={prompt.promptKey} className="border border-gray-700/50 rounded-lg p-4">
                    {/* Header Row */}
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-gray-100">{prompt.displayName}</h3>
                          {prompt.isActive ? (
                            <span className="px-2 py-0.5 text-xs bg-green-500/15 text-green-400 rounded-full flex items-center gap-1 border border-green-500/30">
                              <CheckCircle size={12} />
                              已启用
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs bg-gray-500/15 text-gray-400 rounded-full flex items-center gap-1 border border-gray-500/30">
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
                          className="inline-flex items-center px-2 py-1 text-sm text-gray-400 hover:text-gray-200 hover:bg-dark-surface-hover rounded"
                        >
                          {expandedKey === prompt.promptKey ? (
                            <EyeOff size={16} className="mr-1" />
                          ) : (
                            <Eye size={16} className="mr-1" />
                          )}
                          {expandedKey === prompt.promptKey ? '收起' : '查看'}
                        </button>
                        <button
                          onClick={() => handleEdit(prompt)}
                          className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 border border-blue-500/30"
                        >
                          编辑
                        </button>
                      </div>
                    </div>

                    {/* Expanded Content (View Mode) */}
                    {expandedKey === prompt.promptKey && editingKey !== prompt.promptKey && (
                      <div className="mt-3 p-3 bg-[#0F172A] rounded-lg border border-gray-700/50">
                        <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono overflow-auto max-h-64">
                          {prompt.content}
                        </pre>
                      </div>
                    )}

                    {/* Edit Mode */}
                    {editingKey === prompt.promptKey && (
                      <div className="mt-3 space-y-3">
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-sm text-gray-300">
                            <input
                              type="checkbox"
                              checked={editActive}
                              onChange={(e) => setEditActive(e.target.checked)}
                              className="rounded border-gray-600"
                            />
                            启用此提示词（启用后覆盖代码默认值）
                          </label>
                        </div>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={10}
                          className="w-full p-3 text-sm font-mono bg-[#0F172A] text-gray-200 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="输入提示词内容..."
                        />
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-500">
                            使用 {'{{placeholder}}'} 占位符可动态替换内容
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleCancelEdit}
                              className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
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
            )}
          </div>

          {/* Footer - Help Section */}
          <div className="px-6 py-3 bg-blue-900/20 border-t border-blue-500/30">
            <h4 className="text-sm font-medium text-blue-300 mb-2">占位符说明</h4>
            <div className="grid grid-cols-2 gap-4 text-xs text-gray-300">
              <div>
                <p className="font-medium text-blue-200">平衡分析模板:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li><code className="bg-blue-500/20 px-1 rounded text-blue-300">{'{{SKILL_CONTENT}}'}</code> - Skill 定义内容</li>
                  <li><code className="bg-blue-500/20 px-1 rounded text-blue-300">{'{{FALSE_POSITIVE_CASES}}'}</code> - 误报案例列表</li>
                  <li><code className="bg-blue-500/20 px-1 rounded text-blue-300">{'{{CONFIRMED_CASES}}'}</code> - 正确发现案例列表</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-blue-200">改进生成模板:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li><code className="bg-blue-500/20 px-1 rounded text-blue-300">{'{{SKILL_CONTENT}}'}</code> - 原 Skill 内容</li>
                  <li><code className="bg-blue-500/20 px-1 rounded text-blue-300">{'{{FALSE_POSITIVE_PATTERNS}}'}</code> - 误报模式</li>
                  <li><code className="bg-blue-500/20 px-1 rounded text-blue-300">{'{{RECOMMENDATIONS}}'}</code> - 改进建议</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 导出一个触发按钮组件
export function PromptManagerButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center px-3 py-1.5 text-sm bg-purple-500/20 text-purple-400 rounded hover:bg-purple-500/30 border border-purple-500/30"
      >
        <FileText size={16} className="mr-1" />
        提示词配置
      </button>
      <PromptManagerModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}