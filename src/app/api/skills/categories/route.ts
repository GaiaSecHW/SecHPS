// src/app/api/skills/categories/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/skills/categories - 获取 Skills 分类列表（从 VulnerabilityCategory 表）
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // 从 VulnerabilityCategory 表获取分类列表
    const categories = await prisma.vulnerabilityCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, value: true, label: true },
    });

    // 获取每个分类的 Skill 数量（通过 VulnerabilityPattern 关联）
    const skillCounts = await prisma.skill.groupBy({
      by: ['category'],
      where: { isLatest: true },
      _count: { id: true },
    });

    const countMap = new Map(skillCounts.map(s => [s.category, s._count.id]));
    
    // Skill.category 与 VulnerabilityCategory.value 的映射
    // 这些是匹配的值（两者相同）
    const matchedValues = new Set(['injection', 'memory', 'other']);
    
    // Skill.category 的值需要映射到 VulnerabilityCategory.value
    const skillToVulnMapping: Record<string, string> = {
      'auth': 'authentication',
      'logic': 'business-logic',
      'crypto': 'cryptography',
      'file': 'file-ops',
      'info': 'sensitive',
      'infra': 'configuration',
      'traversal': 'input-validation',
      'deserialization': 'integrity',
      'supply-chain': 'components',
      'api': 'access-control',
      'code-audit': 'other',
      'methodology': 'other',
      'mobile': 'other',
      'ai': 'other',
      'frontend': 'input-validation',
    };

    const result = categories.map(c => {
      // 直接匹配
      let count = countMap.get(c.value) || 0;
      
      // 如果直接匹配为0，检查是否有 Skill.category 映射到这个 value
      if (count === 0) {
        for (const [skillCat, vulnValue] of Object.entries(skillToVulnMapping)) {
          if (vulnValue === c.value && countMap.has(skillCat)) {
            count += countMap.get(skillCat) || 0;
          }
        }
      }
      
      return {
        name: c.value,        // 使用 value 作为 name（与 Skill.category 匹配）
        label: c.label,
        count,
      };
    });

    return NextResponse.json({
      categories: result,
      pagination: {
        total: result.length,
        page: 1,
        limit: result.length,
        totalPages: 1,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skills 分类错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
