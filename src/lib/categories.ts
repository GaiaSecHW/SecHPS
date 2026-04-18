// src/lib/categories.ts

import type { Category } from '@/types/skills';

export type { Category };

/**
 * 获取漏洞分类列表
 * 从 SystemConfig 获取，数据库没有就返回空数组
 */
export async function getCategories(): Promise<Category[]> {
  // 检查是否在浏览器环境中
  if (typeof window === 'undefined') {
    // 服务端直接返回空数组（服务端应通过 Prisma 直接查询）
    return [];
  }

  try {
    const token = localStorage.getItem('token');
    if (!token) {
      return [];
    }

    const response = await fetch('/api/admin/categories', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.categories || [];
  } catch (error) {
    console.error('获取分类失败:', error);
    return [];
  }
}