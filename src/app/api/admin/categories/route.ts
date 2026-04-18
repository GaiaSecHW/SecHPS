// src/app/api/admin/categories/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/admin/categories - 获取漏洞分类列表
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

    // 从 VulnerabilityCategory 表获取分类列表
    const categories = await prisma.vulnerabilityCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, value: true, label: true, description: true, sortOrder: true },
    });

    return NextResponse.json({ 
      categories: categories.map(c => ({ 
        id: c.id,
        value: c.value, 
        label: c.label,
        description: c.description,
        sortOrder: c.sortOrder,
      })) 
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取漏洞分类失败', { details: String(error) });
    return NextResponse.json({ categories: [] });
  }
}

// PUT /api/admin/categories - 更新漏洞分类列表
export async function PUT(request: Request) {
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

    // 检查管理员权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问 - 需要管理员权限' }, { status: 403 });
    }

    const body = await request.json();
    const { categories } = body;

    if (!Array.isArray(categories)) {
      return NextResponse.json({ error: '分类必须是数组格式' }, { status: 400 });
    }

    // 验证每个分类
    for (const cat of categories) {
      if (!cat.value || !cat.label) {
        return NextResponse.json({ error: '每个分类必须包含 value 和 label' }, { status: 400 });
      }
    }

    // 获取当前分类列表，检查是否有分类被删除
    const currentCategories = await prisma.vulnerabilityCategory.findMany({
      where: { isActive: true },
    });
    const currentValues = currentCategories.map(c => c.value);
    const newValues = categories.map(c => c.value);
    
    // 找出被删除的分类值
    const deletedValues = currentValues.filter(v => !newValues.includes(v));
    
    // 检查被删除的分类是否被漏洞模式引用
    for (const deletedValue of deletedValues) {
      const patternCount = await prisma.vulnerabilityPattern.count({
        where: { category: deletedValue, isActive: true },
      });
      
      if (patternCount > 0) {
        const deletedCategory = currentCategories.find(c => c.value === deletedValue);
        return NextResponse.json({
          error: `分类 "${deletedCategory?.label || deletedValue}" 被 ${patternCount} 个漏洞模式引用，无法删除`,
          deletedCategory: deletedValue,
          patternCount,
        }, { status: 400 });
      }
    }

    // 更新分类：先标记删除的不活跃，再创建或更新
    await prisma.$transaction(async (tx) => {
      // 标记删除的分类为不活跃
      for (const deletedValue of deletedValues) {
        await tx.vulnerabilityCategory.updateMany({
          where: { value: deletedValue },
          data: { isActive: false, updatedAt: new Date() },
        });
      }

      // 创建或更新分类
      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        await tx.vulnerabilityCategory.upsert({
          where: { value: cat.value },
          update: {
            label: cat.label,
            description: cat.description,
            sortOrder: i,
            isActive: true,
            updatedAt: new Date(),
          },
          create: {
            id: cat.id || `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            value: cat.value,
            label: cat.label,
            description: cat.description,
            sortOrder: i,
            updatedAt: new Date(),
          },
        });
      }
    });

    // 返回更新后的列表
    const updatedCategories = await prisma.vulnerabilityCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    logger.update(LOG_MODULES.CONFIG, payload, 'vulnerability_categories', { categoriesCount: categories.length });
    return NextResponse.json({ categories: updatedCategories });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '更新漏洞分类失败', { details: String(error) });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}