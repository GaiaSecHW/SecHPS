// src/app/api/sessions/[id]/children/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { getSessionMessages, listSubagents, getSubagentMessages } from '@anthropic-ai/claude-agent-sdk';

/**
 * 获取会话的子代理列表
 * GET /api/sessions/[id]/children
 */
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

    const { id: sessionId } = await params;
    const url = new URL(request.url);
    const childId = url.searchParams.get('childId'); // 获取子会话ID

    console.log('[Children API] Fetching subagents for session:', sessionId, 'childId:', childId);

    // 查找关联的项目
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { opencodeSessionId: sessionId },
      include: {
        project: {
          select: { projectPath: true }
        }
      }
    });

    const projectPath = evaluation?.project?.projectPath;

    // 如果请求子会话消息
    if (childId) {
      console.log('[Children API] Fetching messages for child:', childId);
      
      try {
        let messages: any[] = [];
        
        if (projectPath) {
          // 使用 SDK 获取子会话消息
          messages = await getSubagentMessages(sessionId, childId, { dir: projectPath });
          console.log('[Children API] SDK returned', messages.length, 'messages for child');
        }
        
        return NextResponse.json({
          messages,
          total: messages.length,
        });
      } catch (error) {
        console.error('[Children API] Failed to get child messages:', error);
        return NextResponse.json({ 
          messages: [], 
          total: 0,
          error: 'Failed to fetch child messages' 
        });
      }
    }

    // 方法1: 尝试使用 SDK 获取子代理列表
    let subagentIds: string[] = [];
    try {
      subagentIds = await listSubagents(sessionId, projectPath ? { dir: projectPath } : undefined);
      console.log('[Children API] SDK returned', subagentIds.length, 'subagents');
    } catch (error) {
      console.warn('[Children API] SDK listSubagents failed:', error);
    }

    // 方法2: 如果 SDK 没有返回，从消息中提取 Agent/task 工具调用
    if (subagentIds.length === 0 && projectPath) {
      console.log('[Children API] Trying to extract subagents from messages...');
      try {
        const messages = await getSessionMessages(sessionId, { dir: projectPath });
        
        // 提取所有 Agent 或 task 工具调用
        const agentCalls: Array<{
          id: string;
          messageId: string;
          messageIndex: number;
          description: string;
          status: string;
          startedAt: string | null;
          completedAt: string | null;
        }> = [];

        // 建立 tool_use id -> tool_result 的映射，用于提取结束时间
        const toolResultMap = new Map<string, { timestamp: string | null }>();
        messages.forEach((msg: any) => {
          if (msg.message?.content && Array.isArray(msg.message.content)) {
            msg.message.content.forEach((part: any) => {
              if (part.type === 'tool_result' && part.tool_use_id) {
                toolResultMap.set(part.tool_use_id, {
                  timestamp: msg.message?.timestamp || msg.timestamp || null,
                });
              }
            });
          }
        });

        messages.forEach((msg: any, msgIndex: number) => {
          if (msg.message?.content && Array.isArray(msg.message.content)) {
            msg.message.content.forEach((part: any) => {
              if (part.type === 'tool_use' && (part.name === 'Agent' || part.name === 'task')) {
                const description = part.input?.description ||
                                   part.input?.prompt?.substring(0, 100) ||
                                   `子任务 ${msgIndex + 1}`;

                // 提取开始时间（工具调用所在消息的时间戳）
                const startedAt = msg.message?.timestamp || msg.timestamp || null;
                // 提取结束时间（对应 tool_result 消息的时间戳）
                const resultInfo = toolResultMap.get(part.id);
                const completedAt = resultInfo?.timestamp || null;

                agentCalls.push({
                  id: part.id || `agent-${msgIndex}-${Date.now()}`,
                  messageId: msg.uuid || `msg-${msgIndex}`,
                  messageIndex: msgIndex,
                  description: description.substring(0, 100),
                  status: 'active',
                  startedAt,
                  completedAt,
                });
              }
            });
          }
        });

        console.log('[Children API] Found', agentCalls.length, 'agent calls from messages');

        // 转换为前端期望的格式
        const children = agentCalls.map(call => ({
          id: call.id,
          sessionId: sessionId,
          messageId: call.messageId,
          messageIndex: call.messageIndex,
          title: call.description,
          status: call.status,
          startedAt: call.startedAt,
          completedAt: call.completedAt,
        }));

        return NextResponse.json({
          children,
          total: children.length,
          source: 'messages',
        });
      } catch (error) {
        console.error('[Children API] Failed to extract from messages:', error);
      }
    }

    // 方法3: 如果都失败了，返回空列表
    const children = subagentIds.map(agentId => ({
      id: agentId,
      sessionId: sessionId,
      title: `子任务 ${agentId.substring(0, 8)}`,
      status: 'active',
    }));

    return NextResponse.json({
      children,
      total: children.length,
      source: 'sdk',
    });
  } catch (error) {
    console.error('[Children API] Error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
