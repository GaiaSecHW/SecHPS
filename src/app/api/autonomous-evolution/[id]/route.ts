// src/app/api/autonomous-evolution/[id]/route.ts
// 数据隔离：普通用户只能操作自己的进化经验，管理员可以操作所有

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

  const { id } = await params;

  // 检查是否是管理员
  const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

  // 构建查询条件
  let where: any = { id };
  if (!isAdmin) {
    where.userId = payload.userId;
  }

  const item = await prisma.autonomousEvolutionExperience.findFirst({ where });
  if (!item) return NextResponse.json({ error: '未找到' }, { status: 404 });
  return NextResponse.json(item);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

  const { id } = await params;

  // 检查是否是管理员
  const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

  // 验证所有权
  let where: any = { id };
  if (!isAdmin) {
    where.userId = payload.userId;
  }

  const existing = await prisma.autonomousEvolutionExperience.findFirst({ where });
  if (!existing) return NextResponse.json({ error: '未找到' }, { status: 404 });

  const body = await request.json() as { directSolution?: string; lesson?: string };

  // Only allow editing directSolution and lesson
  const data: Record<string, string> = {};
  if (typeof body.directSolution === 'string') data.directSolution = body.directSolution;
  if (typeof body.lesson === 'string') data.lesson = body.lesson;

  const updated = await prisma.autonomousEvolutionExperience.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

  const { id } = await params;

  // 检查是否是管理员
  const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

  // 验证所有权
  let where: any = { id };
  if (!isAdmin) {
    where.userId = payload.userId;
  }

  const existing = await prisma.autonomousEvolutionExperience.findFirst({ where });
  if (!existing) return NextResponse.json({ error: '未找到' }, { status: 404 });

  await prisma.autonomousEvolutionExperience.delete({ where: { id } });
  return NextResponse.json({ success: true });
}