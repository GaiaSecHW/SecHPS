import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma, Prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { getTenantIdForCreate } from '@/lib/tenant-filter';
import { createTaskWithFiles } from '@/lib/task-creation';

type DisplayStatus = 'pending' | 'queued' | 'dispatched' | 'running' | 'completed' | 'failed';

function mapDisplayStatus(
  taskStatus: string,
  codeswarmState: string | null | undefined,
  hasCodeswarmTaskId: boolean,
): DisplayStatus {
  if (!hasCodeswarmTaskId || codeswarmState === null || codeswarmState === undefined) {
    if (taskStatus === 'completed') return 'completed';
    if (taskStatus === 'failed') return 'failed';
    if (taskStatus === 'running') return 'running';
    return 'pending';
  }
  switch (codeswarmState) {
    case 'queued': return 'queued';
    case 'dispatched': return 'dispatched';
    case 'building': return 'running';
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    default: return 'pending';
  }
}

async function fetchCodeswarmMeta(codeswarmTaskIds: string[]) {
  const codeswarmStateMap = new Map<string, string>();
  const workerMap = new Map<string, { workerNodeId: string | null; workerStatus: string | null }>();

  if (codeswarmTaskIds.length === 0) return [codeswarmStateMap, workerMap] as const;

  const [stateRows, workerRows] = await Promise.all([
    prisma.$queryRaw<{ taskId: string; state: string }[]>`
      SELECT ct."taskId", ct."state"
      FROM "CodeswarmTask" ct
      WHERE ct."taskId" IN (${Prisma.join(codeswarmTaskIds)})
    `,
    prisma.$queryRaw<{ taskId: string; workerNodeId: string | null; workerStatus: string | null }[]>`
      SELECT ct."taskId", w."nodeId" as "workerNodeId", w."status" as "workerStatus"
      FROM "CodeswarmTask" ct
      LEFT JOIN "CodeswarmWorker" w ON ct."workerId" = w.id
      WHERE ct."taskId" IN (${Prisma.join(codeswarmTaskIds)})
    `,
  ]);

  for (const row of stateRows) codeswarmStateMap.set(row.taskId, row.state);
  for (const row of workerRows) workerMap.set(row.taskId, { workerNodeId: row.workerNodeId, workerStatus: row.workerStatus });

  return [codeswarmStateMap, workerMap] as const;
}

function augmentTask(task: any, codeswarmStateMap: Map<string, string>, workerMap: Map<string, { workerNodeId: string | null; workerStatus: string | null }>) {
  const hasCsid = task.codeswarmTaskId !== null && task.codeswarmTaskId !== undefined;
  const csState = hasCsid ? codeswarmStateMap.get(task.codeswarmTaskId!) ?? null : null;
  return {
    ...task,
    displayStatus: mapDisplayStatus(task.status, csState, hasCsid),
    workerNodeId: hasCsid ? (workerMap.get(task.codeswarmTaskId!)?.workerNodeId ?? null) : null,
    workerStatus: hasCsid ? (workerMap.get(task.codeswarmTaskId!)?.workerStatus ?? null) : null,
  };
}

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

    const taskId = randomUUID();

    const files: { name: string; buffer: Buffer }[] = [];
    if (file && file.size > 0) {
      const arrayBuffer = await file.arrayBuffer();
      files.push({ name: file.name, buffer: Buffer.from(arrayBuffer) });
    }

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
  const search = searchParams.get('search') || '';
  const displayStatusFilter = searchParams.get('displayStatus') || '';

  try {
    const conditions: any[] = [];

    if (!tenant.isPlatformAdmin && !(tenant.isIcsTenant && payload.roles?.includes('admin'))) {
      conditions.push({ userId: payload.userId });
    }

    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { agentName: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const where = conditions.length > 0 ? { AND: conditions } : {};
    const taskSelect = {
      id: true,
      name: true,
      status: true,
      agentId: true,
      agentName: true,
      modelId: true,
      modelName: true,
      notes: true,
      errorMessage: true,
      createdAt: true,
      codeswarmTaskId: true,
      User: { select: { username: true } },
    };

    // 有 displayStatus 筛选时需要全量查（displayStatus 是 JS 计算的派生字段，无法下推 DB）
    if (displayStatusFilter) {
      const allTasks = await prisma.taskInstance.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: taskSelect,
      });

      const codeswarmTaskIds = allTasks
        .map(t => t.codeswarmTaskId)
        .filter((id): id is string => id !== null && id !== undefined);

      const [codeswarmStateMap, workerMap] = await fetchCodeswarmMeta(codeswarmTaskIds);

      const augmentedTasks = allTasks.map(task => augmentTask(task, codeswarmStateMap, workerMap));
      const filteredTasks = augmentedTasks.filter(t => t.displayStatus === displayStatusFilter);

      const total = filteredTasks.length;
      const totalPages = Math.ceil(total / limit);
      const skip = (page - 1) * limit;
      const paginatedTasks = filteredTasks.slice(skip, skip + limit);

      return NextResponse.json({
        tasks: paginatedTasks,
        pagination: { total, page, limit, totalPages },
      });
    }

    // 无 displayStatus 筛选时走 DB 分页（常见路径）
    const [total, paginatedTasks] = await Promise.all([
      prisma.taskInstance.count({ where }),
      prisma.taskInstance.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: taskSelect,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const codeswarmTaskIds = paginatedTasks
      .map(t => t.codeswarmTaskId)
      .filter((id): id is string => id !== null && id !== undefined);

    const [codeswarmStateMap, workerMap] = await fetchCodeswarmMeta(codeswarmTaskIds);
    const tasks = paginatedTasks.map(task => augmentTask(task, codeswarmStateMap, workerMap));

    const totalPages = Math.ceil(total / limit);
    return NextResponse.json({
      tasks,
      pagination: { total, page, limit, totalPages },
    });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '获取任务列表失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '获取任务列表失败' }, { status: 500 });
  }
}