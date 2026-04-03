// src/app/api/patterns/[id]/skills/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/patterns/:id/skills - 获取模式关联的 Skills
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const pattern = await prisma.vulnerabilityPattern.findUnique({
      where: { id },
    });

    if (!pattern) {
      return NextResponse.json({ error: '模式不存在' }, { status: 404 });
    }

    // 根据 CWE 查找关联的 Skills
    const skills = await prisma.skill.findMany({
      where: pattern.cwe
        ? { cwe: pattern.cwe, isActive: true }
        : { category: pattern.category, isActive: true },
      orderBy: [{ severity: 'desc' }, { name: 'asc' }],
    });

    return NextResponse.json({
      skills: skills.map(s => ({
        ...s,
        tools: JSON.parse(s.tools),
        parameters: JSON.parse(s.parameters),
      })),
    });
  } catch (error) {
    console.error('获取关联 Skills 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
