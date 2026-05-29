import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma, Prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { getTenantIdForCreate } from '@/lib/tenant-filter';
import { createTaskWithFiles } from '@/lib/task-creation';

export async function POST(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const formData = await request.formData();
    const agentId = formData.get('agentId') as string;
    const agentName = formData.get('agentName') as string;
    const modelId = formData.get('modelId') as string | null;
    const modelName = formData.get('modelName') as string | null;
    const parameters = formData.get('parameters') as string;
    const notes = formData.get('notes') as string | null;
    const skills = formData.get('skills') as string | null;
    const scripts = formData.get('scripts') as string | null;
    const targetProduct = formData.get('targetProduct') as string | null;
    const file = formData.get('file') as File | null;
    const userProvidedName = formData.get('name') as string | null;

    if (!agentId) {
      return NextResponse.json({ error: '缺少必填参数：agentId' }, { status: 400 });
    }

    // 使用用户提供的名称，为空时自动生成
    let name = userProvidedName?.trim();
    if (!name) {
      let tenantName = 'public';
      if (tenant.tenantId) {
        const tenantRecord = await prisma.tenant.findUnique({
          where: { id: tenant.tenantId },
          select: { name: true },
        });
        if (tenantRecord) tenantName = tenantRecord.name;
      }
      name = `${payload.username}_${tenantName}_${Date.now()}`;
    }

    // notes 为可选字段，无需校验

    const taskId = randomUUID();

    // 准备文件数据
    const files: { name: string; buffer: Buffer }[] = [];
    if (file && file.size > 0) {
      const arrayBuffer = await file.arrayBuffer();
      files.push({
        name: file.name,
        buffer: Buffer.from(arrayBuffer),
      });
    }

    // 使用共享函数创建任务
    const result = await createTaskWithFiles({
      taskId,
      userId: payload.userId,
      tenantId: tenant.tenantId,
      isPublic: tenant.isIcsTenant,
      agentId,
      agentName,
      name,
      notes: notes || '',
      modelId: modelId || null,
      modelName: modelName || null,
      parameters: parameters || '{}',
      skills,
      scripts,
      targetProduct,
      files: files.length > 0 ? files : null,
    });

    return NextResponse.json({ task: result.task });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '创建任务失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '创建任务失败' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const skip = (page - 1) * limit;

  try {
    // 构建租户过滤条件
    let where: any = {};

    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant && !payload.roles?.includes('admin')) {
      where.userId = payload.userId;
    }

    const [tasks, total] = await Promise.all([
      prisma.taskInstance.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.taskInstance.count({ where }),
    ]);

    // 收集所有 codeswarmTaskId，批量查询 Worker 信息
    const codeswarmTaskIds = tasks
      .map(t => t.codeswarmTaskId)
      .filter((id): id is string => id !== null && id !== undefined);

    let workerMap = new Map<string, { workerNodeId: string | null; workerStatus: string | null }>();

    if (codeswarmTaskIds.length > 0) {
      const workerRows: { taskId: string; workerNodeId: string | null; workerStatus: string | null }[] =
        await prisma.$queryRaw`
          SELECT ct."taskId", w."nodeId" as "workerNodeId", w."status" as "workerStatus"
          FROM "CodeswarmTask" ct
          LEFT JOIN "CodeswarmWorker" w ON ct."workerId" = w.id
          WHERE ct."taskId" IN (${Prisma.join(codeswarmTaskIds)})
        `;
      for (const row of workerRows) {
        workerMap.set(row.taskId, { workerNodeId: row.workerNodeId, workerStatus: row.workerStatus });
      }
    }

    // 为每个 task 添加 worker 信息
    const augmentedTasks = tasks.map(task => ({
      ...task,
      workerNodeId: task.codeswarmTaskId ? (workerMap.get(task.codeswarmTaskId)?.workerNodeId ?? null) : null,
      workerStatus: task.codeswarmTaskId ? (workerMap.get(task.codeswarmTaskId)?.workerStatus ?? null) : null,
    }));

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      tasks: augmentedTasks,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '获取任务列表失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '获取任务列表失败' }, { status: 500 });
  }
}