'use client';

import { TrendingUp } from 'lucide-react';
import { DeveloperGuard } from '@/components/PermissionGuard';

export default function EvolutionPage() {
  return (
    <DeveloperGuard>
      <div className="bg-dark-surface border border-dark-border/40 rounded-xl p-12">
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-dark-surface-hover flex items-center justify-center mx-auto mb-4">
              <TrendingUp size={24} className="text-dark-text-muted" />
            </div>
            <h3 className="text-base font-medium text-dark-text">功能开发中</h3>
            <p className="mt-1.5 text-sm text-dark-text-muted">
              智能体进化功能正在开发中，敬请期待
            </p>
          </div>
        </div>
      </div>
    </DeveloperGuard>
  );
}
