// 导出所有 Skills 为 JSON 文件

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested, isAdmin } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/skills/export - 导出所有 Skills
export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);
    if (!userIsAdmin) {
      return NextResponse.json({ details: { error: '需要管理员权限' } }, { status: 403 });
    }

    const skills = await prisma.skill.findMany({
      orderBy: [{ displayName: 'asc' }],
    });

    // 转换为导出格式
    const exportData = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      totalCount: skills.length,
      skills: skills.map(skill => ({
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        categoryId: skill.categoryId,
        vulnerabilityTreeId: skill.vulnerabilityTreeId,
        severity: skill.severity,
        content: skill.content,
        cwe: skill.cwe,
        isActive: skill.isActive,
        isBuiltin: skill.isBuiltin,
        version: skill.version,
        parentId: skill.parentId,
        isLatest: skill.isLatest,
        successRate: skill.successRate,
        avgDuration: skill.avgDuration,
        execCount: skill.execCount,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
      })),
    };

    return NextResponse.json(exportData);
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '导出 Skills 错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
