// src/app/api/skills/categories/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/skills/categories - 获取 Skills 分类列表
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const categories = await prisma.skill.groupBy({
      by: ['category'],
      _count: {
        id: true,
      },
      where: {
        isActive: true,
      },
    });

    const categoryLabels: Record<string, string> = {
      'code-audit': '代码安全审计',
      'auth': '认证与授权',
      'sensitive': '敏感信息泄露',
      'api': 'API 安全',
      'config': '依赖与配置',
      'crypto': '加密与数据',
      'web': 'Web 安全',
      'business': '业务逻辑',
      'client': '客户端安全',
      'cloud': '云与容器安全',
    };

    const result = categories.map(c => ({
      name: c.category,
      label: categoryLabels[c.category] || c.category,
      count: c._count.id,
    }));

    return NextResponse.json({ categories: result });
  } catch (error) {
    console.error('获取 Skills 分类错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
