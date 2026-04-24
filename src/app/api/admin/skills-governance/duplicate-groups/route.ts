// src/app/api/admin/skills-governance/duplicate-groups/route.ts
// Skills Governance - 重复组管理 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';

/**
 * GET /api/admin/skills-governance/duplicate-groups
 * 获取重复组列表
 * 
 * Query params:
 * - status: 'pending_review' | 'resolved' | 'all'
 * - language: 技术栈 ID 过滤
 * - vulnerabilityType: 漏洞类型 ID 过滤
 * - page: 页码
 * - limit: 每页数量
 */
export async function GET(request: Request) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';
    const language = searchParams.get('language') || undefined;
    const vulnerabilityType = searchParams.get('vulnerabilityType') || undefined;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const skip = (page - 1) * limit;

    // 构建查询条件
    const where: Record<string, unknown> = {};
    if (status !== 'all') {
      where.status = status;
    }
    if (language) {
      where.language = language;
    }
    if (vulnerabilityType) {
      where.vulnerabilityType = vulnerabilityType;
    }

    // 查询重复组
    const [groups, total] = await Promise.all([
      prisma.skillDuplicateGroup.findMany({
        where,
        include: {
          SkillDuplicateGroupMember: {
            include: {
              Skill: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                  techStackId: true,
                  vulnerabilityPatternId: true,
                  isActive: true,
                },
              },
            },
            orderBy: { similarityScore: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.skillDuplicateGroup.count({ where }),
    ]);

    // 获取语言和漏洞类型的名称
    const techStackIds = [...new Set(groups.map(g => g.language))];
    const vulnPatternIds = [...new Set(groups.map(g => g.vulnerabilityType))];

    const [techStacks, vulnPatterns] = await Promise.all([
      prisma.techStackOption.findMany({
        where: { id: { in: techStackIds } },
        select: { id: true, name: true, displayName: true },
      }),
      prisma.vulnerabilityPattern.findMany({
        where: { id: { in: vulnPatternIds } },
        select: { id: true, name: true, displayName: true },
      }),
    ]);

    const techStackMap = new Map(techStacks.map(t => [t.id, t]));
    const vulnPatternMap = new Map(vulnPatterns.map(v => [v.id, v]));

    // 组装响应
    const groupsWithDetails = groups.map(group => ({
      id: group.id,
      name: group.name,
      language: group.language,
      languageName: techStackMap.get(group.language)?.name || group.language,
      languageDisplayName: techStackMap.get(group.language)?.displayName || group.language,
      vulnerabilityType: group.vulnerabilityType,
      vulnerabilityTypeName: vulnPatternMap.get(group.vulnerabilityType)?.name || group.vulnerabilityType,
      vulnerabilityTypeDisplayName: vulnPatternMap.get(group.vulnerabilityType)?.displayName || group.vulnerabilityType,
      status: group.status,
      resolution: group.resolution,
      resolvedBy: group.resolvedBy,
      resolvedAt: group.resolvedAt,
      resolutionNotes: group.resolutionNotes,
      skillCount: group.skillCount,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      members: group.SkillDuplicateGroupMember.map(m => ({
        id: m.id,
        skillId: m.skillId,
        role: m.role,
        similarityScore: m.similarityScore,
        joinedAt: m.joinedAt,
        skill: m.Skill,
      })),
    }));

    return NextResponse.json({
      data: {
        groups: groupsWithDetails,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取重复组列表失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * POST /api/admin/skills-governance/duplicate-groups
 * 手动创建重复组
 * 
 * Body:
 * - name: 组名（可选）
 * - language: 技术栈 ID
 * - vulnerabilityType: 漏洞类型 ID
 * - skillIds: 成员 Skill ID 列表
 * - primarySkillId: 主 Skill ID（可选）
 */
export async function POST(request: Request) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const body = await request.json();
    const { name, language, vulnerabilityType, skillIds, primarySkillId } = body;

    // 验证必填字段
    if (!language || !vulnerabilityType || !skillIds || skillIds.length < 2) {
      return NextResponse.json(
        { error: '缺少必填字段：语言、漏洞类型、至少2个 Skill ID' },
        { status: 400 }
      );
    }

    // 验证技术栈和漏洞类型存在
    const techStack = await prisma.techStackOption.findUnique({
      where: { id: language },
    });
    if (!techStack) {
      return NextResponse.json({ error: `技术栈 "${language}" 不存在` }, { status: 400 });
    }

    const vulnPattern = await prisma.vulnerabilityPattern.findUnique({
      where: { id: vulnerabilityType },
    });
    if (!vulnPattern) {
      return NextResponse.json({ error: `漏洞类型 "${vulnerabilityType}" 不存在` }, { status: 400 });
    }

    // 验证所有 Skill 存在且属于同一语言+漏洞类型
    const skills = await prisma.skill.findMany({
      where: { id: { in: skillIds } },
      select: { id: true, name: true, techStackId: true, vulnerabilityPatternId: true },
    });

    if (skills.length !== skillIds.length) {
      return NextResponse.json({ error: '部分 Skill ID 不存在' }, { status: 400 });
    }

    const mismatchedSkills = skills.filter(
      s => s.techStackId !== language || s.vulnerabilityPatternId !== vulnerabilityType
    );
    if (mismatchedSkills.length > 0) {
      return NextResponse.json(
        { error: `以下 Skill 不属于指定的语言/漏洞类型: ${mismatchedSkills.map(s => s.name).join(', ')}` },
        { status: 400 }
      );
    }

    // 创建重复组
    const group = await prisma.skillDuplicateGroup.create({
      data: {
        id: generateId('sdg'),
        name: name || `${techStack.name}-${vulnPattern.displayName}-重复组`,
        language,
        vulnerabilityType,
        status: 'pending_review',
        skillCount: skillIds.length,
        updatedAt: new Date(),
      },
    });

    // 添加成员
    await prisma.skillDuplicateGroupMember.createMany({
      data: skillIds.map((skillId: string) => ({
        id: generateId('sdgm'),
        groupId: group.id,
        skillId,
        role: primarySkillId === skillId ? 'primary' : 'member',
        similarityScore: primarySkillId === skillId ? 1.0 : 0.9,
      })),
    });

    logger.info(LOG_MODULES.SKILL, '创建重复组', {
      userId: auth.payload.userId,
      groupId: group.id,
      skillCount: skillIds.length,
    });

    // 返回创建的组详情
    const createdGroup = await prisma.skillDuplicateGroup.findUnique({
      where: { id: group.id },
      include: {
        SkillDuplicateGroupMember: {
          include: {
            Skill: {
              select: { id: true, name: true, displayName: true },
            },
          },
        },
      },
    });

    return NextResponse.json({ data: createdGroup }, { status: 201 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '创建重复组失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}