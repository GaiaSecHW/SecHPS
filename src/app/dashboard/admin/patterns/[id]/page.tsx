'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import PatternForm, { PatternFormData } from '@/components/patterns/PatternForm';

interface Pattern {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe: string | null;
  cve: string | null;
  patterns: string[];
  languages: string[];
  exampleVulnerable: string | null;
  exampleFixed: string | null;
  fixGuidance: string | null;
  isActive: boolean;
  isBuiltin: boolean;
}

export default function EditPatternPage() {
  const router = useRouter();
  const params = useParams();
  const patternId = params.id as string;

  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPattern();
  }, [patternId]);

  const fetchPattern = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/patterns/${patternId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('获取模式详情失败');
      }

      const data = await response.json();
      setPattern(data.pattern);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (data: PatternFormData) => {
    try {
      setError(null);
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/patterns/${patternId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '更新失败');
      }

      router.push('/dashboard/admin/patterns');
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
      throw err;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!pattern) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">模式不存在</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">编辑漏洞模式</h1>
          <p className="mt-1 text-sm text-gray-600">
            {pattern.isBuiltin ? '内置模式只能修改启用状态' : '修改漏洞检测模式配置'}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Form */}
      <PatternForm
        initialData={{
          name: pattern.name,
          displayName: pattern.displayName,
          description: pattern.description,
          category: pattern.category,
          cwe: pattern.cwe || '',
          cve: pattern.cve || '',
          patterns: pattern.patterns,
          languages: pattern.languages,
          exampleVulnerable: pattern.exampleVulnerable || '',
          exampleFixed: pattern.exampleFixed || '',
          fixGuidance: pattern.fixGuidance || '',
          isActive: pattern.isActive,
        }}
        onSubmit={handleSubmit}
        onCancel={() => router.push('/dashboard/admin/patterns')}
        isEditing
        isBuiltin={pattern.isBuiltin}
      />
    </div>
  );
}
