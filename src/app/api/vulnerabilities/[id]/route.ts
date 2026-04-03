// src/app/api/vulnerabilities/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/vulnerabilities/:id - 获取漏洞详情
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

    const vulnerability = await prisma.vulnerability.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true },
        },
        execution: {
          select: {
            id: true,
            skillId: true,
            skill: { select: { id: true, name: true, displayName: true } },
          },
        },
      },
    });

    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    return NextResponse.json({
      vulnerability: {
        ...vulnerability,
        details: vulnerability.details ? JSON.parse(vulnerability.details) : null,
      },
    });
  } catch (error) {
    console.error('获取漏洞详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/vulnerabilities/:id - 更新漏洞
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

    const vulnerability = await prisma.vulnerability.findUnique({ where: { id } });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.cwe !== undefined) updateData.cwe = body.cwe;
    if (body.severity !== undefined) updateData.severity = body.severity;
    if (body.filePath !== undefined) updateData.filePath = body.filePath;
    if (body.lineStart !== undefined) updateData.lineStart = body.lineStart;
    if (body.lineEnd !== undefined) updateData.lineEnd = body.lineEnd;
    if (body.codeSnippet !== undefined) updateData.codeSnippet = body.codeSnippet;
    if (body.details !== undefined) updateData.details = JSON.stringify(body.details);
    if (body.aiAnalysis !== undefined) updateData.aiAnalysis = body.aiAnalysis;
    if (body.fixSuggestion !== undefined) updateData.fixSuggestion = body.fixSuggestion;
    if (body.notes !== undefined) updateData.notes = body.notes;

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      vulnerability: {
        ...updated,
        details: updated.details ? JSON.parse(updated.details) : null,
      },
    });
  } catch (error) {
    console.error('更新漏洞错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/vulnerabilities/:id - 删除漏洞
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

    const vulnerability = await prisma.vulnerability.findUnique({ where: { id } });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    await prisma.vulnerability.delete({ where: { id } });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除漏洞错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
