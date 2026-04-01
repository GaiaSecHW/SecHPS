import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getAvailablePort } from '@/lib/port-manager';
import { spawn } from 'node:child_process';

// 存储活跃的 OpenCode 服务器实例（内存缓存）
const activeServers = new Map<string, { url: string; port: number; close: () => void }>();

/**
 * 创建 OpenCode 服务器实例（指定工作目录）
 */
async function createOpencodeServer(options: {
  hostname?: string;
  port: number;
  timeout?: number;
  directory: string;
  config?: any;
}): Promise<{ url: string; port: number; close: () => void }> {
  const { hostname = '127.0.0.1', port, timeout = 15000, directory, config = {} } = options;
  
  // 构建命令参数
  const args = ['serve', `--hostname=${hostname}`, `--port=${port}`];
  if (config?.logLevel) {
    args.push(`--log-level=${config.logLevel}`);
  }
  
  console.log('[SDK] Starting OpenCode server...');
  console.log('[SDK]   command: opencode', args.join(' '));
  console.log('[SDK]   working directory:', directory);
  console.log('[SDK]   port:', port);
  
  // 启动服务器进程 - 关键：指定 cwd 为项目目录
  const proc = spawn('opencode', args, {
    cwd: directory,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  
  // 等待服务器启动
  const url = await new Promise<string>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      proc.kill();
      reject(new Error(`Timeout waiting for server after ${timeout}ms`));
    }, timeout);
    
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
            console.log('[SDK] Server started at:', urlMatch[1]);
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
        reject(new Error(`Server exited: code=${code}, signal=${signal}`));
      }
    });
    
    proc.on('error', (error) => {
      if (!resolved) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  });
  
  return {
    url,
    port,
    close: () => proc.kill(),
  };
}

// 启动项目评估
export async function POST(
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

    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const project = await prisma.project.findUnique({
      where: { id },
      include: { config: true },
    });

    if (!project || project.userId !== payload.userId) {
      return NextResponse.json({ error: '未找到项目' }, { status: 404 });
    }

    if (!project.projectPath) {
      return NextResponse.json({ error: '项目目录未配置' }, { status: 400 });
    }

    // 获取模型配置
    const modelStr = project.config!.modelPreferences || 'openai/gpt-4';

    // 分配随机端口（10000-60000）
    console.log('[SDK] Allocating random port for OpenCode server...');
    const port = await getAvailablePort();
    console.log('[SDK] Allocated port:', port);

    // 启动 OpenCode 服务器（在项目目录下）
    console.log('[SDK] Starting OpenCode server...');
    console.log('[SDK]   directory:', project.projectPath);
    console.log('[SDK]   port:', port);
    console.log('[SDK]   model:', modelStr);
    
    const server = await createOpencodeServer({
      port,
      directory: project.projectPath,
      config: { model: modelStr },
    });
    
    // 创建客户端
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ 
      baseUrl: server.url 
    });

    // 创建会话
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN').replace(/\//g, '-').replace(/:/g, '-');
    
    const sessionResult = await client.session.create({
      body: { title: `${project.name} ${timeStr}` }
    });
    
    if (sessionResult.error) {
      server.close();
      return NextResponse.json({ 
        error: '创建会话失败', 
        details: sessionResult.error 
      }, { status: 500 });
    }
    
    const sessionId = sessionResult.data.id;
    console.log('[SDK] Session created:', sessionId);

    // 创建评估记录（保存端口号）
    const evaluation = await prisma.evaluationSession.create({
      data: {
        projectId: project.id,
        opencodeSessionId: sessionId,
        port: server.port,
        status: 'running',
      },
    });

    // 缓存服务器实例
    activeServers.set(evaluation.id, server);

    // 发送任务描述
    if (project.config!.taskDescription) {
      const [providerID, modelID] = modelStr.split('/');
      
      const promptResult = await client.session.prompt({
        path: { id: sessionId },
        body: {
          model: { providerID: providerID || 'openai', modelID: modelID || 'gpt-4' },
          parts: [{ type: 'text' as const, text: project.config!.taskDescription }],
        },
      });
      
      if (promptResult.error) {
        server.close();
        activeServers.delete(evaluation.id);
        try { await client.session.delete({ path: { id: sessionId } }); } catch {}
        await prisma.evaluationSession.delete({ where: { id: evaluation.id } });
        return NextResponse.json({ error: '发送任务描述失败' }, { status: 500 });
      }
    }

    // 更新项目状态
    await prisma.project.update({
      where: { id },
      data: { status: 'running' },
    });

    return NextResponse.json({
      message: '评估启动成功',
      evaluation: {
        id: evaluation.id,
        opencodeSessionId: sessionId,
        port: server.port,
        status: evaluation.status,
        startedAt: evaluation.startedAt,
      },
    });
  } catch (error) {
    console.error('Start evaluation error:', error);
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
