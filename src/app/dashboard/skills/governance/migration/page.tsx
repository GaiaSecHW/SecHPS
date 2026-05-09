'use client';

import Link from 'next/link';
import { ArrowLeft, CheckCircle } from 'lucide-react';

export default function MigrationReviewPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/dashboard/skills/governance"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          返回治理中心
        </Link>
        <h1 className="text-2xl font-bold text-gray-100">存量迁移审核</h1>
      </div>

      <div className="bg-green-900/20 border border-green-200 rounded-lg p-8 text-center">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-green-800 mb-2">迁移已完成</h2>
        <p className="text-green-400">
          所有 Skill 数据已完成迁移，迁移字段已清理。此页面不再需要。
        </p>
      </div>
    </div>
  );
}
