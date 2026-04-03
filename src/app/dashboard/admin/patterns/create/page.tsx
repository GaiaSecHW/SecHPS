'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import PatternForm, { PatternFormData } from '@/components/patterns/PatternForm';

export default function CreatePatternPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: PatternFormData) => {
    try {
      setError(null);
      const token = localStorage.getItem('token');

      const response = await fetch('/api/patterns', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '创建失败');
      }

      router.push('/dashboard/admin/patterns');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
      throw err;
    }
  };

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
          <h1 className="text-2xl font-bold text-gray-900">创建漏洞模式</h1>
          <p className="mt-1 text-sm text-gray-600">
            添加新的漏洞检测模式到模式库
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
        onSubmit={handleSubmit}
        onCancel={() => router.push('/dashboard/admin/patterns')}
      />
    </div>
  );
}
