import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { spawn } from 'node:child_process';
import { getAvailablePort } from '@/lib/port-manager';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * 创建临时 OpenCode 服务器实例
 */
async function createTempOpencodeServer(port: number): Promise<{ url: string; close: () => void }> {
  // 创建临时工作目录
  const tempDir = join(tmpdir(), `opencode-temp-${Date.now()}`);
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  console.log('[TempServer] Creating temporary OpenCode server...');
  console.log('[TempServer]   port:', port);
  console.log('[TempServer]   tempDir:', tempDir);

  // 启动服务器进程
  const proc = spawn('opencode', ['serve', `--port=${port}`, `--hostname=127.0.0.1`], {
    cwd: tempDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // 等待服务器启动
  const url = await new Promise<string>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      proc.kill();
      rmSync(tempDir, { recursive: true, force: true });
      reject(new Error('Timeout waiting for temporary server'));
    }, 15000);

    let output = '';
    let resolved = false;

    const checkOutput = (chunk: string) => {
      if (resolved) return;
      output += chunk;
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes('listening') || line.includes('http')) {
          const urlMatch = line.match(/(https?:\/\/[^\s\x00-\x1F]+)/);
          if (urlMatch) {
            resolved = true;
            clearTimeout(timeoutId);
            console.log('[TempServer] Server started at:', urlMatch[1]);
            resolve(urlMatch[1]);
            return;
          }
        }
      }
    };

    proc.stdout?.on('data', (chunk) => checkOutput(chunk.toString()));
    proc.stderr?.on('data', (chunk) => checkOutput(chunk.toString()));

    proc.on('exit', (code, signal) => {
      if (!resolved) {
        clearTimeout(timeoutId);
        rmSync(tempDir, { recursive: true, force: true });
        reject(new Error(`Server exited: code=${code}, signal=${signal}`));
      }
    });

    proc.on('error', (error) => {
      if (!resolved) {
        clearTimeout(timeoutId);
        rmSync(tempDir, { recursive: true, force: true });
        reject(error);
      }
    });
  });

  return {
    url,
    close: () => {
      console.log('[TempServer] Closing temporary server...');
      proc.kill();
      // 清理临时目录
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn('[TempServer] Failed to clean temp directory:', error);
      }
    },
  };
}

// 获取 OpenCode 可用的模型提供商列表
export async function GET(request: Request) {
  let tempServer: { url: string; close: () => void } | null = null;

  try {
    // 验证 Token
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
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 创建临时 OpenCode 服务器
    console.log('[Providers] Creating temporary OpenCode server...');
    const port = await getAvailablePort();
    tempServer = await createTempOpencodeServer(port);

    // 初始化 OpenCode SDK
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: tempServer.url });

    // 获取可用的提供商和模型
    console.log('[Providers] Fetching providers from:', tempServer.url);
    const result = await client.provider.list();
    console.log('[Providers] Providers response:', JSON.stringify(result, null, 2));

    if (result.error) {
      console.error('Get providers error:', result.error);
      return NextResponse.json({ error: '获取提供商失败', details: result.error }, { status: 500 });
    }

    const providersData = result.data;

    // 转换为前端友好的格式
    const providers = providersData?.all?.map((provider: any) => ({
      id: provider.id,
      name: provider.name,
      models: Object.entries(provider.models || {}).map(([modelId, model]: [string, any]) => ({
        id: modelId,
        name: model.name,
        contextLimit: model.limit?.context,
        outputLimit: model.limit?.output,
        supportsAttachment: model.attachment,
        supportsReasoning: model.reasoning,
        supportsTemperature: model.temperature,
        supportsToolCall: model.tool_call,
        cost: model.cost,
      })),
    })) || [];

    return NextResponse.json({
      default: providersData?.default || {},
      providers,
    });
  } catch (error) {
    console.error('Get providers error:', error);
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    // 确保临时服务器被关闭
    if (tempServer) {
      tempServer.close();
    }
  }
}
