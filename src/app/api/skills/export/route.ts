// 导出所有 Skills 为 JSON 文件

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/skills/export - 导出所有 Skills
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

    // 检查是否是管理员
    const isAdmin = payload.roles?.includes('admin');
    if (!isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    // 获取所有 Skills（包括所有版本）
    const skills = await prisma.skill.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    // 转换为导出格式
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      totalCount: skills.length,
      skills: skills.map(skill => ({
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        category: skill.category,
        techStack: skill.techStack,
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
    console.error('导出 Skills 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
