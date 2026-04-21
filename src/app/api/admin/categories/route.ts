// src/app/api/admin/categories/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

// GET /api/admin/categories - 获取漏洞分类列表
export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
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
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
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
            id: cat.id || generateId('cat'),
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