// src/app/api/skills/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { skillSelectMinimal } from '@/lib/query-optimizer';

// GET /api/skills - 获取 Skills 列表
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
    const category = searchParams.get('category') || undefined;
    const isActive = searchParams.get('isActive');
    const search = searchParams.get('search') || undefined;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (isActive !== null) where.isActive = isActive === 'true';

    // 添加搜索条件
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { displayName: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const [skills, total] = await Promise.all([
      prisma.skill.findMany({
        where,
        select: skillSelectMinimal,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip,
        take,
      }),
      prisma.skill.count({ where }),
    ]);

    return NextResponse.json(createPaginatedResponse(skills, total, pageNum, pageLimit));
  } catch (error) {
    console.error('获取 Skills 列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/skills - 创建 Skill
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

    // 检查权限（只有管理员可以创建 Skill）
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
      severity,
      systemPrompt,
      userPrompt,
      tools,
      parameters,
    } = body;

    // 验证必填字段
    if (!name || !displayName || !description || !category || !severity || !systemPrompt || !userPrompt) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      );
    }

    // 检查名称是否已存在
    const existing = await prisma.skill.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { error: 'Skill 名称已存在' },
        { status: 400 }
      );
    }

    const skill = await prisma.skill.create({
      data: {
        name,
        displayName,
        description,
        category,
        cwe,
        severity,
        systemPrompt,
        userPrompt,
        tools: JSON.stringify(tools || []),
        parameters: JSON.stringify(parameters || {}),
        isBuiltin: false,
      },
    });

    return NextResponse.json(
      {
        skill: {
          ...skill,
          tools: JSON.parse(skill.tools),
          parameters: JSON.parse(skill.parameters),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('创建 Skill 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
