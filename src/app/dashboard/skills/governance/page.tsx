'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  FileCheck,
  RefreshCw,
  XCircle,
  ArrowRight,
  Database,
  Users,
  BarChart3,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface GovernanceStatus {
  migration: {
    total: number;
    migrated: number;
    pendingReview: number;
    failed: number;
    pending: number;
  };
  duplicateGroups: {
    total: number;
    pending: number;
    resolved: number;
  };
  pendingReviews: number;
}

export default function GovernancePage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <GovernancePageContent />
    </Suspense>
  );
}

function GovernancePageContent() {
  const router = useRouter();
  const [status, setStatus] = useState<GovernanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/skills-governance/status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取治理状态失败');
      }

      const data = await response.json();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-900/20 border border-red-200 rounded-lg p-4">
          <p className="text-red-400">{error}</p>
          <button
            onClick={fetchStatus}
            className="mt-2 text-sm text-red-400 underline"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const migrationProgress = status?.migration
    ? Math.round(
        ((status.migration.migrated + status.migration.pendingReview) /
          status.migration.total) *
          100
      )
    : 0;

  return (
    <div className="p-6">
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Skill 治理中心</h1>
        <p className="text-gray-400 mt-1">
          管理 Skill 迁移、重复检测和人工审核
        </p>
      </div>

      {/* 快捷操作 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link
          href="/dashboard/skills/governance/migration"
          className="bg-dark-surface rounded-lg border border-gray-700/50 p-6 hover:border-blue-300 hover:shadow-md transition-all"
        >
          <div className="flex items-center justify-between mb-4">
            <Database className="h-8 w-8 text-blue-500" />
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-100">存量迁移</h3>
          <p className="text-sm text-gray-400 mt-1">
            审核 LLM 推断结果，完成存量数据迁移
          </p>
          {status?.migration.pendingReview ? (
            <p className="text-sm text-orange-600 mt-2">
              {status.migration.pendingReview} 条待审核
            </p>
          ) : null}
        </Link>

        <Link
          href="/dashboard/skills/governance/review"
          className="bg-dark-surface rounded-lg border border-gray-700/50 p-6 hover:border-blue-300 hover:shadow-md transition-all"
        >
          <div className="flex items-center justify-between mb-4">
            <FileCheck className="h-8 w-8 text-green-500" />
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-100">重复组审核</h3>
          <p className="text-sm text-gray-400 mt-1">
            查看和处理重复 Skill 组
          </p>
          {status?.duplicateGroups.pending ? (
            <p className="text-sm text-orange-600 mt-2">
              {status.duplicateGroups.pending} 组待处理
            </p>
          ) : null}
        </Link>

        <button
          onClick={() => router.push('/dashboard/skills')}
          className="bg-dark-surface rounded-lg border border-gray-700/50 p-6 hover:border-blue-300 hover:shadow-md transition-all text-left"
        >
          <div className="flex items-center justify-between mb-4">
            <BarChart3 className="h-8 w-8 text-purple-500" />
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-100">Skill 列表</h3>
          <p className="text-sm text-gray-400 mt-1">
            查看所有 Skill 及其迁移状态
          </p>
          {status?.migration.total ? (
            <p className="text-sm text-gray-500 mt-2">
              共 {status.migration.total} 条记录
            </p>
          ) : null}
        </button>
      </div>

      {/* 迁移状态卡片 */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-100">迁移进度</h2>
          <button
            onClick={fetchStatus}
            className="text-sm text-gray-500 hover:text-gray-300 flex items-center gap-1"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>

        {/* 进度条 */}
        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-400 mb-1">
            <span>迁移进度</span>
            <span>{migrationProgress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-3">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all"
              style={{ width: `${migrationProgress}%` }}
            />
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-dark-bg rounded-lg p-4">
            <p className="text-sm text-gray-400">总计</p>
            <p className="text-2xl font-bold text-gray-100">
              {status?.migration.total || 0}
            </p>
          </div>
          <div className="bg-green-900/20 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <p className="text-sm text-green-400">已迁移</p>
            </div>
            <p className="text-2xl font-bold text-green-400">
              {status?.migration.migrated || 0}
            </p>
          </div>
          <div className="bg-orange-900/20 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-500" />
              <p className="text-sm text-orange-600">待审核</p>
            </div>
            <p className="text-2xl font-bold text-orange-700">
              {status?.migration.pendingReview || 0}
            </p>
          </div>
          <div className="bg-red-900/20 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <p className="text-sm text-red-400">失败</p>
            </div>
            <p className="text-2xl font-bold text-red-400">
              {status?.migration.failed || 0}
            </p>
          </div>
          <div className="bg-dark-bg rounded-lg p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-gray-500" />
              <p className="text-sm text-gray-400">待处理</p>
            </div>
            <p className="text-2xl font-bold text-gray-300">
              {status?.migration.pending || 0}
            </p>
          </div>
        </div>
      </div>

      {/* 说明信息 */}
      <div className="bg-blue-900/20 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">治理流程说明</h3>
        <ol className="text-sm text-blue-400 space-y-1 list-decimal list-inside">
          <li>系统使用规则引擎自动推断存量 Skill 的语言和漏洞类型</li>
          <li>高置信度结果自动迁移，中置信度结果需要人工审核</li>
          <li>审核完成后可运行重复检测，识别相似的 Skill</li>
          <li>重复组处理后，治理流程完成</li>
        </ol>
      </div>
    </div>
  );
}
