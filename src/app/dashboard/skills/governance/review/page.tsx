'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface DuplicateGroup {
  id: string;
  name: string | null;
  language: string;
  vulnerabilityType: string;
  status: string;
  skillCount: number;
  createdAt: string;
  members: Array<{
    skillId: string;
    skillName: string;
    skillDisplayName: string;
    role: string;
    similarityScore: number;
  }>;
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ReviewPageContent />
    </Suspense>
  );
}

function ReviewPageContent() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/skills-governance/duplicates', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups || []);
      }
    } catch (err) {
      console.error('获取重复组失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const runFullAnalysis = async () => {
    if (!confirm('确定要运行全量重复分析吗？这可能需要一些时间。')) {
      return;
    }

    try {
      setAnalyzing(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/admin/skills-governance/full-analysis', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'execute' }),
      });

      if (!response.ok) throw new Error('分析失败');
      
      const result = await response.json();
      alert(`分析完成！发现 ${result.duplicateGroups || 0} 个重复组`);
      fetchGroups();
    } catch (err) {
      console.error('分析失败:', err);
      alert('分析失败，请重试');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleResolve = async (groupId: string, action: 'keep_all' | 'merge') => {
    const confirmMsg = action === 'merge' 
      ? '确定要合并这个重复组吗？将保留主要 Skill，其他标记为重复。'
      : '确定要保留所有 Skill 吗？';
    
    if (!confirm(confirmMsg)) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/skills-governance/duplicates/${groupId}/resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) throw new Error('操作失败');
      
      fetchGroups();
    } catch (err) {
      console.error('操作失败:', err);
      alert('操作失败，请重试');
    }
  };

  return (
    <div className="p-6">
      {/* 页面标题 */}
      <div className="mb-6">
        <Link
          href="/dashboard/skills/governance"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          返回治理中心
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-100">重复组审核</h1>
            <p className="text-gray-400 mt-1">查看和处理相似的 Skill 组</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchGroups}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-300 bg-dark-surface border border-gray-600 rounded-md hover:bg-dark-surface-hover"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
            <button
              onClick={runFullAnalysis}
              disabled={analyzing}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {analyzing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  分析中...
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4" />
                  运行全量分析
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 说明 */}
      <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-yellow-300 mb-2">使用说明</h3>
        <ol className="text-sm text-gray-300 space-y-1 list-decimal list-inside">
          <li>点击"运行全量分析"扫描所有 Skill 的相似性</li>
          <li>系统会识别出可能重复的 Skill 组</li>
          <li>审核每组，决定是合并还是保留全部</li>
        </ol>
      </div>

      {/* 列表 */}
      {loading ? (
        <LoadingSpinner />
      ) : groups.length === 0 ? (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-12 text-center">
          <AlertTriangle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 mb-4">暂无重复组数据</p>
          <p className="text-sm text-gray-400">
            点击上方"运行全量分析"开始扫描
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div
              key={group.id}
              className="bg-dark-surface rounded-lg border border-gray-700/50 overflow-hidden"
            >
              <div className="px-4 py-3 bg-dark-bg border-b border-gray-700/50 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-100">
                    {group.name || `${group.language} - ${group.vulnerabilityType}`}
                  </p>
                  <p className="text-sm text-gray-500">
                    语言: {group.language} | 漏洞类型: {group.vulnerabilityType} | 
                    成员: {group.skillCount} 个
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {group.status === 'pending_review' && (
                    <>
                      <button
                        onClick={() => handleResolve(group.id, 'keep_all')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-300 bg-dark-surface-hover rounded hover:bg-gray-200"
                      >
                        <CheckCircle className="h-3 w-3" />
                        保留全部
                      </button>
                      <button
                        onClick={() => handleResolve(group.id, 'merge')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                      >
                        合并
                      </button>
                    </>
                  )}
                  {group.status === 'resolved' && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      <CheckCircle className="h-3 w-3" />
                      已处理
                    </span>
                  )}
                </div>
              </div>
              
              <div className="divide-y divide-gray-100">
                {group.members.map((member) => (
                  <div
                    key={member.skillId}
                    className="px-4 py-3 flex items-center justify-between hover:bg-dark-surface-hover"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          member.role === 'primary'
                            ? 'bg-blue-100 text-blue-400'
                            : 'bg-dark-surface-hover text-gray-400'
                        }`}
                      >
                        {member.role === 'primary' ? '主要' : '成员'}
                      </span>
                      <div>
                        <p className="font-medium text-gray-100">
                          {member.skillDisplayName}
                        </p>
                        <p className="text-sm text-gray-500">{member.skillName}</p>
                      </div>
                    </div>
                    <div className="text-sm text-gray-500">
                      相似度: {Math.round(member.similarityScore * 100)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
