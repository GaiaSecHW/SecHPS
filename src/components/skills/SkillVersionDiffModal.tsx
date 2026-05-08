'use client';

import { useState, useEffect } from 'react';
import {
  X,
  GitCompare,
  Loader2,
  AlertTriangle,
  ArrowRight,
  FileText,
} from 'lucide-react';

interface SkillVersionDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  skillId: string;
  targetVersionId: string;
  targetVersionNumber: number;
  currentVersionNumber: number;
  currentContent: string;
}

interface EvolutionData {
  beforeData: string;
  afterData: string;
  changeType: string;
  changeDesc: string;
  reason: string;
  fromVersion: number;
  toVersion: number;
}

export function SkillVersionDiffModal({
  isOpen,
  onClose,
  skillId,
  targetVersionId,
  targetVersionNumber,
  currentVersionNumber,
  currentContent,
}: SkillVersionDiffModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetContent, setTargetContent] = useState<string>('');
  const [evolution, setEvolution] = useState<EvolutionData | null>(null);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'inline'>('side-by-side');

  useEffect(() => {
    if (isOpen) {
      fetchVersionData();
    }
  }, [isOpen, targetVersionId]);

  const fetchVersionData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const token = localStorage.getItem('token');
      
      // Fetch target version details
      const response = await fetch(`/api/skills/${targetVersionId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取版本内容失败');
      }

      const data = await response.json();
      setTargetContent(data.skill?.content || '');

      // The evolution data should be fetched from versions endpoint
      // Let's get evolution from versions endpoint
      const versionsResponse = await fetch(`/api/skills/${skillId}/versions`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (versionsResponse.ok) {
        const versionsData = await versionsResponse.json();
        const versionInfo = versionsData.versions?.find((v: any) => v.id === targetVersionId);
        if (versionInfo?.evolution) {
          setEvolution({
            beforeData: versionInfo.evolution.beforeData || '',
            afterData: versionInfo.evolution.afterData || '',
            changeType: versionInfo.evolution.changeType || '',
            changeDesc: versionInfo.evolution.changeDesc || '',
            reason: versionInfo.evolution.reason || '',
            fromVersion: versionInfo.evolution.fromVersion || targetVersionNumber,
            toVersion: versionInfo.evolution.toVersion || currentVersionNumber,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取失败');
    } finally {
      setLoading(false);
    }
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

  // Simple diff - find differences between two texts
  const computeDiff = (before: string, after: string) => {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    
    const maxLen = Math.max(beforeLines.length, afterLines.length);
    const diffLines: Array<{
      type: 'same' | 'added' | 'removed' | 'modified';
      before?: string;
      after?: string;
      lineNum: number;
    }> = [];

    for (let i = 0; i < maxLen; i++) {
      const beforeLine = beforeLines[i];
      const afterLine = afterLines[i];

      if (beforeLine === afterLine) {
        diffLines.push({ type: 'same', before: beforeLine, after: afterLine, lineNum: i + 1 });
      } else if (beforeLine === undefined) {
        diffLines.push({ type: 'added', after: afterLine, lineNum: i + 1 });
      } else if (afterLine === undefined) {
        diffLines.push({ type: 'removed', before: beforeLine, lineNum: i + 1 });
      } else {
        diffLines.push({ type: 'modified', before: beforeLine, after: afterLine, lineNum: i + 1 });
      }
    }

    return diffLines;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-dark-surface rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50 bg-[#0F172A]">
          <div className="flex items-center gap-3">
            <GitCompare size={20} className="text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-100">版本对比</h2>
          </div>
          
          <div className="flex items-center gap-4">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-2 bg-dark-surface-hover rounded-lg p-1">
              <button
                onClick={() => setViewMode('side-by-side')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  viewMode === 'side-by-side'
                    ? 'bg-dark-surface shadow text-gray-100'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                并排对比
              </button>
              <button
                onClick={() => setViewMode('inline')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  viewMode === 'inline'
                    ? 'bg-dark-surface shadow text-gray-100'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                内联对比
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <span className="ml-3 text-gray-400">加载版本对比数据...</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 py-8 text-red-600">
              <AlertTriangle size={20} />
              <span>{error}</span>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Evolution Info */}
              {evolution && (
                <div className="bg-indigo-900/20 border border-indigo-500/20 rounded-lg p-4">
                  <div className="flex items-center gap-4 mb-3">
                    <span className={`px-3 py-1 rounded-lg text-sm font-medium ${getChangeTypeColor(evolution.changeType)}`}>
                      {getChangeTypeLabel(evolution.changeType)}
                    </span>
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <span className="font-medium">v{evolution.fromVersion}</span>
                      <ArrowRight size={16} />
                      <span className="font-medium">v{evolution.toVersion}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">
                    <strong>变更描述:</strong> {evolution.changeDesc}
                  </p>
                  <p className="text-xs text-gray-500">
                    <strong>原因:</strong> {evolution.reason}
                  </p>
                </div>
              )}

              {/* Diff View */}
              {viewMode === 'side-by-side' ? (
                <div className="grid grid-cols-2 gap-4">
                  {/* Before (Target Version) */}
                  <div className="border border-gray-700/50 rounded-lg overflow-hidden">
                    <div className="px-4 py-2 bg-dark-surface-hover border-b border-gray-700/50 flex items-center gap-2">
                      <FileText size={16} className="text-gray-500" />
                      <span className="font-medium text-gray-300">v{targetVersionNumber} (目标版本)</span>
                    </div>
                    <pre className="p-4 text-sm text-gray-700 overflow-auto max-h-[400px] whitespace-pre-wrap font-mono">
                      {targetContent || '暂无内容'}
                    </pre>
                  </div>

                  {/* After (Current Version) */}
                  <div className="border border-gray-700/50 rounded-lg overflow-hidden">
                    <div className="px-4 py-2 bg-dark-surface-hover border-b border-gray-700/50 flex items-center gap-2">
                      <FileText size={16} className="text-gray-500" />
                      <span className="font-medium text-gray-300">v{currentVersionNumber} (当前版本)</span>
                    </div>
                    <pre className="p-4 text-sm text-gray-700 overflow-auto max-h-[400px] whitespace-pre-wrap font-mono">
                      {currentContent || '暂无内容'}
                    </pre>
                  </div>
                </div>
              ) : (
                /* Inline Diff View */
                <div className="border border-gray-700/50 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-dark-surface-hover border-b border-gray-700/50 flex items-center gap-2">
                    <FileText size={16} className="text-gray-500" />
                    <span className="font-medium text-gray-300">内联对比视图</span>
                    <div className="ml-auto flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 bg-red-200 rounded"></span>
                        删除
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 bg-green-200 rounded"></span>
                        新增
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 bg-yellow-200 rounded"></span>
                        修改
                      </span>
                    </div>
                  </div>
                  <div className="overflow-auto max-h-[400px]">
                    {computeDiff(targetContent, currentContent).map((line, idx) => (
                      <div
                        key={idx}
                        className={`flex items-stretch font-mono text-sm ${
                          line.type === 'removed' ? 'bg-red-50' :
                          line.type === 'added' ? 'bg-green-50' :
                          line.type === 'modified' ? 'bg-yellow-50' :
                          ''
                        }`}
                      >
                        <span className="px-2 py-1 bg-dark-surface-hover text-gray-400 text-xs min-w-[40px] text-right select-none">
                          {line.lineNum}
                        </span>
                        {line.type === 'removed' && (
                          <span className="px-4 py-1 text-red-400 flex-1">
                            <span className="text-red-400 mr-2">-</span>
                            {line.before}
                          </span>
                        )}
                        {line.type === 'added' && (
                          <span className="px-4 py-1 text-green-400 flex-1">
                            <span className="text-green-400 mr-2">+</span>
                            {line.after}
                          </span>
                        )}
                        {line.type === 'modified' && (
                          <>
                            <span className="px-4 py-1 text-red-400 flex-1 border-r border-gray-700/50">
                              <span className="text-red-400 mr-2">-</span>
                              {line.before}
                            </span>
                            <span className="px-4 py-1 text-green-400 flex-1">
                              <span className="text-green-400 mr-2">+</span>
                              {line.after}
                            </span>
                          </>
                        )}
                        {line.type === 'same' && (
                          <span className="px-4 py-1 text-gray-700 flex-1">
                            <span className="text-gray-300 mr-2"> </span>
                            {line.before}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700/50 bg-[#0F172A] flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}