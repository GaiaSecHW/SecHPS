'use client';

import { Network } from 'lucide-react';
import { DeveloperGuard } from '@/components/PermissionGuard';

export default function KnowledgeGraphPage() {
  return (
    <DeveloperGuard>
      <div className="space-y-6">
        <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center">
              <Network size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">知识图谱</h1>
              <p className="text-sm text-gray-400 mt-0.5">可视化知识关系网络</p>
            </div>
          </div>
        </div>

        <div className="bg-dark-surface border border-gray-700/50 rounded-xl p-12">
          <div className="text-center">
            <Network className="mx-auto h-16 w-16 text-gray-500 opacity-60" />
            <h3 className="mt-4 text-lg font-medium text-gray-100">功能开发中</h3>
            <p className="mt-2 text-sm text-gray-500">
              该功能正在开发中，敬请期待
            </p>
          </div>
        </div>
      </div>
    </DeveloperGuard>
  );
}