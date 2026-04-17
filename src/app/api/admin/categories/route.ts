// src/app/api/admin/categories/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// 基于 OWASP Top 10 2021 和 CWE Top 25 2023 的漏洞分类
const DEFAULT_CATEGORIES = [
  // OWASP Top 10 2021
  { value: 'access-control', label: '访问控制' },      // A01
  { value: 'cryptography', label: '加密安全' },        // A02
  { value: 'injection', label: '注入攻击' },           // A03
  { value: 'design', label: '安全设计' },              // A04
  { value: 'configuration', label: '安全配置' },       // A05
  { value: 'components', label: '组件安全' },          // A06
  { value: 'authentication', label: '身份认证' },      // A07
  { value: 'integrity', label: '数据完整性' },         // A08
  { value: 'logging', label: '日志监控' },             // A09
  { value: 'ssrf', label: '服务端请求' },               // A10
  // CWE Top 25 2023 补充
  { value: 'memory', label: '内存安全' },              // CWE-787/125/416/476
  { value: 'input-validation', label: '输入验证' },    // CWE-20
  { value: 'privilege', label: '权限管理' },           // CWE-269/276
  { value: 'sensitive', label: '敏感信息' },           // CWE-200/798
  { value: 'file-ops', label: '文件操作' },            // CWE-22/434
  // 业务通用
  { value: 'business-logic', label: '业务逻辑' },
  { value: 'compliance', label: '合规安全' },
  // 其他
  { value: 'other', label: '其他' },
];

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

    // 从数据库获取配置
    let config = null;
    try {
      config = await prisma.systemConfig.findUnique({
        where: { key: 'skill_categories' },
      });
    } catch (dbError) {
      logger.warn(LOG_MODULES.CONFIG, '数据库连接失败，使用默认分类', { details: String(dbError) });
      // 如果数据库连接失败，返回默认值
      return NextResponse.json({ categories: DEFAULT_CATEGORIES });
    }

    // 如果没有配置，使用默认值并创建
    if (!config) {
      try {
        config = await prisma.systemConfig.create({
          data: {
            id: `config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            key: 'skill_categories',
            value: JSON.stringify(DEFAULT_CATEGORIES),
            description: '漏洞分类配置',
            updatedAt: new Date(),
          },
        });
      } catch (createError) {
        logger.warn(LOG_MODULES.CONFIG, '创建配置失败，使用默认分类', { details: String(createError) });
        return NextResponse.json({ categories: DEFAULT_CATEGORIES });
      }
    }

    const categories = JSON.parse(config.value);
    return NextResponse.json({ categories });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取漏洞分类失败', { details: String(error) });
    // 返回默认分类而不是错误
    return NextResponse.json({ categories: DEFAULT_CATEGORIES });
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
    const currentConfig = await prisma.systemConfig.findUnique({
      where: { key: 'skill_categories' },
    });

    if (currentConfig) {
      const currentCategories = JSON.parse(currentConfig.value) as Array<{ value: string; label: string }>;
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
    }

    // 更新或创建配置
    const config = await prisma.systemConfig.upsert({
      where: { key: 'skill_categories' },
      update: {
        value: JSON.stringify(categories),
        updatedAt: new Date(),
      },
      create: {
        id: `config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        key: 'skill_categories',
        value: JSON.stringify(categories),
        description: '漏洞分类配置',
        updatedAt: new Date(),
      },
    });

    logger.update(LOG_MODULES.CONFIG, payload, 'skill_categories', { categoriesCount: categories.length });
    return NextResponse.json({ categories: JSON.parse(config.value) });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '更新漏洞分类失败', { details: String(error) });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
