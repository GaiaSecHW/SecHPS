'use client';

import { useState, useEffect } from 'react';
import { BookOpen } from 'lucide-react';
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
      <div className="bg-dark-surface border border-dark-border rounded-xl p-8">
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
