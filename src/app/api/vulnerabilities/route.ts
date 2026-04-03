// src/app/api/vulnerabilities/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { combineWhereClauses, buildDateRangeFilter, buildStatusFilter } from '@/lib/query-optimizer';

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
    const projectId = searchParams.get('projectId') || undefined;
    const status = searchParams.get('status')?.split(',') || undefined;
    const severity = searchParams.get('severity')?.split(',') || undefined;
    const type = searchParams.get('type') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const search = searchParams.get('search') || undefined;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    const where = combineWhereClauses(
      projectId ? { projectId } : undefined,
      buildStatusFilter(status),
      severity ? { severity: { in: severity } } : undefined,
      type ? { type } : undefined,
      { createdAt: buildDateRangeFilter(startDate, endDate) },
      search ? {
        OR: [
          { title: { contains: search } },
          { description: { contains: search } },
          { type: { contains: search } },
        ],
      } : undefined
    );

    const [vulnerabilities, total] = await Promise.all([
      prisma.vulnerability.findMany({
        where,
        select: {
          id: true,
          projectId: true,
          title: true,
          description: true,
          type: true,
          cwe: true,
          severity: true,
          filePath: true,
          lineStart: true,
          lineEnd: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          project: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' as const },
        skip,
        take,
      }),
      prisma.vulnerability.count({ where }),
    ]);

    return NextResponse.json(createPaginatedResponse(vulnerabilities, total, pageNum, pageLimit));
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
