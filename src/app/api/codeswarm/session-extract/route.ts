import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

interface SessionExtractResult {
  sessionId: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
  skills: Array<{
    toolName: string;
    toolUseId: string;
    input: Record<string, unknown>;
    result: unknown;
    startTime: string;
    endTime: string;
  }>;
  tools: Array<{
    toolName: string;
    toolUseId: string;
    input: Record<string, unknown>;
    result: unknown;
    startTime: string;
    endTime: string;
  }>;
}

function isSkill(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  if (lower === 'skill') return true;
  if (lower.includes('skill')) return true;
  if (lower.startsWith('audit-') || lower.startsWith('cdm-') || lower.startsWith('tech-')) return true;
  return false;
}

function getOpenCodeDbPath(): string {
  const dataDir = process.env.OPENCODE_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'opencode');
  return path.join(dataDir, 'opencode.db');
}

export async function POST(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    const body = await request.json();
    const { workspacePath } = body;

    if (!workspacePath) {
      return NextResponse.json({ error: '缺少 workspacePath 参数' }, { status: 400 });
    }

    const dbPath = getOpenCodeDbPath();
    const db = new Database(dbPath, { readonly: true });

    const normalizedPath = workspacePath.replace(/\\/g, '/').replace(/\/$/, '');

    const session = db.prepare(`
      SELECT id, title, directory, time_updated
      FROM session
      WHERE directory = ? OR directory = ? OR path = ? OR path = ?
      ORDER BY time_updated DESC
      LIMIT 1
    `).get(
      workspacePath,
      normalizedPath,
      workspacePath,
      normalizedPath
    ) as { id: string; title: string; directory: string; time_updated: number } | undefined;

    if (!session) {
      db.close();
      return NextResponse.json({ error: `没有找到 session (path: ${workspacePath})` }, { status: 404 });
    }

    const sessionId = session.id;

    const parts = db.prepare(`
      SELECT id, data, time_created
      FROM part
      WHERE session_id = ?
      ORDER BY time_created
    `).all(sessionId) as Array<{ id: string; data: string; time_created: number }>;

    db.close();

    const skills: SessionExtractResult['skills'] = [];
    const tools: SessionExtractResult['tools'] = [];

    for (const part of parts) {
      try {
        const parsed = JSON.parse(part.data);
        if (parsed.type === 'tool' && parsed.tool && parsed.state) {
          const toolName = parsed.tool;
          const callID = parsed.callID || part.id;
          const input = parsed.state?.input || {};
          const output = parsed.state?.output;
          const status = parsed.state?.status;
          const startTime = new Date(part.time_created).toISOString();
          const endTime = parsed.state?.time?.end
            ? new Date(parsed.state.time.end).toISOString()
            : startTime;

          const entry = {
            toolName,
            toolUseId: callID,
            input,
            result: output,
            startTime,
            endTime,
          };

          if (isSkill(toolName)) {
            skills.push(entry);
          } else {
            tools.push(entry);
          }
        }
      } catch {
      }
    }

    const result: SessionExtractResult = {
      sessionId,
      summary: session.title || '',
      messageCount: parts.length,
      lastActivity: new Date(session.time_updated).toISOString(),
      skills,
      tools,
    };

    const historyRecord = await prisma.sessionExtractHistory.create({
      data: {
        sessionId,
        workspacePath,
        summary: result.summary,
        skillsCount: skills.length,
        toolsCount: tools.length,
        messageCount: parts.length,
        lastActivity: new Date(session.time_updated),
        rawData: JSON.stringify(result),
      },
    });

    logger.access(LOG_MODULES.SESSION, auth.payload, sessionId, { action: 'session_extract', workspacePath, historyId: historyRecord.id });

    return NextResponse.json({ ...result, historyId: historyRecord.id });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, 'Session 解析失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '解析失败: ' + String(error) }, { status: 500 });
  }
}