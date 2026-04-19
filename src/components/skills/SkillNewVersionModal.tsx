'use client';

import { useState } from 'react';
import {
  X,
  Plus,
  AlertTriangle,
  Loader2,
  FileText,
} from 'lucide-react';

interface SkillNewVersionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  skillId: string;
  currentVersionNumber: number;
  skillDisplayName: string;
  editData: {
    displayName: string;
    description: string;
    content: string;
    isActive: boolean;
    vulnerabilityPatternId: string;
    techStackId: string;
    cwe: string | null;
  };
}

const CHANGE_TYPES = [
  { value: 'prompt-update', label: '提示词更新', description: '修改了 Skill 的提示词内容' },
  { value: 'parameter-tune', label: '参数调优', description: '调整了参数配置' },
  { value: 'tool-add', label: '添加工具', description: '新增了工具或能力' },
  { value: 'tool-remove', label: '移除工具', description: '移除了工具或能力' },
] as const;

export function SkillNewVersionModal({
  isOpen,
  onClose,
  onSuccess,
  skillId,
  currentVersionNumber,
  skillDisplayName,
  editData,
}: SkillNewVersionModalProps) {
  const [changeType, setChangeType] = useState<string>('prompt-update');
  const [changeDesc, setChangeDesc] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateVersion = async () => {
    if (!changeDesc.trim()) {
      setError('请填写变更描述');
      return;
    }
    if (!reason.trim()) {
      setError('请填写变更原因');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          createVersion: true,
          changeType,
          changeDesc: changeDesc.trim(),
          reason: reason.trim(),
          displayName: editData.displayName,
          description: editData.description,
          content: editData.content,
          isActive: editData.isActive,
          vulnerabilityPatternId: editData.vulnerabilityPatternId,
          techStackId: editData.techStackId || null,
          cwe: editData.cwe,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '创建新版本失败');
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建新版本失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setChangeType('prompt-update');
    setChangeDesc('');
    setReason('');
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-blue-50">
          <div className="flex items-center gap-3">
            <Plus size={20} className="text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">保存为新版本</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          {/* Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Skill 名称:</span>
              <span className="font-medium text-gray-900">{skillDisplayName}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-2">
              <span className="text-gray-600">当前版本:</span>
              <span className="font-medium text-gray-900">v{currentVersionNumber}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-2">
              <span className="text-gray-600">新版本:</span>
              <span className="font-medium text-blue-700">v{currentVersionNumber + 1}</span>
            </div>
          </div>

          {/* Change Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              变更类型 <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CHANGE_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setChangeType(type.value)}
                  className={`px-3 py-2 text-left rounded-lg border transition-all ${
                    changeType === type.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  <div className="text-sm font-medium">{type.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{type.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Change Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              变更描述 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={changeDesc}
              onChange={(e) => setChangeDesc(e.target.value)}
              placeholder="简要描述本次变更的内容，例如：添加了 SQL 注入检测规则"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              变更原因 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="说明为什么要进行这次变更，例如：之前的版本误报率较高，需要优化检测逻辑"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              rows={3}
            />
          </div>

          {/* Tip */}
          <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <FileText size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-blue-700">
              创建新版本后，当前版本 v{currentVersionNumber} 将保留在历史记录中，
              可以随时通过版本回滚功能恢复。
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-3">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleCreateVersion}
            disabled={loading || !changeDesc.trim() || !reason.trim()}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                创建中...
              </>
            ) : (
              <>
                <Plus size={16} className="mr-2" />
                创建新版本 v{currentVersionNumber + 1}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
