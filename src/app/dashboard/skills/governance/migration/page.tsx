'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Eye,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface SkillForReview {
  id: string;
  name: string;
  displayName: string;
  description: string;
  originalTechStack: string | null;
  originalCategory: string;
  originalCwe: string | null;
  techStackId: string | null;
  vulnerabilityPatternId: string | null;
  migrationStatus: string;
  migrationConfidence: number | null;
  migrationNotes: string | null;
  techStackName?: string | null;
  vulnerabilityPatternName?: string | null;
}

interface MigrationStatus {
  total: number;
  migrated: number;
  pendingReview: number;
  failed: number;
  pending: number;
}

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

export default function MigrationReviewPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <MigrationReviewPageContent />
    </Suspense>
  );
}

function MigrationReviewPageContent() {
  const [skills, setSkills] = useState<SkillForReview[]>([]);
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending_review' | 'failed' | 'all'>('pending_review');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    fetchSkills();
    fetchStatus();
  }, [filter, page]);

  const fetchStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/skills-governance/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setStatus(data.migration);
      }
    } catch (err) {
      console.error('获取状态失败:', err);
    }
  };

  const fetchSkills = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        migrationStatus: filter === 'all' ? '' : filter,
        page: page.toString(),
        limit: pageSize.toString(),
      });
      
      const response = await fetch(`/api/skills?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('获取数据失败');

      const data = await response.json();
      setSkills(data.data || data.skills || []);
      setTotalPages(Math.ceil((data.total || 0) / pageSize));
    } catch (err) {
      console.error('获取 Skill 列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (skillId: string) => {
    try {
      setProcessing(skillId);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/admin/skills-governance/migration`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'approve',
          skillId,
        }),
      });

      if (!response.ok) throw new Error('审批失败');
      
      // 刷新列表
      fetchSkills();
      fetchStatus();
    } catch (err) {
      console.error('审批失败:', err);
      alert('审批失败，请重试');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (skillId: string) => {
    const notes = prompt('请输入拒绝原因（可选）：');
    if (notes === null) return; // 用户取消
    
    try {
      setProcessing(skillId);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/admin/skills-governance/migration`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'reject',
          skillId,
          notes,
        }),
      });

      if (!response.ok) throw new Error('拒绝失败');
      
      fetchSkills();
      fetchStatus();
    } catch (err) {
      console.error('拒绝失败:', err);
      alert('操作失败，请重试');
    } finally {
      setProcessing(null);
    }
  };

  const getConfidenceColor = (confidence: number | null) => {
    if (confidence === null) return 'text-gray-500';
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.6) return 'text-yellow-600';
    if (confidence >= 0.4) return 'text-orange-600';
    return 'text-red-600';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'migrated':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="h-3 w-3" />
            已迁移
          </span>
        );
      case 'pending_review':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <Clock className="h-3 w-3" />
            待审核
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <XCircle className="h-3 w-3" />
            失败
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="p-6">
      {/* 页面标题 */}
      <div className="mb-6">
        <Link
          href="/dashboard/skills/governance"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          返回治理中心
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">存量迁移审核</h1>
        <p className="text-gray-600 mt-1">审核 LLM 推断结果，确认或修正迁移数据</p>
      </div>

      {/* 状态概览 */}
      {status && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-6">
              <div>
                <p className="text-sm text-gray-600">待审核</p>
                <p className="text-xl font-bold text-orange-600">{status.pendingReview}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">已迁移</p>
                <p className="text-xl font-bold text-green-600">{status.migrated}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">失败</p>
                <p className="text-xl font-bold text-red-600">{status.failed}</p>
              </div>
            </div>
            <button
              onClick={fetchSkills}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => { setFilter('pending_review'); setPage(1); }}
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${
            filter === 'pending_review'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          待审核
        </button>
        <button
          onClick={() => { setFilter('failed'); setPage(1); }}
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${
            filter === 'failed'
              ? 'bg-red-100 text-red-700'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          失败
        </button>
        <button
          onClick={() => { setFilter('all'); setPage(1); }}
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${
            filter === 'all'
              ? 'bg-gray-200 text-gray-800'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          全部
        </button>
      </div>

      {/* 列表 */}
      {loading ? (
        <LoadingSpinner />
      ) : skills.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <AlertTriangle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">没有找到需要审核的记录</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Skill 名称
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  原始数据
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  推断结果
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  置信度
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  状态
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {skills.map((skill) => (
                <tr key={skill.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-gray-900">{skill.displayName}</p>
                      <p className="text-sm text-gray-500">{skill.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm">
                      <p className="text-gray-600">
                        <span className="font-medium">技术栈:</span>{' '}
                        {skill.originalTechStack || '无'}
                      </p>
                      <p className="text-gray-600">
                        <span className="font-medium">分类:</span> {skill.originalCategory}
                      </p>
                      {skill.originalCwe && (
                        <p className="text-gray-600">
                          <span className="font-medium">CWE:</span> {skill.originalCwe}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm">
                      <p className="text-gray-600">
                        <span className="font-medium">语言:</span>{' '}
                        {skill.techStackName || '-'}
                      </p>
                      <p className="text-gray-600">
                        <span className="font-medium">漏洞类型:</span>{' '}
                        {skill.vulnerabilityPatternName || '-'}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-medium ${getConfidenceColor(skill.migrationConfidence)}`}>
                      {skill.migrationConfidence !== null
                        ? `${Math.round(skill.migrationConfidence * 100)}%`
                        : '-'}
                    </span>
                    {skill.migrationNotes && (
                      <p className="text-xs text-gray-500 mt-1 max-w-xs truncate" title={skill.migrationNotes}>
                        {skill.migrationNotes}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {getStatusBadge(skill.migrationStatus)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {skill.migrationStatus === 'pending_review' && (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleApprove(skill.id)}
                          disabled={processing === skill.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded hover:bg-green-200 disabled:opacity-50"
                        >
                          <CheckCircle className="h-3 w-3" />
                          确认
                        </button>
                        <button
                          onClick={() => handleReject(skill.id)}
                          disabled={processing === skill.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded hover:bg-red-200 disabled:opacity-50"
                        >
                          <XCircle className="h-3 w-3" />
                          拒绝
                        </button>
                      </div>
                    )}
                    {skill.migrationStatus === 'failed' && (
                      <Link
                        href={`/dashboard/skills/${skill.id}`}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200"
                      >
                        <Eye className="h-3 w-3" />
                        查看
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="p-2 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-4 py-2 text-sm text-gray-600">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="p-2 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
