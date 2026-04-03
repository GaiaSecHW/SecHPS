import { NextRequest, NextResponse } from 'next/server';
import { routeRequest, routeStreamRequest, RouteError } from '@/lib/claude-router/router';
import { verifyToken } from '@/lib/auth';

/**
 * 从请求中提取 API Key
 */
function extractApiKey(request: NextRequest): string | null {
  // 1. 从 x-api-key 头获取
  const apiKey = request.headers.get('x-api-key');
  if (apiKey) {
    return apiKey;
  }

  // 2. 从 Authorization 头获取 (Bearer token)
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

/**
 * 验证请求认证
 */
function authenticate(request: NextRequest): boolean {
  const apiKey = extractApiKey(request);

  if (!apiKey) {
    return false;
  }

  // 验证 JWT Token
  const payload = verifyToken(apiKey);
  return payload !== null;
}

/**
 * 生成 Anthropic 格式的消息 ID
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 处理非流式请求
 */
async function handleNonStreamRequest(request: NextRequest) {
  try {
    // 解析请求体
    const body = await request.json();

    // 验证请求格式
    if (!body.model || !body.messages) {
      return NextResponse.json(
        {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Missing required fields: model, messages',
          },
        },
        { status: 400 }
      );
    }

    // 调用 CCR 路由器
    const response = await routeRequest(body);

    // 返回 Anthropic 格式响应
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json(
        {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: error.message,
          },
        },
        { status: error.statusCode }
      );
    }

    console.error('Non-stream request error:', error);
    return NextResponse.json(
      {
        type: 'error',
        error: {
          type: 'internal_error',
          message: 'Internal server error',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * 处理流式请求 (SSE)
 */
async function handleStreamRequest(request: NextRequest) {
  try {
    // 解析请求体
    const body = await request.json();

    // 验证请求格式
    if (!body.model || !body.messages) {
      return NextResponse.json(
        {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Missing required fields: model, messages',
          },
        },
        { status: 400 }
      );
    }

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          // 发送 message_start 事件
          const messageId = generateMessageId();
          controller.enqueue(encoder.encode(`event: message_start\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'message_start',
            message: {
              id: messageId,
              type: 'message',
              role: 'assistant',
              content: [],
              model: body.model,
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          })}\n\n`));

          // 发送 content_block_start 事件
          controller.enqueue(encoder.encode(`event: content_block_start\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'text',
              text: '',
            },
          })}\n\n`));

          // 调用 CCR 路由器流式处理
          await routeStreamRequest(
            body,
            // onChunk - 处理每个数据块
            (chunk) => {
              // 发送 content_block_delta 事件
              controller.enqueue(encoder.encode(`event: content_block_delta\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'content_block_delta',
                index: 0,
                delta: {
                  type: 'text_delta',
                  text: chunk.content || '',
                },
              })}\n\n`));

              // 发送 message_delta 事件
              controller.enqueue(encoder.encode(`event: message_delta\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'message_delta',
                delta: {
                  stop_reason: null,
                  stop_sequence: null,
                },
                usage: {
                  output_tokens: chunk.usage?.output_tokens || 0,
                },
              })}\n\n`));
            },
            // onError - 处理错误
            (error) => {
              console.error('Stream error:', error);
              controller.enqueue(encoder.encode(`event: error\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'error',
                error: {
                  type: 'internal_error',
                  message: error.message,
                },
              })}\n\n`));
              controller.close();
            },
            // onComplete - 完成流
            () => {
              // 发送 content_block_stop 事件
              controller.enqueue(encoder.encode(`event: content_block_stop\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'content_block_stop',
                index: 0,
              })}\n\n`));

              // 发送 message_delta 事件（停止）
              controller.enqueue(encoder.encode(`event: message_delta\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'message_delta',
                delta: {
                  stop_reason: 'end_turn',
                  stop_sequence: null,
                },
                usage: null,
              })}\n\n`));

              // 发送 message_stop 事件
              controller.enqueue(encoder.encode(`event: message_stop\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'message_stop',
              })}\n\n`));

              controller.close();
            }
          );
        } catch (error) {
          console.error('Stream setup error:', error);
          controller.enqueue(encoder.encode(`event: error\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: {
              type: 'internal_error',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
          })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Stream request error:', error);
    return NextResponse.json(
      {
        type: 'error',
        error: {
          type: 'internal_error',
          message: 'Internal server error',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * POST handler - 处理 Anthropic API 请求
 */
export async function POST(request: NextRequest) {
  // 验证认证
  if (!authenticate(request)) {
    return NextResponse.json(
      {
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'Invalid or missing API key',
        },
      },
      { status: 401 }
    );
  }

  try {
    // 解析请求体以判断是否为流式请求
    const body = await request.json();
    const isStream = body.stream === true;

    if (isStream) {
      return handleStreamRequest(request);
    } else {
      return handleNonStreamRequest(request);
    }
  } catch (error) {
    console.error('Request parsing error:', error);
    return NextResponse.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Invalid JSON in request body',
        },
      },
      { status: 400 }
    );
  }
}

/**
 * OPTIONS handler - 处理 CORS 预检请求
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
      'Access-Control-Max-Age': '86400',
    },
  });
}
