import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

const RESULT_TRUNCATE_SIZE = 50_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await params;
  const includeEvents = request.nextUrl.searchParams.get('includeEvents') === 'true';
  const eventOffset = Math.max(0, parseInt(request.nextUrl.searchParams.get('eventOffset') || '0'));
  const eventLimit = Math.min(Math.max(1, parseInt(request.nextUrl.searchParams.get('eventLimit') || '200')), 500);
  const includeExecLogs = request.nextUrl.searchParams.get('includeExecLogs') === 'true';
  const logOffset = Math.max(0, parseInt(request.nextUrl.searchParams.get('logOffset') || '0'));
  const logLimit = Math.min(Math.max(1, parseInt(request.nextUrl.searchParams.get('logLimit') || '100')), 500);

  try {
    const instance = await prisma.taskInstance.findUnique({
      where: { id },
      select: {
        name: true,
        agentName: true,
        modelName: true,
        targetProduct: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        codeswarmTaskId: true,
      },
    });
    if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    let csTask: any = null;
    let events: any[] | null = null;
    let eventCount = 0;
    let execLogs: any[] | null = null;
    let execLogCount = 0;
    let sessionExtract: any = null;
    let resultTruncated = false;

    // Exec log count (always returned)
    const logCountRows = await prisma.$queryRaw`
      SELECT COUNT(*)::int as cnt FROM "TaskExecutionLog"
      WHERE "taskId" = ${id}
    ` as any[];
    execLogCount = logCountRows[0]?.cnt ?? 0;

    // Paginated exec logs
    if (includeExecLogs && execLogCount > 0) {
      execLogs = await prisma.$queryRaw`
        SELECT timestamp, level, message
        FROM "TaskExecutionLog"
        WHERE "taskId" = ${id}
        ORDER BY timestamp ASC
        LIMIT ${logLimit}
        OFFSET ${logOffset}
      ` as any[];
    }

    if (instance.codeswarmTaskId) {
      const csTasks = await prisma.$queryRaw`
        SELECT engine, model, "workspacePath", result, error, "reportContent", "sessionId"
        FROM "CodeswarmTask"
        WHERE "taskId" = ${instance.codeswarmTaskId}
        LIMIT 1
      ` as any[];
      csTask = csTasks[0] ?? null;

      if (csTask) {
        if (csTask.result && csTask.result.length > RESULT_TRUNCATE_SIZE) {
          csTask.result = csTask.result.slice(0, RESULT_TRUNCATE_SIZE) + '\n... [已截断]';
          resultTruncated = true;
        }
        if (csTask.reportContent && csTask.reportContent.length > RESULT_TRUNCATE_SIZE) {
          csTask.reportContent = csTask.reportContent.slice(0, RESULT_TRUNCATE_SIZE) + '\n... [已截断]';
          resultTruncated = true;
        }
      }

      // Event count (always returned)
      const countRows = await prisma.$queryRaw`
        SELECT COUNT(*)::int as cnt FROM "CodeswarmEvent"
        WHERE "taskId" = ${instance.codeswarmTaskId}
      ` as any[];
      eventCount = countRows[0]?.cnt ?? 0;

      // Paginated events
      if (includeEvents && eventCount > 0) {
        const rawEvents = await prisma.$queryRaw`
          SELECT id, type, data, level, stream, "createdAt"
          FROM "CodeswarmEvent"
          WHERE "taskId" = ${instance.codeswarmTaskId}
          ORDER BY "createdAt" ASC
          LIMIT ${eventLimit}
          OFFSET ${eventOffset}
        ` as any[];

        events = rawEvents.map((e: any) => {
          try {
            const parsed = JSON.parse(e.data);
            return { ...parsed, _id: e.id, _type: e.type, _level: e.level, _stream: e.stream, _createdAt: e.createdAt };
          } catch {
            return { content: e.data, _id: e.id, _type: e.type, _level: e.level, _stream: e.stream, _createdAt: e.createdAt };
          }
        });
      }

      if (csTask?.sessionId) {
        const rows = await prisma.$queryRaw`
          SELECT "rawData" FROM "session_extract_history"
          WHERE "sessionId" = ${csTask.sessionId}
          ORDER BY "extractedAt" DESC
          LIMIT 1
        ` as any[];
        if (rows[0]?.rawData) {
          try {
            const raw = JSON.parse(rows[0].rawData);
            sessionExtract = { skills: raw.skills || [], tools: raw.tools || [], reasoning: raw.reasoning || [] };
          } catch {}
        }
      }
    }

    return NextResponse.json({
      instance,
      csTask,
      events,
      eventCount,
      execLogs,
      execLogCount,
      sessionExtract,
      resultTruncated,
    });
  } catch (e: any) {
    logger.errorNoUser(LOG_MODULES.AGENT, '获取数据回流详情失败', { details: { error: e.message } });
    return NextResponse.json({ error: '获取详情失败' }, { status: 500 });
  }
}
