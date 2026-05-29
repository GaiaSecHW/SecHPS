'use client';

import { TrendingUp } from 'lucide-react';
import { DeveloperGuard } from '@/components/PermissionGuard';

export default function EvolutionPage() {
  return (
    <DeveloperGuard>
      <div className="space-y-6">
        <div className="bg-dark-surface border border-dark-border rounded-xl p-12">
          <div className="text-center">
            <TrendingUp className="mx-auto h-16 w-16 text-dark-text-muted opacity-60" />
            <h3 className="mt-4 text-lg font-medium text-dark-text">功能开发中</h3>
            <p className="mt-2 text-sm text-dark-text-muted">
              该功能正在开发中，敬请期待
            </p>
          </div>
        </div>
      </div>
    </DeveloperGuard>
  );
}