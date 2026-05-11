// src/app/api/skills/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse, isAdmin } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { AuditLogger } from '@/lib/audit/logger';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { skillSelectMinimal } from '@/lib/query-optimizer';
import { saveSkillToDisk } from '@/services/skill-files';
import { getSkillOutputTemplate } from '@/lib/skill-template';
import { logger, LOG_MODULES } from '@/lib/logger';
import { findSimilarSkills, SkillForSimilarity, SimilarSkill } from '@/services/skill-similarity';
import { triggerGovernanceAnalysis } from '@/services/skill-governance';
import { generateId } from '@/lib/id-generator';
import { buildTenantFilter, getTenantIdForCreate } from '@/lib/tenant-filter';

// GET /api/skills - 获取 Skills 列表
// 支持作用域过滤：
// - scope=public: 只返回公共 Skills
// - scope=mine: 只返回当前用户的私有 Skills
// - scope=all: 返回用户可用的所有 Skills（公共 + 私有）
export async function GET(request: Request) {
  try {
    const auth = authenticateRequestEnhanced(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get('categoryId') || undefined;
    const languageId = searchParams.get('languageId') || undefined;
    const patternId = searchParams.get('patternId') || undefined;
    const productTagId = searchParams.get('productTagId') || undefined;
    const isActive = searchParams.get('isActive');
    const search = searchParams.get('search') || undefined;
    const scope = searchParams.get('scope') || 'all'; // public | mine | all
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    const where: Record<string, unknown> = {};
    if (isActive !== null) where.isActive = isActive === 'true';
    if (categoryId) where.categoryId = categoryId;
    if (patternId) where.vulnerabilityTreeId = patternId;
    if (languageId) {
      // 查找该语言下的所有 pattern ID
      const patterns = await prisma.vulnerabilityTree.findMany({
        where: { parentId: languageId, type: 'pattern' },
        select: { id: true },
      });
      const patternIds = patterns.map(p => p.id);
      // 包含该语言下的 pattern + 通用语言下的 pattern
      const generalLanguages = await prisma.vulnerabilityTree.findMany({ where: { name: '通用', type: 'language' }, select: { id: true } });
      const generalLanguageIds = generalLanguages.map(p => p.id);
      const generalPatterns = await prisma.vulnerabilityTree.findMany({
        where: { parentId: { in: generalLanguageIds }, type: 'pattern' },
        select: { id: true },
      });
      const generalIds = generalPatterns.map(p => p.id);
      where.vulnerabilityTreeId = { in: [...patternIds, ...generalIds] };
    }
    if (productTagId) {
      where.SkillProductTag = { some: { productTagId } };
    }

    // 默认只返回最新版本
    where.isLatest = true;

    // 作用域过滤 - 整合多租户
    if (scope === 'public') {
      // 选择模式：公共技能（系统内置 + isPublic=true）
      where.OR = [
        { userId: null },           // 公共技能（系统内置）
        { isPublic: true },         // 公开分享的技能
      ];
    } else if (scope === 'mine') {
      // 管理模式：自己的技能 + 系统内置的 + 同租户的
      const tenantFilter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        isPublicField: 'isPublic',
      });
      where.OR = [
        { userId: payload.userId }, // 自己创建的技能
        { userId: null },           // 系统内置技能
        { ...tenantFilter },        // 同租户的技能（含 public 可见）
      ];
    } else {
      // scope === 'all': 选择模式（用于执行时选择技能）
      // 用户可用的所有 Skills：公共 + 自己的 + 同租户的
      const tenantFilter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        isPublicField: 'isPublic',
      });
      where.OR = [
        { userId: null },           // 公共技能（系统内置）
        { userId: payload.userId }, // 自己创建的技能
        { ...tenantFilter },        // 同租户的技能（含 public 可见）
      ];
    }

    // 添加搜索条件
    if (search) {
      const searchOR = [
        { name: { contains: search } },
        { displayName: { contains: search } },
        { description: { contains: search } },
        { content: { contains: search } },
      ];
      if (where.OR) {
        // 已有 OR 条件（scope），用 AND 组合
        where.AND = [
          { OR: where.OR as Record<string, unknown>[] },
          { OR: searchOR },
        ];
        delete where.OR;
      } else {
        where.OR = searchOR;
      }
    }

    const [skills, total] = await Promise.all([
      prisma.skill.findMany({
        where,
        select: skillSelectMinimal,
      orderBy: [{ execCount: 'desc' }, { updatedAt: 'desc' }],
        skip,
        take,
      }),
      prisma.skill.count({ where }),
    ]);

    // 转换数据格式，添加创建者信息和维度信息
    const skillsWithCreator = skills.map(skill => ({
      ...skill,
      userName: skill.User?.name || null,
      userUsername: skill.User?.username || null,
      User: undefined,
      categoryName: skill.SkillCategory?.displayName || null,
      categoryIcon: skill.SkillCategory?.icon || null,
      hasSubDimension: skill.SkillCategory?.hasSubDimension || false,
      patternName: skill.VulnerabilityTree?.displayName || null,
      languageName: skill.VulnerabilityTree?.VulnerabilityTree?.displayName || null,
      SkillCategory: undefined,
      VulnerabilityTree: undefined,
    }));

    return NextResponse.json(createPaginatedResponse(skillsWithCreator, total, pageNum, pageLimit));
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skills 列表错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// POST /api/skills - 创建 Skill
// 支持创建公共 Skill（需要管理员/ICSL 权限）或私有 Skill
export async function POST(request: Request) {
  try {
    const auth = authenticateRequestEnhanced(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    const body = await request.json();
    const {
      name,
      displayName,
      description,
      categoryId,
      vulnerabilityTreeId,
      productTagIds,
      cwe,
      content,
      isPublic = false,
    } = body;

    // 验证必填字段
    if (!name || !displayName || !description || !content || !categoryId) {
      return NextResponse.json(
        { details: { error: '缺少必填字段：名称、显示名称、描述、内容、分类' } },
        { status: 400 }
      );
    }

    // 获取租户 ID
    const tenantId = getTenantIdForCreate(tenant, isPublic);

    // 验证 categoryId 存在性
    const skillCategory = await prisma.skillCategory.findUnique({ where: { id: categoryId } });
    if (!skillCategory) {
      return NextResponse.json({ details: { error: `分类 ID "${categoryId}" 不存在` } }, { status: 400 });
    }

    // 如果分类需要第二维度，vulnerabilityTreeId 必填
    if (skillCategory.hasSubDimension && !vulnerabilityTreeId) {
      return NextResponse.json(
        { details: { error: `分类 "${skillCategory.displayName}" 需要指定漏洞模式` } },
        { status: 400 }
      );
    }

    // 验证 vulnerabilityTreeId 是 pattern 类型的叶子节点
    if (vulnerabilityTreeId) {
      const treeNode = await prisma.vulnerabilityTree.findUnique({ where: { id: vulnerabilityTreeId } });
      if (!treeNode || treeNode.type !== 'pattern') {
        return NextResponse.json({ details: { error: `漏洞模式 ID "${vulnerabilityTreeId}" 无效` } }, { status: 400 });
      }
    }

    // 确定作用域
    let userId: string | null = null;
    let isBuiltin = false;

    if (isPublic) {
      // 创建公共 Skill 需要管理员/ICSL 权限
      if (!tenant.isIcsTenant && !tenant.isPlatformAdmin) {
        return NextResponse.json({ details: { error: '禁止访问 - 创建公共 Skill 需要管理员权限' } }, { status: 403 });
      }
      userId = null;  // 公共 Skill
      isBuiltin = false;
    } else {
      // 创建私有 Skill
      userId = payload.userId;
      isBuiltin = false;
    }

    // 检查名称是否已存在（同一租户内）
    const existing = await prisma.skill.findFirst({
      where: {
        name,
        userId,
        tenantId: isPublic ? null : tenantId,
      },
    });
    if (existing) {
      return NextResponse.json(
        { details: { error: isPublic ? '公共 Skill 名称已存在' : '您的私有 Skill 名称已存在' } },
        { status: 400 }
      );
    }

    const skill = await prisma.skill.create({
      data: {
        id: generateId('skill'),
        name,
        displayName,
        description,
        categoryId,
        vulnerabilityTreeId: vulnerabilityTreeId || null,
        cwe: cwe || null,
        content,
        userId,
        tenantId,
        isPublic,
        isBuiltin,
        version: 1,
        isLatest: true,
        updatedAt: new Date(),
        ...(productTagIds?.length > 0 && {
          SkillProductTag: {
            create: productTagIds.map((tagId: string) => ({
              id: generateId('spt'),
              productTagId: tagId,
            })),
          },
        }),
      },
    });

    // 记录审计日志
    AuditLogger.log({
      userId: payload.userId,
      action: 'skill_create' as any,
      resource: skill.id,
      details: { name: skill.name, displayName, isPublic },
    }).catch(err => logger.errorWithUser(LOG_MODULES.SKILL, payload, '记录审计日志失败', skill.id, { details: { error: err instanceof Error ? err.message : String(err) } }));

    // 双写：同步保存到磁盘（等待完成）
    try {
      const template = await getSkillOutputTemplate();
      await saveSkillToDisk(skill, template);
    } catch (err) {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, '保存到磁盘失败', skill.id, { details: { error: err instanceof Error ? err.message : String(err) } });
      // 不阻塞响应，仅记录错误
    }

    // ===== 触发治理分析（非阻塞） =====
    triggerGovernanceAnalysis(skill.id).catch(err => {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, '触发治理分析失败', skill.id, { details: { error: err instanceof Error ? err.message : String(err) } });
      // 不阻塞响应，仅记录错误
    });

    // 相似度检测（非阻塞，仅提示）
    let governanceWarnings: { similarSkills: SimilarSkill[]; hasSimilar: boolean } = { similarSkills: [], hasSimilar: false };
    try {
      // 获取现有技能列表（同一作用域）
      const existingSkills = await prisma.skill.findMany({
        where: {
          userId,  // 同一作用域（公共或私有）
          isLatest: true,
          id: { not: skill.id },  // 排除刚创建的技能
        },
        select: {
          id: true,
          name: true,
          displayName: true,
          description: true,
          cwe: true,
          content: true,
        },
      });

      // 转换为 SkillForSimilarity 格式
      const skillsForSimilarity: SkillForSimilarity[] = existingSkills.map(s => ({
        id: s.id,
        name: s.name,
        displayName: s.displayName,
        description: s.description,
        cwe: s.cwe,
        content: s.content,
      }));

      // 新技能的相似度格式
      const newSkillForSimilarity: SkillForSimilarity = {
        id: skill.id,
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        cwe: skill.cwe,
        content: skill.content,
      };

      // 调用相似度检测（使用默认阈值 0.75）
      const similarSkills = await findSimilarSkills(newSkillForSimilarity, skillsForSimilarity);
      
      governanceWarnings = {
        similarSkills,
        hasSimilar: similarSkills.length > 0,
      };
    } catch (similarityError) {
      // 相似度检测失败不影响创建，仅记录日志
      logger.errorWithUser(LOG_MODULES.SKILL, payload, '相似度检测失败', skill.id, { details: { error: similarityError instanceof Error ? similarityError.message : String(similarityError) } });
    }

    return NextResponse.json({ skill, governanceWarnings }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '创建 Skill 错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
