'use client';

import { useState, useEffect } from 'react';
import { BookOpen, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function AgentHarnessDeveloperGuidePage() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/docs/agent-harness')
      .then(r => r.json())
      .then(data => setContent(data.content))
      .catch(() => setError('文档加载失败'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <BookOpen size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Agent 应用开发手册</h1>
            <p className="text-sm text-gray-400 mt-0.5">AgentHarness 工程包开发指南</p>
          </div>
        </div>
        <Link
          href="/dashboard/agent-apps"
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700/50 rounded-lg hover:bg-dark-surface-hover transition-colors"
        >
          <ArrowLeft size={16} />
          返回
        </Link>
      </div>

      <div className="bg-dark-surface border border-gray-700/50 rounded-xl p-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <p className="text-center text-red-400 py-16">{error}</p>
        ) : (
          <MarkdownRenderer content={content} />
        )}
      </div>
    </div>
  );
}
