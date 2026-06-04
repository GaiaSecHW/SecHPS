import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import { executeVulnerabilityParseAsync, vulnParseInProgress } from '@/lib/vulnerability-parse';

export async function POST(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.VULNERABILITY_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  try {
    const body = await request.json();
    const { taskInstanceId } = body;

    if (!taskInstanceId || typeof taskInstanceId !== 'string' || !taskInstanceId.trim()) {
      return NextResponse.json({ error: 'taskInstanceId 必填且不能为空字符串' }, { status: 400 });
    }

    const taskInstance = await prisma.taskInstance.findUnique({
      where: { id: taskInstanceId.trim() },
      include: { Vulnerability: { select: { id: true } } },
    });

    if (!taskInstance) {
      return NextResponse.json({ error: '任务实例不存在' }, { status: 404 });
    }

    if (taskInstance.Vulnerability.length > 0) {
      return NextResponse.json({
        error: '已成功解析漏洞报告无需再执行',
        existingCount: taskInstance.Vulnerability.length,
      }, { status: 409 });
    }

    if (taskInstance.status !== 'completed') {
      return NextResponse.json({
        error: '只有已完成的任务才能重新解析',
        currentStatus: taskInstance.status,
      }, { status: 400 });
    }

    const codeswarmTaskId = taskInstance.codeswarmTaskId;
    if (!codeswarmTaskId) {
      return NextResponse.json({ error: '该任务实例无关联的 CodeswarmTask' }, { status: 400 });
    }

    const projectPath = taskInstance.projectPath;
    if (!projectPath) {
      return NextResponse.json({ error: '该任务实例缺少 projectPath' }, { status: 400 });
    }

    if (vulnParseInProgress.has(codeswarmTaskId)) {
      return NextResponse.json({ error: '该任务正在解析中，请稍后再试' }, { status: 409 });
    }

    vulnParseInProgress.add(codeswarmTaskId);

    const productName = taskInstance.targetProduct || 'unknown';
    const taskName = taskInstance.name || 'unnamed-task';

    executeVulnerabilityParseAsync(codeswarmTaskId, projectPath, taskInstanceId, {
      productName,
      taskName,
    }).catch((err) => {
      logger.error(LOG_MODULES.CODESWARM, `[Reparse:${taskInstanceId}] 异步解析异常`, {
        details: { error: err instanceof Error ? err.message : String(err) },
      });
    });

    return NextResponse.json({
      message: '漏洞报告重新解析已启动',
      taskInstanceId,
      codeswarmTaskId,
      productName,
      taskName,
    });
  } catch (e) {
    logger.error(LOG_MODULES.CODESWARM, '漏洞重新解析 API 异常', {
      details: { error: e instanceof Error ? e.message : String(e) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.VULNERABILITY_READ });
  if (!auth.success) return authErrorResponse(auth);

  try {
    const { searchParams } = new URL(request.url);
    const taskInstanceId = searchParams.get('taskInstanceId');

    if (taskInstanceId) {
      const taskInstance = await prisma.taskInstance.findUnique({
        where: { id: taskInstanceId.trim() },
        include: { Vulnerability: { select: { id: true } } },
      });

      if (!taskInstance) {
        return NextResponse.json({ error: '任务实例不存在' }, { status: 404 });
      }

      const codeswarmTaskId = taskInstance.codeswarmTaskId || '';
      return NextResponse.json({
        taskInstanceId: taskInstance.id,
        name: taskInstance.name,
        status: taskInstance.status,
        projectPath: taskInstance.projectPath,
        targetProduct: taskInstance.targetProduct,
        codeswarmTaskId,
        vulnerabilityCount: taskInstance.Vulnerability.length,
        isParsing: codeswarmTaskId ? vulnParseInProgress.has(codeswarmTaskId) : false,
        canReparse: taskInstance.status === 'completed' && taskInstance.Vulnerability.length === 0 && !!taskInstance.codeswarmTaskId && !!taskInstance.projectPath,
      });
    }

    const completedTasks = await prisma.taskInstance.findMany({
      where: {
        status: 'completed',
        codeswarmTaskId: { not: null },
        projectPath: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { Vulnerability: { select: { id: true } } },
    });

    const items = completedTasks.map((t) => ({
      taskInstanceId: t.id,
      name: t.name,
      status: t.status,
      projectPath: t.projectPath,
      targetProduct: t.targetProduct,
      codeswarmTaskId: t.codeswarmTaskId || '',
      vulnerabilityCount: t.Vulnerability.length,
      isParsing: t.codeswarmTaskId ? vulnParseInProgress.has(t.codeswarmTaskId) : false,
      canReparse: t.Vulnerability.length === 0 && !!t.codeswarmTaskId && !!t.projectPath,
    }));

    return NextResponse.json({ items, total: items.length });
  } catch (e) {
    logger.error(LOG_MODULES.CODESWARM, '漏洞重新解析列表 API 异常', {
      details: { error: e instanceof Error ? e.message : String(e) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}