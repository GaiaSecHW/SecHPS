'use client';

import { useState, useEffect } from 'react';
import {
  History,
  ChevronRight,
  RotateCcw,
  GitCompare,
  Eye,
  Clock,
  CheckCircle,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

interface SkillEvolution {
  skillId: string;
  changeDesc: string;
  reason: string;
  changeType: string;
  fromVersion: number;
  toVersion: number;
}

interface SkillVersion {
  id: string;
  version: number;
  isLatest: boolean;
  createdAt: string;
  displayName: string;
  description: string;
  severity: string | null;
  evolution: SkillEvolution | null;
}

interface SkillVersionHistoryProps {
  skillId: string;
  currentVersionId: string;
  onSelectVersion: (versionId: string, versionNumber: number) => void;
  onRollback: (versionId: string, versionNumber: number) => void;
  onCompare: (versionId: string, versionNumber: number) => void;
  canEdit: boolean; // 是否有权限回滚
}

export function SkillVersionHistory({
  skillId,
  currentVersionId,
  onSelectVersion,
  onRollback,
  onCompare,
  canEdit,
}: SkillVersionHistoryProps) {
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    fetchVersions();
  }, [skillId]);

  const fetchVersions = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}/versions`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取版本历史失败');
      }

      const data = await response.json();
      setVersions(data.versions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取失败');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getChangeTypeLabel = (changeType: string) => {
    const labels: Record<string, string> = {
      'prompt-update': '提示词更新',
      'parameter-tune': '参数调优',
      'tool-add': '添加工具',
      'tool-remove': '移除工具',
    };
    return labels[changeType] || changeType;
  };

  const getChangeTypeColor = (changeType: string) => {
    const colors: Record<string, string> = {
      'prompt-update': 'bg-blue-100 text-blue-700',
      'parameter-tune': 'bg-yellow-100 text-yellow-700',
      'tool-add': 'bg-green-100 text-green-700',
      'tool-remove': 'bg-red-100 text-red-700',
    };
    return colors[changeType] || 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-4 text-red-600">
        <AlertTriangle size={16} />
        <span>{error}</span>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="py-4 text-gray-500 text-sm">
        暂无版本历史记录
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <History size={18} className="text-gray-600" />
          <span className="font-medium text-gray-900">版本历史</span>
          <span className="text-sm text-gray-500">
            ({versions.length} 个版本)
          </span>
        </div>
        <ChevronRight
          size={18}
          className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {/* Version List */}
      {expanded && (
        <div className="divide-y divide-gray-100">
          {versions.map((v, index) => (
            <div
              key={v.id}
              className={`p-4 ${v.id === currentVersionId ? 'bg-blue-50' : 'hover:bg-gray-50'} transition-colors`}
            >
              <div className="flex items-start justify-between">
                {/* Version Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    {/* Version Number */}
                    <span className={`px-3 py-1 rounded-lg font-medium text-sm ${
                      v.isLatest
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      v{v.version}
                    </span>

                    {/* Latest Badge */}
                    {v.isLatest && (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle size={14} />
                        当前版本
                      </span>
                    )}

                    {/* Change Type Badge */}
                    {v.evolution && (
                      <span className={`px-2 py-0.5 rounded text-xs ${getChangeTypeColor(v.evolution.changeType)}`}>
                        {getChangeTypeLabel(v.evolution.changeType)}
                      </span>
                    )}
                  </div>

                  {/* Change Description */}
                  {v.evolution?.changeDesc && (
                    <p className="text-sm text-gray-700 mb-1">
                      {v.evolution.changeDesc}
                    </p>
                  )}

                  {/* Reason */}
                  {v.evolution?.reason && (
                    <p className="text-xs text-gray-500 mb-2">
                      原因: {v.evolution.reason}
                    </p>
                  )}

                  {/* Timestamp */}
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Clock size={12} />
                    <span>{formatDate(v.createdAt)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-4">
                  {/* View Version */}
                  <button
                    onClick={() => onSelectVersion(v.id, v.version)}
                    className="inline-flex items-center px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                    title="查看此版本内容"
                  >
                    <Eye size={14} className="mr-1" />
                    查看
                  </button>

                  {/* Compare (not for latest or first version) */}
                  {!v.isLatest && index < versions.length - 1 && (
                    <button
                      onClick={() => onCompare(v.id, v.version)}
                      className="inline-flex items-center px-2 py-1 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors"
                      title="对比此版本与当前版本"
                    >
                      <GitCompare size={14} className="mr-1" />
                      对比
                    </button>
                  )}

                  {/* Rollback (not for latest, only if canEdit) */}
                  {!v.isLatest && canEdit && (
                    <button
                      onClick={() => onRollback(v.id, v.version)}
                      className="inline-flex items-center px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200 transition-colors"
                      title="回滚到此版本"
                    >
                      <RotateCcw size={14} className="mr-1" />
                      回滚
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}