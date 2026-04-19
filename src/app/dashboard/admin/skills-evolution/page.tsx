'use client';

import { TrendingUp } from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';

export default function SkillsEvolutionPage() {
  return (
    <AdminGuard>
      <SkillsEvolutionContent />
    </AdminGuard>
  );
}

function SkillsEvolutionContent() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Skills 进化</h1>
        <p className="mt-1 text-sm text-gray-600">
          管理 AI 技能的进化和优化
        </p>
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
        <div className="text-center">
          <TrendingUp className="mx-auto h-16 w-16 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            Skills 进化功能开发中
          </h3>
          <p className="mt-2 text-sm text-gray-600">
            此功能将在后续版本中提供，敬请期待
          </p>
        </div>
      </div>
    </div>
  );
}
