import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

/**
 * GET /api/events - SSE 实时事件流
 *
 * 返回来自 AI4WEB 服务器的实时事件流
 *
 * 事件类型:
 * - session.updated
 * - session.deleted
 * - session.idle
 * - session.error
 * - message.updated
 * - message.part.updated
 * - file.edited
 *
 * 过滤的事件（不发送给客户端）:
 * - server.heartbeat（心跳事件）
 */
export async function GET(request: Request) {
  try {
    // 验证 Token - 支持从 Authorization header 或 URL 查询参数获取
    const authHeader = request.headers.get('authorization');
    const url = new URL(request.url);
    const tokenFromQuery = url.searchParams.get('token');
    
    let token: string | null = null;
    
    if (authHeader) {
      token = authHeader.replace('Bearer ', '');
    } else if (tokenFromQuery) {
      token = tokenFromQuery;
    }
    
    if (!token) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    
    const payload = verifyToken(token);
    
    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }
    
    // 检查权限 - 需要会话读取权限来监听事件
    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }
    
    // 获取用户的活跃配置
    const config = await prisma.opencodeConfig.findFirst({
      where: {
        userId: payload.userId,
        isActive: true,
      },
    });
    
    if (!config) {
      return NextResponse.json(
        { error: '未找到活动 AI4WEB 配置' },
        { status: 404 }
      );
    }
    
    // 初始化 AI4WEB SDK
    console.log('[SSE] Initializing client with baseURL:', config.baseURL);
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: config.baseURL });
    
    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;
        let eventCount = 0;
        
        try {
          console.log('[SSE] Starting event stream...');
          // 获取事件流 - 使用 event.subscribe()
          // subscribe() 返回 ServerSentEventsResult { stream: AsyncGenerator }
          const eventResult = await client.event.subscribe();
          console.log('[SSE] Event stream created successfully');
          
          // 监听并发送事件 - 使用 stream 属性
          for await (const event of eventResult.stream) {
            eventCount++;
            
            // 检查 controller 是否已关闭
            if (isClosed) {
              console.log('[SSE] Controller closed, stopping event stream after', eventCount, 'events');
              break;
            }
            
            console.log('[SSE] Received event #', eventCount, ':', event.type);
            
            // 过滤心跳事件，不发送给客户端
            // @ts-ignore - 事件类型可能包含未定义的类型
            if (event?.type === 'server.heartbeat') {
              console.log('[SSE] Filtering heartbeat event');
              continue;
            }
            
            // 构造 SSE 格式: data: {JSON}\n\n
            const eventData = JSON.stringify(event);
            try {
              controller.enqueue(`data: ${eventData}\n\n`);
              console.log('[SSE] Sent event to client:', event.type);
            } catch (enqueueError) {
              // 如果写入失败，说明 controller 已关闭
              console.log('[SSE] Controller already closed, stopping event stream');
              isClosed = true;
              break;
            }
          }
          
          console.log('[SSE] Event stream ended normally, total events:', eventCount);
        } catch (error) {
          console.error('[SSE] Event stream error:', error);
          
          // 只有在 controller 未关闭时才发送错误事件
          if (!isClosed) {
            try {
              const errorEvent = JSON.stringify({
                type: 'error',
                message: '事件流错误',
                error: error instanceof Error ? error.message : '未知错误',
              });
              controller.enqueue(`data: ${errorEvent}\n\n`);
            } catch (enqueueError) {
              // Controller 已关闭，忽略错误
              console.log('[SSE] Failed to send error event, controller closed');
            }
          }
        } finally {
          // 只有在 controller 未关闭时才关闭
          if (!isClosed) {
            try {
              console.log('[SSE] Closing controller...');
              controller.close();
            } catch (closeError) {
              // Controller 已关闭，忽略错误
              console.log('[SSE] Controller already closed');
            }
          }
          isClosed = true;
        }
      },
      cancel() {
        // 客户端断开连接时的清理
        console.log('[SSE] Event stream cancelled by client');
      },
    });
    
    // 返回 SSE 响应
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // 禁用 Nginx 缓冲
      },
    });
  } catch (error) {
    console.error('[SSE] Events API error:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
