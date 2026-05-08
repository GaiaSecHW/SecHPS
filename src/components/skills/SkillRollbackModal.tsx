'use client';

import { useState } from 'react';
import {
  X,
  RotateCcw,
  AlertTriangle,
  Loader2,
  CheckCircle,
} from 'lucide-react';

interface SkillRollbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  skillId: string;
  currentVersionId: string;
  targetVersionId: string;
  targetVersionNumber: number;
  currentVersionNumber: number;
  skillDisplayName: string;
}

export function SkillRollbackModal({
  isOpen,
  onClose,
  onSuccess,
  skillId,
  currentVersionId,
  targetVersionId,
  targetVersionNumber,
  currentVersionNumber,
  skillDisplayName,
}: SkillRollbackModalProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRollback = async () => {
    if (!reason.trim()) {
      setError('请填写回滚原因');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}/rollback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetVersionId,
          reason: reason.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '回滚失败');
      }

      // Success
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '回滚失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setReason('');
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-dark-surface rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50 bg-orange-50">
          <div className="flex items-center gap-3">
            <RotateCcw size={20} className="text-orange-600" />
            <h2 className="text-lg font-semibold text-gray-100">版本回滚确认</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-orange-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-3 p-4 bg-orange-900/20 border border-orange-500/20 rounded-lg">
            <AlertTriangle size={20} className="text-orange-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-orange-300 mb-1">
                您即将执行版本回滚操作
              </p>
              <p className="text-xs text-orange-400">
                回滚将基于 v{targetVersionNumber} 创建新的版本 v{currentVersionNumber + 1}，
                当前版本 v{currentVersionNumber} 的内容将被替换为 v{targetVersionNumber} 的内容。
              </p>
            </div>
          </div>

          {/* Info */}
          <div className="bg-[#0F172A] rounded-lg p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Skill 名称:</span>
              <span className="font-medium text-gray-100">{skillDisplayName}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-2">
              <span className="text-gray-400">当前版本:</span>
              <span className="font-medium text-gray-100">v{currentVersionNumber}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-2">
              <span className="text-gray-400">目标版本:</span>
              <span className="font-medium text-green-400">v{targetVersionNumber}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-2">
              <span className="text-gray-400">回滚后版本:</span>
              <span className="font-medium text-blue-400">v{currentVersionNumber + 1}</span>
            </div>
          </div>

          {/* Reason Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              回滚原因 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="请填写回滚原因，例如：当前版本存在误报问题，需要回滚到上一个稳定版本..."
              className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
              rows={3}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700/50 bg-[#0F172A] flex items-center justify-end gap-3">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 border border-gray-600 text-gray-700 rounded-lg hover:bg-dark-surface-hover transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleRollback}
            disabled={loading || !reason.trim()}
            className="inline-flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                回滚中...
              </>
            ) : (
              <>
                <RotateCcw size={16} className="mr-2" />
                确认回滚
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}