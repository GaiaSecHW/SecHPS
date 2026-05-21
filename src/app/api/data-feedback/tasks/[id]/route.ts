import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await params;

  try {
    const instance = await prisma.taskInstance.findUnique({
      where: { id },
      include: { TaskExecutionLog: { orderBy: { timestamp: 'asc' } } },
    });
    if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    let csTask: any = null;
    let events: any[] = [];
    let sessionExtract: any = null;

    if (instance.codeswarmTaskId) {
      const csTasks = await prisma.$queryRaw`
        SELECT "taskId", state, engine, model, "sessionId", instruction, "projectPath",
               "workspacePath", agent, skills, result, error, "reportContent",
               "startedAt", "completedAt", "createdAt"
        FROM "CodeswarmTask"
        WHERE "taskId" = ${instance.codeswarmTaskId}
        LIMIT 1
      ` as any[];
      csTask = csTasks[0] ?? null;

      const rawEvents = await prisma.$queryRaw`
        SELECT id, type, data, level, stream, "createdAt"
        FROM "CodeswarmEvent"
        WHERE "taskId" = ${instance.codeswarmTaskId}
        ORDER BY "createdAt" ASC
      ` as any[];

      events = rawEvents.map((e: any) => {
        try {
          const parsed = JSON.parse(e.data);
          return { ...parsed, _id: e.id, _type: e.type, _level: e.level, _stream: e.stream, _createdAt: e.createdAt };
        } catch {
          return { content: e.data, _id: e.id, _type: e.type, _level: e.level, _stream: e.stream, _createdAt: e.createdAt };
        }
      });

      if (csTask?.sessionId) {
        const rows = await prisma.$queryRaw`
          SELECT "rawData" FROM "session_extract_history"
          WHERE "sessionId" = ${csTask.sessionId}
          ORDER BY "extractedAt" DESC
          LIMIT 1
        ` as any[];
        if (rows[0]?.rawData) {
          try { sessionExtract = JSON.parse(rows[0].rawData); } catch {}
        }
      }
    }

    return NextResponse.json({
      instance,
      csTask,
      events,
      execLogs: instance.TaskExecutionLog,
      sessionExtract,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
