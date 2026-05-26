import { NextResponse } from 'next/server';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma, Prisma } from '@/lib/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  try {
    const { nodeId } = await params;

    // 使用 $queryRaw 替代 findUnique + include，避免远程 PostgreSQL 挂起问题
    const workers = await prisma.$queryRaw`
      SELECT w.id, w."nodeId", w.address, w.status, w."maxConcurrent",
             w."currentTasks", w.token, w."lastHeartbeat", w."createdAt", w."updatedAt",
             t.id as "taskId", t."taskId" as "taskTaskId", t.state as "taskState",
             t.instruction, t."projectPath", t."workspacePath", t."gitUrl", t."gitRef",
             t.skills, t.mcps, t.events, t.error, t."startedAt", t."completedAt",
             t."createdAt" as "taskCreatedAt", t."updatedAt" as "taskUpdatedAt"
      FROM "CodeswarmWorker" w
      LEFT JOIN "CodeswarmTask" t ON w.id = t."workerId"
      WHERE w."nodeId" = ${nodeId}
      ORDER BY t."createdAt" DESC
    ` as any[];

    if (workers.length === 0) {
      return NextResponse.json({ error: 'Worker not found' }, { status: 404 });
    }

    // 从第一行提取 Worker 信息
    const first = workers[0];
    const worker: any = {
      id: first.id,
      nodeId: first.nodeId,
      address: first.address,
      status: first.status,
      maxConcurrent: first.maxConcurrent,
      currentTasks: first.currentTasks,
      token: first.token,
      lastHeartbeat: first.lastHeartbeat,
      createdAt: first.createdAt,
      updatedAt: first.updatedAt,
    };

    // 提取关联的任务（去除没有任务的行）
    const tasks = workers
      .filter(row => row.taskId)
      .map(row => ({
        id: row.taskId,
        taskId: row.taskTaskId,
        state: row.taskState,
        instruction: row.instruction,
        projectPath: row.projectPath,
        workspacePath: row.workspacePath,
        gitUrl: row.gitUrl,
        gitRef: row.gitRef,
        skills: row.skills ? JSON.parse(row.skills) : null,
        mcps: row.mcps ? JSON.parse(row.mcps) : null,
        events: row.events ? JSON.parse(row.events) : null,
        error: row.error,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        createdAt: row.taskCreatedAt,
        updatedAt: row.taskUpdatedAt,
      }))
      .slice(0, 20); // LIMIT 20

    return NextResponse.json({
      worker: {
        ...worker,
        CodeswarmTask: tasks,
      },
    });
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'Get node error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: 'Failed to fetch node' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  try {
    const { nodeId } = await params;
    const body = await request.json();
    const { maxConcurrent, name, status } = body;

    const data: Record<string, any> = { updatedAt: new Date() };
    if (maxConcurrent !== undefined) data.maxConcurrent = Math.max(1, Math.min(50, maxConcurrent));
    if (name !== undefined) data.name = name;
    if (status !== undefined) data.status = status;

    const worker = await prisma.codeswarmWorker.update({
      where: { nodeId },
      data,
    });

    return NextResponse.json({ success: true, worker });
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'Patch node error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: 'Failed to update node' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  try {
    const { nodeId } = await params;

    await prisma.codeswarmWorker.delete({ where: { nodeId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'Delete node error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: 'Failed to delete node' }, { status: 500 });
  }
}