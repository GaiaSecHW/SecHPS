// src/app/api/skills/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/auth';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { AuditLogger } from '@/lib/audit/logger';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { skillSelectMinimal } from '@/lib/query-optimizer';
import { saveSkillToDisk } from '@/services/skill-files';
import { logger, LOG_MODULES } from '@/lib/logger';
import { findSimilarSkills, SkillForSimilarity, SimilarSkill } from '@/services/skill-similarity';

// 获取 skillOutputTemplate 的辅助函数
async function getSkillOutputTemplate(): Promise<string | undefined> {
  const config = await prisma.opencodeConfig.findFirst({
    where: { isActive: true },
    select: { skillOutputTemplate: true },
  });
  return config?.skillOutputTemplate || undefined;
}

// GET /api/skills - 获取 Skills 列表
// 支持作用域过滤：
// - scope=public: 只返回公共 Skills
// - scope=mine: 只返回当前用户的私有 Skills
// - scope=all: 返回用户可用的所有 Skills（公共 + 私有）
export async function GET(request: Request) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const isActive = searchParams.get('isActive');
    const search = searchParams.get('search') || undefined;
    const scope = searchParams.get('scope') || 'all'; // public | mine | all
    const techStack = searchParams.get('techStack') || undefined; // 技术栈过滤
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (isActive !== null) where.isActive = isActive === 'true';
    
    // 技术栈过滤
    if (techStack) {
      // techStack 字段是 JSON 数组字符串，使用 contains 匹配
      // 例如: ["Java", "Python"] 包含 "Java"
      where.techStack = { contains: techStack };
    }
    
    // 默认只返回最新版本
    where.isLatest = true;

    // 作用域过滤
    if (scope === 'public') {
      where.OR = [
        { userId: null },        // 公共 Skills
        { isPublic: true },      // 公开分享的私有 Skills
      ];
    } else if (scope === 'mine') {
      where.userId = payload.userId;  // 用户私有 Skills
    } else {
      // scope === 'all': 用户可用的所有 Skills（公共 + 私有 + 公开分享的）
      where.OR = [
        { userId: null },           // 公共 Skills
        { userId: payload.userId }, // 用户私有 Skills
        { isPublic: true },         // 其他用户公开分享的 Skills
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

    // 转换数据格式，添加创建者信息
    const skillsWithCreator = skills.map(skill => ({
      ...skill,
      userName: skill.user?.name || null,
      userUsername: skill.user?.username || null,
      user: undefined, // 移除嵌套的 user 对象
    }));

    return NextResponse.json(createPaginatedResponse(skillsWithCreator, total, pageNum, pageLimit));
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skills 列表错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// POST /api/skills - 创建 Skill
// 支持创建公共 Skill（需要管理员权限）或私有 Skill
export async function POST(request: Request) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const body = await request.json();
    const {
      name,
      displayName,
      description,
      category,
      techStack,  // 技术栈 ["Java", "Spring"]
      cwe,
      content,  // 完整的 Markdown 内容
      isPublic = false,  // 是否为公共 Skill，默认为私有
    } = body;

    // 验证必填字段
    if (!name || !displayName || !description || !category || !content) {
      return NextResponse.json(
        { details: { error: '缺少必填字段：名称、显示名称、描述、分类、内容' } },
        { status: 400 }
      );
    }

    // 处理技术栈数据
    let techStackJson: string | null = null;
    if (techStack && Array.isArray(techStack) && techStack.length > 0) {
      techStackJson = JSON.stringify(techStack);
    }

    // 确定作用域
    let userId: string | null = null;
    let isBuiltin = false;

    if (isPublic) {
      // 创建公共 Skill 需要管理员权限
      if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
        return NextResponse.json({ details: { error: '禁止访问 - 创建公共 Skill 需要管理员权限' } }, { status: 403 });
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
        { details: { error: isPublic ? '公共 Skill 名称已存在' : '您的私有 Skill 名称已存在' } },
        { status: 400 }
      );
    }

    const skill = await prisma.skill.create({
      data: {
        name,
        displayName,
        description,
        category,
        techStack: techStackJson,
        cwe: cwe || null,
        content,  // 保存完整的 Markdown 内容
        userId,
        isBuiltin,
        version: 1,
        isLatest: true,
      },
    });

    // 记录审计日志
    AuditLogger.log({
      userId: payload.userId,
      action: 'skill_create' as any,
      resource: skill.id,
      details: { name: skill.name, displayName, category, isPublic },
    }).catch(err => logger.errorWithUser(LOG_MODULES.SKILL, payload, '记录审计日志失败', skill.id, { details: { error: err instanceof Error ? err.message : String(err) } }));

    // 双写：同步保存到磁盘
    getSkillOutputTemplate().then(template => {
      saveSkillToDisk(skill, template).catch(err => {
        logger.errorWithUser(LOG_MODULES.SKILL, payload, '保存到磁盘失败', skill.id, { details: { error: err instanceof Error ? err.message : String(err) } });
        // 不阻塞响应，仅记录错误
      });
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
          category: true,
          techStack: true,
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
        category: s.category,
        techStack: s.techStack ? JSON.parse(s.techStack) : [],
        cwe: s.cwe,
        content: s.content,
      }));

      // 新技能的相似度格式
      const newSkillForSimilarity: SkillForSimilarity = {
        id: skill.id,
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        category: skill.category,
        techStack: skill.techStack ? JSON.parse(skill.techStack) : [],
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
