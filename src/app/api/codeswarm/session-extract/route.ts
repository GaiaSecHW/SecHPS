import { NextResponse } from 'next/server';
import { SessionManager } from '@/services/session-manager';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

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
  if (lower.includes('skill')) return true;
  if (lower.startsWith('audit-') || lower.startsWith('cdm-') || lower.startsWith('tech-')) return true;
  return false;
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

    const sessionManager = new SessionManager(workspacePath);

    const { sessions } = await sessionManager.getSessions(1, 0);
    if (sessions.length === 0) {
      return NextResponse.json({ error: '没有找到 session' }, { status: 404 });
    }

    const latestSession = sessions[0];
    const sessionId = latestSession.id;

    const { messages } = await sessionManager.getSessionMessages(sessionId, null, 0);

    const resultMap = new Map<string, { result: unknown; endTime: string }>();
    for (const msg of messages) {
      if (msg.type === 'tool_result' && msg.tool_use_id) {
        resultMap.set(msg.tool_use_id, {
          result: msg.tool_result,
          endTime: msg.timestamp,
        });
      }
    }

    const skills: SessionExtractResult['skills'] = [];
    const tools: SessionExtractResult['tools'] = [];

    for (const msg of messages) {
      if (msg.type === 'tool_use' && msg.tool_name) {
        const resultInfo = msg.tool_use_id ? resultMap.get(msg.tool_use_id) : undefined;
        const entry = {
          toolName: msg.tool_name,
          toolUseId: msg.tool_use_id || '',
          input: msg.tool_input || {},
          result: resultInfo?.result,
          startTime: msg.timestamp,
          endTime: resultInfo?.endTime || msg.timestamp,
        };

        if (isSkill(msg.tool_name)) {
          skills.push(entry);
        } else {
          tools.push(entry);
        }
      }
    }

    const result: SessionExtractResult = {
      sessionId,
      summary: latestSession.summary || '',
      messageCount: messages.length,
      lastActivity: latestSession.lastActivity,
      skills,
      tools,
    };

    logger.access(LOG_MODULES.SESSION, auth.payload, sessionId, { action: 'session_extract', workspacePath });

    return NextResponse.json(result);
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, 'Session 解析失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '解析失败' }, { status: 500 });
  }
}