// src/app/api/mcp-servers/test/route.ts
// MCP 服务器测试 API - 验证连通性并获取工具列表

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// POST /api/mcp-servers/test - 测试 MCP 服务器连接
export async function POST(request: Request) {
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

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const body = await request.json();
    const { type, command, args, url, env } = body;

    console.log('[MCP Test] 测试 MCP 服务器:', { type, command, url });

    // 根据类型测试连接
    if (type === 'remote') {
      return await testRemoteServer(url, env);
    } else if (type === 'local') {
      return await testLocalServer(command, args, env);
    } else {
      return NextResponse.json(
        { error: '不支持的 MCP 服务器类型' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[MCP Test] 测试失败:', error);
    return NextResponse.json(
      { 
        error: '测试失败', 
        details: error instanceof Error ? error.message : '未知错误' 
      },
      { status: 500 }
    );
  }
}

// 测试远程 MCP 服务器 (SSE)
async function testRemoteServer(url: string, env?: any) {
  if (!url) {
    return NextResponse.json(
      { error: '远程服务器必须提供 URL' },
      { status: 400 }
    );
  }

  try {
    // 验证 URL 格式
    const parsedUrl = new URL(url);
    console.log('[MCP Test] 测试远程服务器:', parsedUrl.href);

    // 尝试连接到 SSE 端点
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10秒超时

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        connected: false,
        error: `服务器返回错误: ${response.status} ${response.statusText}`,
      });
    }

    // 对于 SSE，我们只需要确认连接成功
    // 获取工具列表需要完整的 MCP 协议实现
    return NextResponse.json({
      success: true,
      connected: true,
      message: '成功连接到 MCP 服务器',
      server: {
        type: 'remote',
        url: url,
      },
      tools: [], // 需要完整的 MCP 客户端实现才能获取工具列表
      note: '连接成功。获取工具列表需要完整的 MCP 客户端实现。',
    });
  } catch (error) {
    console.error('[MCP Test] 远程服务器测试失败:', error);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return NextResponse.json({
          success: false,
          connected: false,
          error: '连接超时（10秒）',
        });
      }
      
      return NextResponse.json({
        success: false,
        connected: false,
        error: `连接失败: ${error.message}`,
      });
    }

    return NextResponse.json({
      success: false,
      connected: false,
      error: '连接失败: 未知错误',
    });
  }
}

// 测试本地 MCP 服务器
async function testLocalServer(command: string, args?: any, env?: any) {
  if (!command) {
    return NextResponse.json(
      { error: '本地服务器必须提供命令' },
      { status: 400 }
    );
  }

  // 本地服务器测试需要实际执行命令
  // 这里只做基本验证
  return NextResponse.json({
    success: true,
    connected: false, // 本地服务器需要在实际运行时测试
    message: '本地 MCP 服务器配置已验证',
    server: {
      type: 'local',
      command: command,
      args: args,
    },
    tools: [],
    note: '本地 MCP 服务器需要在实际运行时测试连接和获取工具列表。',
  });
}
