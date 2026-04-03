// src/app/api/vulnerabilities/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/vulnerabilities - 获取漏洞列表
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
    const severity = searchParams.get('severity');
    const type = searchParams.get('type');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (type) where.type = type;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, Date>).gte = new Date(startDate);
      if (endDate) (where.createdAt as Record<string, Date>).lte = new Date(endDate);
    }

    const [vulnerabilities, total] = await Promise.all([
      prisma.vulnerability.findMany({
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
      prisma.vulnerability.count({ where }),
    ]);

    return NextResponse.json({
      vulnerabilities: vulnerabilities.map(v => ({
        ...v,
        details: v.details ? JSON.parse(v.details) : null,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('获取漏洞列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/vulnerabilities - 创建漏洞（内部使用）
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
    const {
      projectId,
      skillExecutionId,
      title,
      description,
      type,
      cwe,
      severity,
      filePath,
      lineStart,
      lineEnd,
      codeSnippet,
      details,
      aiAnalysis,
      fixSuggestion,
    } = body;

    if (!projectId || !title || !description || !type || !severity) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      );
    }

    const vulnerability = await prisma.vulnerability.create({
      data: {
        projectId,
        skillExecutionId,
        title,
        description,
        type,
        cwe,
        severity,
        filePath,
        lineStart,
        lineEnd,
        codeSnippet,
        details: details ? JSON.stringify(details) : null,
        aiAnalysis,
        fixSuggestion,
        status: 'new',
      },
    });

    return NextResponse.json({ vulnerability }, { status: 201 });
  } catch (error) {
    console.error('创建漏洞错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
