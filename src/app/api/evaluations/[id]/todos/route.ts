// src/app/api/evaluations/[id]/todos/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { logger, LOG_MODULES } from '@/lib/logger';

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
              logger.debug(LOG_MODULES.EVALUATION, '找到 TodoWrite:', { details: { count: record.tool_input.todos.length } });
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
    logger.errorNoUser(LOG_MODULES.EVALUATION, '读取会话目录错误:', { details: { error: String(error) } });
  }
  
  return [];
}

// GET /api/evaluations/[id]/todos - 获取评估会话的 TODO 列表
// 数据隔离：普通用户只能查看自己项目评估的 TODO，管理员可以查看所有
// 支持 nodeId 过滤（用于按节点显示任务）
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
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId'); // 可选：按节点过滤

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 获取评估会话并验证所有权
    let where: any = { id };
    
    const evaluation = await prisma.evaluationSession.findFirst({
      where,
      select: { 
        opencodeSessionId: true,
        todoList: true,
        status: true,
        Project: { select: { userId: true } },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 归属校验（管理员绕过）
    if (!userIsAdmin && evaluation.Project.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    logger.debug(LOG_MODULES.EVALUATION, '获取会话 TODO:', { details: { sessionId: evaluation.opencodeSessionId, nodeId } });

    // 优先从数据库读取快照
    if (evaluation.todoList) {
      try {
        const todos = JSON.parse(evaluation.todoList);
        if (Array.isArray(todos) && todos.length > 0) {
          // 如果有nodeId参数，过滤todos
          let filteredTodos = todos;
          if (nodeId) {
            filteredTodos = todos.filter((todo: any) => {
              // 每个todo可能包含nodeId或workflowNodeId字段
              return todo.nodeId === nodeId || todo.workflowNodeId === nodeId;
            });
          }
          logger.debug(LOG_MODULES.EVALUATION, '从数据库快照返回 TODO:', { details: { count: filteredTodos.length, nodeId } });
          return NextResponse.json({ todos: filteredTodos, source: 'db' });
        }
      } catch {
        // JSON 解析失败，继续从文件读
      }
    }

    if (!evaluation.opencodeSessionId) {
      logger.debug(LOG_MODULES.EVALUATION, '评估会话没有 opencodeSessionId:', { details: { id } });
      return NextResponse.json({ todos: [] });
    }

    // 数据库没有快照时，从会话文件中解析 TODO
    const todos = await getTodosFromSession(evaluation.opencodeSessionId);

    logger.debug(LOG_MODULES.EVALUATION, '从会话文件返回 TODO:', { details: { count: todos.length } });

    return NextResponse.json({ todos });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '获取 TODO 错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}