import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

const RESULT_TRUNCATE_SIZE = 50_000;

function isSkillTool(toolName: string): boolean {
  const lower = (toolName || '').toLowerCase();
  return lower === 'skill' || lower.includes('skill') ||
    lower.startsWith('audit-') || lower.startsWith('cdm-') || lower.startsWith('tech-');
}

function extractFromToolEvents(rows: any[]): { skills: any[]; tools: any[]; reasoning: any[] } {
  const tools: any[] = [];
  const skills: any[] = [];
  let lastEntry: any = null;

  for (const row of rows) {
    let data: any;
    try { data = JSON.parse(row.data); } catch { continue; }

    if (row.type === 'tool_call') {
      const entry = {
        toolName: data.tool || data.toolName || '(unknown)',
        toolUseId: data.toolUseId || '',
        input: data.input ?? data.params ?? {},
        result: undefined as string | undefined,
        startTime: row.createdAt,
      };
      if (isSkillTool(entry.toolName)) skills.push(entry);
      else tools.push(entry);
      lastEntry = entry;
    } else if (row.type === 'tool_call_update' && lastEntry) {
      const output: string = data.output ?? data.result ?? '';
      const skillMatch = typeof output === 'string' && output.match(/Launching skill:\s*([^\s"\\]+)/);
      lastEntry.result = typeof output === 'string' ? output.slice(0, 5000) : String(output).slice(0, 5000);
      if (skillMatch) lastEntry.toolName = skillMatch[1];
      lastEntry = null;
    }
  }
  return { skills, tools, reasoning: [] };
}

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
    let skillCount = 0;
    let toolCount = 0;
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

      // 1. Check session_extract_history cache
      if (csTask?.sessionId) {
        const cacheRows = await prisma.$queryRaw`
          SELECT "rawData" FROM "session_extract_history"
          WHERE "sessionId" = ${csTask.sessionId}
          ORDER BY "extractedAt" DESC
          LIMIT 1
        ` as any[];
        if (cacheRows[0]?.rawData) {
          try {
            const raw = JSON.parse(cacheRows[0].rawData);
            sessionExtract = { skills: raw.skills || [], tools: raw.tools || [], reasoning: raw.reasoning || [] };
            skillCount = sessionExtract.skills.length;
            toolCount = sessionExtract.tools.length;
          } catch {}
        }
      }

      // 2. Cache miss → extract from tool_call events + cache
      if (!sessionExtract && eventCount > 0) {
        const toolEvents = await prisma.$queryRaw`
          SELECT type, data, "createdAt"
          FROM "CodeswarmEvent"
          WHERE "taskId" = ${instance.codeswarmTaskId} AND type IN ('tool_call', 'tool_call_update')
          ORDER BY "createdAt" ASC
        ` as any[];

        if (toolEvents.length > 0) {
          sessionExtract = extractFromToolEvents(toolEvents);
          skillCount = sessionExtract.skills.length;
          toolCount = sessionExtract.tools.length;

          // Cache result
          if (csTask?.sessionId) {
            try {
              const rawData = JSON.stringify(sessionExtract);
              await prisma.$executeRaw`
                INSERT INTO "session_extract_history" ("id", "sessionId", "workspacePath", "skillsCount", "toolsCount", "messageCount", "lastActivity", "extractedAt", "rawData")
                VALUES (gen_random_uuid(), ${csTask.sessionId}, ${csTask.workspacePath || ''}, ${skillCount}, ${toolCount}, ${eventCount}, NOW(), NOW(), ${rawData})
              `;
            } catch (e: any) {
              logger.warn(LOG_MODULES.AGENT, '缓存 session_extract 失败', { details: { error: e.message } });
            }
          }
        }
      }

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
    }

    return NextResponse.json({
      instance,
      csTask,
      events,
      eventCount,
      skillCount,
      toolCount,
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
