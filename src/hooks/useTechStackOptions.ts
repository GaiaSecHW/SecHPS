// src/hooks/useTechStackOptions.ts
'use client';

import { useState, useEffect } from 'react';

/**
 * 获取技术栈选项的 Hook
 * 从数据库 TechStackOption 表获取，有数据就返回，没有就是空
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

/**
 * 获取带 ID 的技术栈选项的 Hook
 * 用于需要关联 TechStackOption ID 的场景
 */
export interface TechStackOptionWithId {
  id: string;
  name: string;
  category: string;
  description?: string | null;
}

export function useTechStackOptionsWithIds(category?: string) {
  const [options, setOptions] = useState<TechStackOptionWithId[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        setLoading(true);
        const url = category 
          ? `/api/techstack-options?withIds=true&category=${category}`
          : '/api/techstack-options?withIds=true';
        const response = await fetch(url);
        
        if (response.ok) {
          const data = await response.json();
          setOptions(data.options || []);
        } else {
          setOptions([]);
        }
      } catch (error) {
        console.error('获取技术栈选项失败:', error);
        setOptions([]);
      } finally {
        setLoading(false);
      }
    };

    fetchOptions();
  }, [category]);

  return { options, loading };
}
