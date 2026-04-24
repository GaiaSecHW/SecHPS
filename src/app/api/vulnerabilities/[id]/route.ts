// src/app/api/vulnerabilities/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/vulnerabilities/:id - 获取漏洞详情
// 数据隔离：普通用户只能查看自己项目的漏洞，或有权查看的评估会话中的漏洞
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 先获取漏洞信息
    const vulnerability = await prisma.vulnerability.findUnique({
      where: { id },
      include: {
        Project: {
          select: { id: true, name: true, userId: true },
        },
        SkillExecution: {
          select: {
            id: true,
            skillId: true,
            Skill: { select: { id: true, name: true, displayName: true } },
          },
        },
        EvaluationSession: {
          select: { id: true, projectId: true, Project: { select: { userId: true } } },
        },
      },
    });

    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    // 权限检查：管理员可查看所有，普通用户需要验证权限
    if (!userIsAdmin) {
      // 检查用户是否有权限访问该漏洞
      // 1. 用户是项目所有者（通过 Vulnerability.Project）
      const isProjectOwner = vulnerability.Project?.userId === payload.userId;
      
      // 2. 用户是评估会话所属项目的所有者
      const isEvalProjectOwner = vulnerability.EvaluationSession?.Project?.userId === payload.userId;
      
      // 3. 直接通过 projectId 检查
      let isDirectProjectOwner = false;
      if (vulnerability.projectId && !isProjectOwner && !isEvalProjectOwner) {
        const project = await prisma.project.findFirst({
          where: { id: vulnerability.projectId, userId: payload.userId },
          select: { id: true },
        });
        isDirectProjectOwner = !!project;
      }

      const hasAccess = isProjectOwner || isEvalProjectOwner || isDirectProjectOwner;

      if (!hasAccess) {
        return NextResponse.json({ error: '无权限查看该漏洞' }, { status: 403 });
      }
    }

    return NextResponse.json({
      vulnerability,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '获取漏洞详情错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/vulnerabilities/:id - 更新漏洞
// 数据隔离：普通用户只能更新自己项目的漏洞，管理员可以更新所有
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 验证所有权
    let existingWhere: any = { id };
    if (!userIsAdmin) {
      existingWhere.Project = { userId: payload.userId };
    }

    const vulnerability = await prisma.vulnerability.findFirst({ 
      where: existingWhere,
      include: { Project: { select: { userId: true } } },
    });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    const body = await request.json();

    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.cwe !== undefined) updateData.cwe = body.cwe;
    if (body.severity !== undefined) updateData.severity = body.severity;
    if (body.location !== undefined) updateData.location = body.location;
    if (body.POC !== undefined) updateData.POC = body.POC;
    if (body.vulnerable !== undefined) updateData.vulnerable = body.vulnerable;
    if (body.fixSuggestion !== undefined) updateData.fixSuggestion = body.fixSuggestion;
    if (body.notes !== undefined) updateData.notes = body.notes;
    // 注意：projectId 不在更新字段中，防止漏洞转移到其他项目

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: updateData,
    });

    logger.update(LOG_MODULES.VULNERABILITY, payload, id, { fields: Object.keys(updateData) });

    return NextResponse.json({
      vulnerability: updated,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '更新漏洞错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/vulnerabilities/:id - 删除漏洞
// 数据隔离：普通用户只能删除自己项目的漏洞，管理员可以删除所有
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 验证所有权
    let where: any = { id };
    if (!userIsAdmin) {
      where.Project = { userId: payload.userId };
    }

    const vulnerability = await prisma.vulnerability.findFirst({ where });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    await prisma.vulnerability.delete({ where: { id } });

    logger.delete(LOG_MODULES.VULNERABILITY, payload, id);

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '删除漏洞错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}