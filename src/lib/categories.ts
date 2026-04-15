// src/lib/categories.ts

/**
 * 获取漏洞分类列表
 * 从 API 获取分类配置，如果失败则使用默认值
 */
export const DEFAULT_CATEGORIES = [
  { value: 'code-audit', label: '代码审计' },
  { value: 'auth', label: '认证鉴权' },
  { value: 'sensitive', label: '敏感信息' },
  { value: 'api', label: 'API 安全' },
  { value: 'config', label: '配置安全' },
  { value: 'crypto', label: '加密解密' },
  { value: 'web', label: 'Web 安全' },
  { value: 'business', label: '业务逻辑' },
  { value: 'client', label: '客户端安全' },
  { value: 'cloud', label: '云安全' },
];

export interface Category {
  value: string;
  label: string;
}

export async function getCategories(): Promise<Category[]> {
  // 检查是否在浏览器环境中
  if (typeof window === 'undefined') {
    // 服务端直接返回默认值
    return DEFAULT_CATEGORIES;
  }

  try {
    const token = localStorage.getItem('token');
    if (!token) {
      return DEFAULT_CATEGORIES;
    }

    const response = await fetch('/api/admin/categories', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return DEFAULT_CATEGORIES;
    }

    const data = await response.json();
    return data.categories || DEFAULT_CATEGORIES;
  } catch (error) {
    console.error('获取分类失败:', error);
    return DEFAULT_CATEGORIES;
  }
}
