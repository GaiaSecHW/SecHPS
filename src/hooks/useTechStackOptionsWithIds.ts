// src/hooks/useTechStackOptionsWithIds.ts
'use client';

import { useState, useEffect } from 'react';

/**
 * 技术栈选项数据类型（带 ID）
 */
export interface TechStackOptionWithId {
  id: string;
  name: string;
  category: string;
  description?: string | null;
}

/**
 * 获取技术栈选项的 Hook（带 ID，用于单选下拉）
 * 从 /api/techstack-options?withIds=true 获取数据
 * 
 * @param category 可选，筛选特定类别（如 'language'）
 */
export function useTechStackOptionsWithIds(category?: string) {
  const [options, setOptions] = useState<TechStackOptionWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const params = new URLSearchParams({ withIds: 'true' });
        if (category) {
          params.set('category', category);
        }
        
        const response = await fetch(`/api/techstack-options?${params.toString()}`);
        
        if (!response.ok) {
          throw new Error('获取技术栈选项失败');
        }

        const data = await response.json();
        setOptions(data.options || []);
      } catch (err) {
        console.error('获取技术栈选项失败:', err);
        setError(err instanceof Error ? err.message : '获取失败');
        setOptions([]);
      } finally {
        setLoading(false);
      }
    };

    fetchOptions();
  }, [category]);

  return { options, loading, error };
}