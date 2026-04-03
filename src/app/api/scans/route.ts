// src/app/api/scans/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/scans - 获取扫描任务列表
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
    const projectId = searchParams.get('projectId');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;

    const [scans, total] = await Promise.all([
      prisma.scanTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          project: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.scanTask.count({ where }),
    ]);

    return NextResponse.json({
      scans: scans.map(s => ({
        ...s,
        skillIds: JSON.parse(s.skillIds),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('获取扫描任务列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/scans - 创建扫描任务
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
    const { projectId, name, description, skillIds, schedule } = body;

    if (!projectId || !name || !skillIds || skillIds.length === 0) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      );
    }

    // 验证项目存在
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 验证 Skills 存在
    const skills = await prisma.skill.findMany({
      where: { id: { in: skillIds }, isActive: true },
    });
    if (skills.length !== skillIds.length) {
      return NextResponse.json({ error: '部分 Skill 不存在或未启用' }, { status: 400 });
    }

    const scan = await prisma.scanTask.create({
      data: {
        projectId,
        userId: payload.userId as string,
        name,
        description,
        skillIds: JSON.stringify(skillIds),
        schedule,
        totalSkills: skillIds.length,
      },
    });

    return NextResponse.json(
      {
        scan: {
          ...scan,
          skillIds: JSON.parse(scan.skillIds),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('创建扫描任务错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
