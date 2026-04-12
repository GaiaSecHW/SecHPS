// src/app/api/evaluations/[id]/todos/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * 从会话目录的 JSONL 文件中解析 TODO 列表
 */
async function getTodosFromSession(sessionId: string): Promise<any[]> {
  const sessionsDir = path.join(os.homedir(), '.claude', 'projects');
  
  try {
    // 遍历所有项目目录查找会话
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const projectDir = path.join(sessionsDir, entry.name);
      
      // 查找会话文件
      try {
        const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
        const content = await fs.readFile(sessionFile, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        
        // 从后往前找最近的 TodoWrite 调用
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const record = JSON.parse(lines[i]);
            if (record.type === 'tool_use' && record.tool_name === 'TodoWrite' && record.tool_input?.todos) {
              console.log('[TODO] Found TodoWrite with', record.tool_input.todos.length, 'todos');
              return record.tool_input.todos;
            }
          } catch {
            // 跳过无效 JSON
          }
        }
      } catch {
        // 文件不存在，继续查找下一个
      }
    }
  } catch (error) {
    console.error('[TODO] Error reading session directory:', error);
  }
  
  return [];
}

// GET /api/evaluations/[id]/todos - 获取评估会话的 TODO 列表
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    // 获取评估会话
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      select: { opencodeSessionId: true },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    if (!evaluation.opencodeSessionId) {
      console.log('[TODO] No opencodeSessionId for evaluation:', id);
      return NextResponse.json({ todos: [] });
    }

    console.log('[TODO] Fetching todos for session:', evaluation.opencodeSessionId);

    // 优先从数据库读取快照
    const evalSession = await prisma.evaluationSession.findUnique({
      where: { id },
      select: { todoList: true, status: true },
    });

    if (evalSession?.todoList) {
      try {
        const todos = JSON.parse(evalSession.todoList);
        if (Array.isArray(todos) && todos.length > 0) {
          console.log('[TODO] Returning', todos.length, 'todos from DB snapshot');
          return NextResponse.json({ todos, source: 'db' });
        }
      } catch {
        // JSON 解析失败，继续从文件读
      }
    }

    // 数据库没有快照时，从会话文件中解析 TODO
    const todos = await getTodosFromSession(evaluation.opencodeSessionId);

    console.log('[TODO] Returning', todos.length, 'todos from session file');

    return NextResponse.json({ todos });
  } catch (error) {
    console.error('Get todos error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
