// src/hooks/useSkillCategories.ts
'use client';

import { useState, useEffect } from 'react';

/**
 * Skill 分类类型
 */
export interface SkillCategory {
  name: string;
  label: string;
  count: number;
}

/**
 * 获取 Skill 分类列表的 Hook
 * 从 /api/skills/categories 获取数据（数据源：SystemConfig.skill_categories）
 */
export function useSkillCategories() {
  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoading(true);
        setError(null);

        const token = localStorage.getItem('token');
        if (!token) {
          setError('未登录');
          setCategories([]);
          return;
        }

        const response = await fetch('/api/skills/categories', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('获取 Skill 分类失败');
        }

        const data = await response.json();
        setCategories(data.categories || []);
      } catch (err) {
        console.error('获取 Skill 分类失败:', err);
        setError(err instanceof Error ? err.message : '获取失败');
        setCategories([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCategories();
  }, []);

  /**
   * 分类标签映射 (name -> label)
   */
  const categoryLabels = categories.reduce((acc, cat) => {
    acc[cat.name] = cat.label;
    return acc;
  }, {} as Record<string, string>);

  return {
    categories,
    categoryLabels,
    loading,
    error,
  };
}