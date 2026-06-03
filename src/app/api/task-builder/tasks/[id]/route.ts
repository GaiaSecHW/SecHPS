import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;
  const { id } = await params;

  try {
    const task = await prisma.taskInstance.findUnique({
      where: { id },
      include: {
        TaskExecutionLog: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    // 权限校验：管理员可访问所有，非管理员只能访问自己的任务
    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant && !payload.roles?.includes('admin') && task.userId !== payload.userId) {
      return NextResponse.json({ error: '无权访问此任务' }, { status: 403 });
    }

    // 关联查询 CodeswarmTask 状态和最近事件
    let codeswarmStatus = null;
    if (task.codeswarmTaskId) {
      const csTask = await prisma.codeswarmTask.findUnique({
        where: { taskId: task.codeswarmTaskId },
        select: { state: true, sessionId: true, engine: true, agent: true, model: true, workerId: true, createdAt: true, updatedAt: true },
      });
      if (csTask) {
        const recentEvents = await prisma.codeswarmEvent.findMany({
          where: { taskId: task.codeswarmTaskId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { type: true, data: true, createdAt: true },
        });

        let workerInfo = null;
        if (csTask.workerId) {
          const worker = await prisma.codeswarmWorker.findUnique({
            where: { id: csTask.workerId },
            select: { nodeId: true, status: true },
          });
          if (worker) {
            workerInfo = { workerNodeId: worker.nodeId, workerStatus: worker.status };
          }
        }

        codeswarmStatus = { ...csTask, recentEvents, ...workerInfo };
      }
    }

    return NextResponse.json({ task, logs: task.TaskExecutionLog, codeswarmStatus });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '获取任务详情失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '获取任务详情失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;
  const { id } = await params;

  try {
    const task = await prisma.taskInstance.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant && !payload.roles?.includes('admin') && task.userId !== payload.userId) {
      return NextResponse.json({ error: '无权删除此任务' }, { status: 403 });
    }

    if (task.status === 'running') {
      return NextResponse.json({ error: '执行中的任务无法删除' }, { status: 400 });
    }

    // 清理关联的 CodeswarmTask + CodeswarmEvent
    if (task.codeswarmTaskId) {
      try {
        await prisma.codeswarmEvent.deleteMany({ where: { taskId: task.codeswarmTaskId } });
        await prisma.codeswarmTask.deleteMany({ where: { taskId: task.codeswarmTaskId } });
      } catch (e) {
        logger.warn(LOG_MODULES.AGENT, '删除 CodeswarmTask 关联数据失败', { details: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    // 清理 NFS 目录
    const SHARED_WORKSPACE_BASE = process.env.NFS_MOUNT_PATH || process.env.SHARED_WORKSPACE_PATH || '/data/shared-workspace';
    const resolvedBase = resolve(SHARED_WORKSPACE_BASE);
    const taskDir = resolve(resolvedBase, id);
    if (!taskDir.startsWith(resolvedBase + '/') && taskDir !== resolvedBase) {
      logger.warn(LOG_MODULES.AGENT, `非法任务目录路径，跳过删除: ${taskDir}`);
    } else if (existsSync(taskDir)) {
      try {
        await rm(taskDir, { recursive: true, force: true });
      } catch (e) {
        logger.warn(LOG_MODULES.AGENT, '删除 NFS 目录失败', { details: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    // 清理 MinIO workspace 包
    try {
      const { getMinioClientForCleanup } = await import('@/lib/task-cleanup');
      const mc = getMinioClientForCleanup();
      const WORKSPACE_BUCKET = process.env.MINIO_WORKSPACE_BUCKET || 'workspace';
      await mc.removeObject(WORKSPACE_BUCKET, `workspaces/${id}.tar.gz`);
    } catch (e: any) {
      if (!e?.code?.includes('NoSuch') && e?.statusCode !== 404) {
        logger.warn(LOG_MODULES.AGENT, '删除 MinIO workspace 包失败', { details: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    // 最后删除 TaskInstance（级联删 TaskExecutionLog + Vulnerability）
    // 使用 deleteMany 防止中间清理步骤的级联删除导致记录已不存在时抛异常
    const deleteResult = await prisma.taskInstance.deleteMany({
      where: { id },
    });

    if (deleteResult.count === 0) {
      logger.info(LOG_MODULES.AGENT, `任务 ${id} 已不存在，视为删除成功`);
    }

    return NextResponse.json({ message: '任务已删除' });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '删除任务失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '删除任务失败' }, { status: 500 });
  }
}