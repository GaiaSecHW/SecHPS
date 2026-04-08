// src/app/api/skills/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { skillSelectMinimal } from '@/lib/query-optimizer';
import { saveSkillToDisk } from '@/services/skill-files';

// GET /api/skills - 获取 Skills 列表
// 支持作用域过滤：
// - scope=public: 只返回公共 Skills
// - scope=mine: 只返回当前用户的私有 Skills
// - scope=all: 返回用户可用的所有 Skills（公共 + 私有）
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
    const scope = searchParams.get('scope') || 'all'; // public | mine | all
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (isActive !== null) where.isActive = isActive === 'true';
    
    // 默认只返回最新版本
    where.isLatest = true;

    // 作用域过滤
    if (scope === 'public') {
      where.userId = null;  // 公共 Skills
    } else if (scope === 'mine') {
      where.userId = payload.userId;  // 用户私有 Skills
    } else {
      // scope === 'all': 用户可用的所有 Skills（公共 + 私有）
      where.OR = [
        { userId: null },           // 公共 Skills
        { userId: payload.userId }, // 用户私有 Skills
      ];
    }

    // 添加搜索条件
    if (search) {
      if (where.OR) {
        // 已有 OR 条件，需要合并
        const existingOR = where.OR as Record<string, unknown>[];
        where.OR = existingOR.map(condition => ({
          ...condition,
          OR: [
            { name: { contains: search } },
            { displayName: { contains: search } },
            { description: { contains: search } },
          ],
        }));
      } else {
        where.OR = [
          { name: { contains: search } },
          { displayName: { contains: search } },
          { description: { contains: search } },
        ];
      }
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

    // 解析 JSON 字段
    const parsedSkills = skills.map((skill: typeof skills[0]) => ({
      ...skill,
      tools: typeof skill.tools === 'string' ? JSON.parse(skill.tools) : skill.tools,
      parameters: typeof skill.parameters === 'string' ? JSON.parse(skill.parameters) : skill.parameters,
      paths: typeof skill.paths === 'string' ? JSON.parse(skill.paths) : skill.paths,
    }));

    return NextResponse.json(createPaginatedResponse(parsedSkills, total, pageNum, pageLimit));
  } catch (error) {
    console.error('获取 Skills 列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/skills - 创建 Skill
// 支持创建公共 Skill（需要管理员权限）或私有 Skill
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

    const body = await request.json();
    const {
      name,
      displayName,
      description,
      category,
      cwe,
      severity = 'medium',
      systemPrompt = '',
      userPrompt = '',
      tools,
      parameters,
      content,  // 新增：完整的 Markdown 内容
      isPublic = false,  // 是否为公共 Skill，默认为私有
    } = body;

    // 验证必填字段
    if (!name || !displayName || !description || !category) {
      return NextResponse.json(
        { error: '缺少必填字段：名称、描述、分类' },
        { status: 400 }
      );
    }

    // 确定作用域
    let userId: string | null = null;
    let isBuiltin = false;

    if (isPublic) {
      // 创建公共 Skill 需要管理员权限
      if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
        return NextResponse.json({ error: '禁止访问 - 创建公共 Skill 需要管理员权限' }, { status: 403 });
      }
      userId = null;  // 公共 Skill
      isBuiltin = false;
    } else {
      // 创建私有 Skill
      userId = payload.userId;
      isBuiltin = false;
    }

    // 检查名称是否已存在（同一作用域内）
    const existing = await prisma.skill.findFirst({
      where: {
        name,
        userId,
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: isPublic ? '公共 Skill 名称已存在' : '您的私有 Skill 名称已存在' },
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
        content,  // 保存完整的 Markdown 内容
        tools: JSON.stringify(tools || []),
        parameters: JSON.stringify(parameters || {}),
        userId,
        isBuiltin,
        version: 1,
        isLatest: true,
      },
    });

    // 双写：同步保存到磁盘
    saveSkillToDisk(skill).catch(err => {
      console.error('[Skills API] 保存到磁盘失败:', err);
      // 不阻塞响应，仅记录错误
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
