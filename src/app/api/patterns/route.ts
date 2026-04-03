// src/app/api/patterns/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/patterns - 获取漏洞模式列表
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

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const isActive = searchParams.get('isActive');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (isActive !== null) where.isActive = isActive === 'true';

    const [patterns, total] = await Promise.all([
      prisma.vulnerabilityPattern.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.vulnerabilityPattern.count({ where }),
    ]);

    return NextResponse.json({
      patterns: patterns.map(p => ({
        ...p,
        patterns: JSON.parse(p.patterns),
        languages: JSON.parse(p.languages),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('获取漏洞模式列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/patterns - 创建漏洞模式
export async function POST(request: Request) {
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      displayName,
      description,
      category,
      cwe,
      cve,
      patterns,
      languages,
      exampleVulnerable,
      exampleFixed,
      fixGuidance,
    } = body;

    if (!name || !displayName || !description || !category || !patterns || !languages) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      );
    }

    const existing = await prisma.vulnerabilityPattern.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { error: '模式名称已存在' },
        { status: 400 }
      );
    }

    const pattern = await prisma.vulnerabilityPattern.create({
      data: {
        name,
        displayName,
        description,
        category,
        cwe,
        cve,
        patterns: JSON.stringify(patterns),
        languages: JSON.stringify(languages),
        exampleVulnerable,
        exampleFixed,
        fixGuidance,
        isBuiltin: false,
      },
    });

    return NextResponse.json(
      {
        pattern: {
          ...pattern,
          patterns: JSON.parse(pattern.patterns),
          languages: JSON.parse(pattern.languages),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('创建漏洞模式错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
