// src/app/api/scans/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/scans/:id - 获取扫描任务详情
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

    const scan = await prisma.scanTask.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true },
        },
        executions: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          include: {
            skill: {
              select: { id: true, name: true, displayName: true },
            },
          },
        },
        reports: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!scan) {
      return NextResponse.json({ error: '扫描任务不存在' }, { status: 404 });
    }

    return NextResponse.json({
      scan: {
        ...scan,
        skillIds: JSON.parse(scan.skillIds),
        executions: scan.executions.map(e => ({
          ...e,
          input: JSON.parse(e.input),
          output: e.output ? JSON.parse(e.output) : null,
        })),
        reports: scan.reports.map(r => ({
          ...r,
          summary: JSON.parse(r.summary),
          details: JSON.parse(r.details),
        })),
      },
    });
  } catch (error) {
    console.error('获取扫描任务详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/scans/:id - 更新扫描任务
export async function PUT(
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
    const body = await request.json();

    const scan = await prisma.scanTask.findUnique({ where: { id } });
    if (!scan) {
      return NextResponse.json({ error: '扫描任务不存在' }, { status: 404 });
    }

    if (scan.status === 'running') {
      return NextResponse.json({ error: '运行中的任务不能修改' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.skillIds !== undefined) {
      updateData.skillIds = JSON.stringify(body.skillIds);
      updateData.totalSkills = body.skillIds.length;
    }
    if (body.schedule !== undefined) updateData.schedule = body.schedule;

    const updated = await prisma.scanTask.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      scan: {
        ...updated,
        skillIds: JSON.parse(updated.skillIds),
      },
    });
  } catch (error) {
    console.error('更新扫描任务错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/scans/:id - 删除扫描任务
export async function DELETE(
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

    const scan = await prisma.scanTask.findUnique({ where: { id } });
    if (!scan) {
      return NextResponse.json({ error: '扫描任务不存在' }, { status: 404 });
    }

    if (scan.status === 'running') {
      return NextResponse.json({ error: '运行中的任务不能删除' }, { status: 400 });
    }

    await prisma.scanTask.delete({ where: { id } });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除扫描任务错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
