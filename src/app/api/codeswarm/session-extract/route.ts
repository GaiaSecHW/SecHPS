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
    reasoning: string[];
    textOutputs: string[];
  }>;
  tools: Array<{
    toolName: string;
    toolUseId: string;
    input: Record<string, unknown>;
    result: unknown;
    startTime: string;
    endTime: string;
  }>;
  reasoning: Array<{
    content: string;
    startTime: string;
  }>;
  textOutputs: Array<{
    content: string;
    startTime: string;
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
    const reasoning: SessionExtractResult['reasoning'] = [];
    const textOutputs: SessionExtractResult['textOutputs'] = [];

    type PartEntry = {
      type: 'tool' | 'reasoning' | 'text';
      time: number;
      data: any;
    };

    const allParts: PartEntry[] = [];

    for (const part of parts) {
      try {
        const parsed = JSON.parse(part.data);
        const time = part.time_created;

        if (parsed.type === 'tool' && parsed.tool && parsed.state) {
          allParts.push({ type: 'tool', time, data: parsed });
        } else if (parsed.type === 'reasoning' && parsed.text) {
          allParts.push({ type: 'reasoning', time, data: parsed });
        } else if (parsed.type === 'text' && parsed.text) {
          allParts.push({ type: 'text', time, data: parsed });
        }
      } catch {}
    }

    const skillGroups: Array<{
      startIndex: number;
      endIndex: number;
      lastEndTime: number;
      skillIndices: number[];
    }> = [];

    let currentGroup: Array<{ time: number; skillIndex: number }> = [];
    const SKILL_GROUP_THRESHOLD = 2000;

    for (const entry of allParts) {
      if (entry.type === 'tool') {
        const parsed = entry.data;
        const toolName = parsed.tool;
        const callID = parsed.callID || '';
        const input = parsed.state?.input || {};
        const output = parsed.state?.output;
        const startTimeIso = new Date(entry.time).toISOString();
        const endTimeNum = parsed.state?.time?.end || entry.time;
        const endTimeIso = new Date(endTimeNum).toISOString();

        if (isSkill(toolName)) {
          const skillIndex = skills.length;
          
          if (currentGroup.length === 0) {
            currentGroup.push({ time: endTimeNum, skillIndex });
          } else {
            const lastSkill = currentGroup[currentGroup.length - 1];
            const gap = entry.time - lastSkill.time;
            
            if (gap < SKILL_GROUP_THRESHOLD) {
              currentGroup.push({ time: endTimeNum, skillIndex });
            } else {
              skillGroups.push({
                startIndex: currentGroup[0].skillIndex,
                endIndex: currentGroup[currentGroup.length - 1].skillIndex,
                lastEndTime: currentGroup[currentGroup.length - 1].time,
                skillIndices: currentGroup.map(s => s.skillIndex),
              });
              currentGroup = [{ time: endTimeNum, skillIndex }];
            }
          }

          skills.push({
            toolName,
            toolUseId: callID,
            input,
            result: output,
            startTime: startTimeIso,
            endTime: endTimeIso,
            reasoning: [],
            textOutputs: [],
          });
        } else {
          tools.push({
            toolName,
            toolUseId: callID,
            input,
            result: output,
            startTime: startTimeIso,
            endTime: endTimeIso,
          });
        }
      }
    }

    if (currentGroup.length > 0) {
      skillGroups.push({
        startIndex: currentGroup[0].skillIndex,
        endIndex: currentGroup[currentGroup.length - 1].skillIndex,
        lastEndTime: currentGroup[currentGroup.length - 1].time,
        skillIndices: currentGroup.map(s => s.skillIndex),
      });
    }

    for (const entry of allParts) {
      if (entry.type === 'reasoning') {
        reasoning.push({
          content: entry.data.text,
          startTime: new Date(entry.time).toISOString(),
        });

        for (const group of skillGroups) {
          if (entry.time > group.lastEndTime) {
            const nextGroup = skillGroups.find(g => g.lastEndTime > group.lastEndTime && entry.time < g.lastEndTime);
            if (!nextGroup) {
              for (const idx of group.skillIndices) {
                skills[idx].reasoning.push(entry.data.text);
              }
            }
          }
        }
      } else if (entry.type === 'text') {
        const text = entry.data.text;
        if (text && text.trim()) {
          textOutputs.push({
            content: text,
            startTime: new Date(entry.time).toISOString(),
          });

          for (const group of skillGroups) {
            if (entry.time > group.lastEndTime) {
              const nextGroup = skillGroups.find(g => g.lastEndTime > group.lastEndTime && entry.time < g.lastEndTime);
              if (!nextGroup) {
                for (const idx of group.skillIndices) {
                  skills[idx].textOutputs.push(text);
                }
              }
            }
          }
        }
      }
    }

    const result: SessionExtractResult = {
      sessionId,
      summary: session.title || '',
      messageCount: parts.length,
      lastActivity: new Date(session.time_updated).toISOString(),
      skills,
      tools,
      reasoning,
      textOutputs,
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