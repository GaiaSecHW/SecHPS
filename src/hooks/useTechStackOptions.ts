// src/hooks/useTechStackOptions.ts
'use client';

import { useState, useEffect } from 'react';

/**
 * 获取技术栈选项的 Hook
 * 优先从数据库获取，数据库为空则返回默认值
 */
export function useTechStackOptions() {
  const [options, setOptions] = useState<string[]>([]);
  const [categories, setCategories] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'database' | 'default'>('default');

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/techstack-options');
        
        if (response.ok) {
          const data = await response.json();
          setOptions(data.options || []);
          setCategories(data.categories || {});
          setSource(data.source || 'default');
        } else {
          // 出错时使用空数组
          setOptions([]);
          setCategories({});
        }
      } catch (error) {
        console.error('获取技术栈选项失败:', error);
        setOptions([]);
        setCategories({});
      } finally {
        setLoading(false);
      }
    };

    fetchOptions();
  }, []);

  return { options, categories, loading, source };
}
