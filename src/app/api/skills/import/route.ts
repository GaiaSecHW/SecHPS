// 导入 Skills 从 JSON 文件

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

interface SkillImport {
  name: string;
  displayName: string;
  description: string;
  category: string;
  techStack?: string | null;
  severity?: string | null;
  content: string;
  cwe?: string | null;
  isActive?: boolean;
  isBuiltin?: boolean;
  version?: number;
  parentId?: string | null;
  isLatest?: boolean;
  successRate?: number | null;
  avgDuration?: number | null;
  execCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ImportData {
  version: string;
  exportedAt: string;
  totalCount: number;
  skills: SkillImport[];
}

// POST /api/skills/import - 导入 Skills
export async function POST(request: Request) {
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

    // 检查是否是管理员
    const isAdmin = payload.roles?.includes('admin');
    if (!isAdmin) {
      return NextResponse.json({ details: { error: '需要管理员权限' } }, { status: 403 });
    }

    const body: ImportData = await request.json();

    // 验证数据格式
    if (!body.version || !Array.isArray(body.skills)) {
      return NextResponse.json({ details: { error: '无效的导入数据格式' } }, { status: 400 });
    }

    const results = {
      total: body.skills.length,
      success: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
    };

    // 获取现有 Skills 的 name 列表
    const existingSkills = await prisma.skill.findMany({
      select: { name: true },
    });
    const existingNames = new Set(existingSkills.map(s => s.name));

    // 逐个导入 Skill
    for (const skill of body.skills) {
      try {
        // 检查必填字段
        if (!skill.name || !skill.displayName || !skill.description || !skill.category || !skill.content) {
          results.skipped++;
          results.errors.push(`跳过: 缺少必填字段 - ${skill.name || '未知'}`);
          continue;
        }

        // 如果已存在，跳过或更新
        if (existingNames.has(skill.name)) {
          results.skipped++;
          results.errors.push(`跳过: Skill "${skill.name}" 已存在`);
          continue;
        }

        // 创建新 Skill
        await prisma.skill.create({
          data: {
            id: `skill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: skill.name,
            displayName: skill.displayName,
            description: skill.description,
            category: skill.category,
            techStack: skill.techStack || null,
            severity: skill.severity || null,
            content: skill.content,
            cwe: skill.cwe || null,
            isActive: skill.isActive ?? true,
            isBuiltin: skill.isBuiltin ?? false,
            version: skill.version || 1,
            parentId: skill.parentId || null,
            isLatest: skill.isLatest ?? true,
            successRate: skill.successRate || null,
            avgDuration: skill.avgDuration || null,
            execCount: skill.execCount || 0,
            userId: null, // 导入的 Skills 为公共资源
            updatedAt: new Date(),
          },
        });

        existingNames.add(skill.name);
        results.success++;
      } catch (err) {
        results.failed++;
        const errMsg = err instanceof Error ? err.message : '未知错误';
        results.errors.push(`失败: ${skill.name} - ${errMsg}`);
      }
    }

    return NextResponse.json({
      message: '导入完成',
      results,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '导入 Skills 错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
