// src/app/api/evaluations/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/evaluations/[id] - 获取评估会话详情
// 数据隔离：普通用户只能查看自己项目的评估，管理员可以查看所有
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

    // 权限检查
    if (!hasPermission(payload.permissions, PERMISSIONS.EVALUATION_READ)) {
      return NextResponse.json({ error: '无权限查看评估' }, { status: 403 });
    }

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 基础查询（使用 findFirst 支持条件过滤）
    let where: any = { id };
    
    const evaluation = await prisma.evaluationSession.findFirst({
      where,
      include: {
        Project: {
          select: {
            id: true,
            name: true,
            description: true,
            environmentUrl: true,
            userId: true,
            User: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
          },
        },
        // 添加迭代记录（包含模型信息）
        EvaluationIteration: {
          orderBy: { iterationNumber: 'asc' },
          select: {
            id: true,
            iterationNumber: true,
            status: true,
            startedAt: true,
            completedAt: true,
            duration: true,
            inputTokens: true,
            outputTokens: true,
            modelConfigId: true,
            modelName: true,
            roleId: true,
          },
        },
        // 添加节点执行记录（包含模型信息和Token）
        NodeExecution: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            workflowNodeId: true,
            nodeLabel: true,
            nodeType: true,
            status: true,
            startedAt: true,
            completedAt: true,
            modelConfigId: true,
            modelName: true,
            roleId: true,
            inputTokens: true,
            outputTokens: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 归属校验（管理员绕过）
    if (!userIsAdmin && evaluation.Project.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 尝试获取模型配置信息（如果 modelConfigId 存在）
    let modelConfigInfo = null;
    if (evaluation.modelConfigId) {
      try {
        const modelConfig = await prisma.modelConfig.findUnique({
          where: { id: evaluation.modelConfigId },
          select: {
            id: true,
            name: true,
            providerType: true,
            userId: true,
          },
        });
        
        if (modelConfig) {
          // 获取模型创建者信息
          let userInfo = null;
          if (modelConfig.userId) {
            userInfo = await prisma.user.findUnique({
              where: { id: modelConfig.userId },
              select: { id: true, name: true, username: true },
            });
          }
          
          modelConfigInfo = {
            id: modelConfig.id,
            name: modelConfig.name,
            providerType: modelConfig.providerType,
            userId: modelConfig.userId,
            userName: userInfo?.name || null,
            userUsername: userInfo?.username || null,
          };
        }
      } catch (err) {
        logger.warn(LOG_MODULES.MODEL, '获取模型配置信息失败:', { details: { error: String(err) } });
      }
    }

    // 格式化返回数据
    const response = {
      ...evaluation,
      modelConfigId: evaluation.modelConfigId || null,
      modelConfigName: modelConfigInfo?.name || evaluation.modelName || null,
      modelConfigProviderType: modelConfigInfo?.providerType || evaluation.providerType || null,
      modelCreatorId: modelConfigInfo?.userId || null,
      modelCreatorName: modelConfigInfo?.userName || null,
      modelCreatorUsername: modelConfigInfo?.userUsername || null,
    };

    return NextResponse.json({ evaluation: response });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '获取评估错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/evaluations/[id] - 删除评估会话
// 数据隔离：普通用户只能删除自己项目的评估，管理员可以删除所有
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

    // 权限检查
    if (!hasPermission(payload.permissions, PERMISSIONS.EVALUATION_DELETE)) {
      return NextResponse.json({ error: '无权限删除评估' }, { status: 403 });
    }

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 检查评估会话是否存在并获取项目归属（使用 findFirst 支持条件过滤）
    let where: any = { id };
    
    const evaluation = await prisma.evaluationSession.findFirst({
      where,
      include: { Project: { select: { userId: true } } },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 归属校验（管理员绕过）
    if (!userIsAdmin && evaluation.Project.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 级联删除所有关联数据（使用事务）
    await prisma.$transaction([
      prisma.sessionMessage.deleteMany({ where: { evaluationSessionId: id } }),
      prisma.nodeExecution.deleteMany({ where: { evaluationSessionId: id } }),
      prisma.evaluationIteration.deleteMany({ where: { evaluationSessionId: id } }),
      prisma.tokenUsage.deleteMany({ where: { evaluationId: id } }),
      prisma.vulnerability.deleteMany({ where: { evaluationId: id } }),
      prisma.evaluationResult.deleteMany({ where: { evaluationId: id } }),
      prisma.evaluationSession.delete({ where: { id } }),
    ]);

    return NextResponse.json({ message: '评估会话已删除' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '删除评估错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}