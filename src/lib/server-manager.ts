import { spawn } from 'node:child_process';
import { prisma } from '@/lib/prisma';
import { getAvailablePort } from './port-manager';

// 存储活跃的 OpenCode 服务器实例（内存缓存）- 评估会话级
const activeServers = new Map<string, { url: string; port: number; close: () => void }>();

// 存储项目级 OpenCode 服务器实例（共享）- 项目级
const projectServers = new Map<string, { url: string; port: number; close: () => void; refCount: number }>();

// 服务器重启锁，防止并发重启
const restartLocks = new Map<string, Promise<{ url: string; port: number }>>();

/**
 * 检查端口是否可用（通过尝试连接）
 */
async function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);
    
    socket.connect(port, '127.0.0.1', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });
    
    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * 创建 OpenCode 服务器实例
 */
async function createOpencodeServer(options: {
  port: number;
  directory: string;
  config?: any;
}): Promise<{ url: string; port: number; close: () => void }> {
  const { port, directory, config = {} } = options;
  
  // 构建命令参数
  const args = ['serve', '--hostname=127.0.0.1', `--port=${port}`];
  if (config?.logLevel) {
    args.push(`--log-level=${config.logLevel}`);
  }
  
  console.log('[ServerManager] Starting OpenCode server...');
  console.log('[ServerManager]   command: opencode', args.join(' '));
  console.log('[ServerManager]   working directory:', directory);
  console.log('[ServerManager]   port:', port);
  
  // 启动服务器进程
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
      reject(new Error(`Timeout waiting for server on port ${port}`));
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
            console.log('[ServerManager] Server started at:', urlMatch[1]);
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
    close: () => {
      console.log('[ServerManager] Closing server on port', port);
      proc.kill();
    },
  };
}

/**
 * 获取或重启 OpenCode 服务器
 * 如果服务器已停止，自动重新启动
 */
export async function getOrCreateServer(evaluationId: string): Promise<{ url: string; port: number }> {
  // 1. 检查内存缓存
  const cachedServer = activeServers.get(evaluationId);
  if (cachedServer) {
    // 检查端口是否仍然可用
    const available = await checkPortAvailable(cachedServer.port);
    if (available) {
      console.log('[ServerManager] Using cached server on port', cachedServer.port);
      return { url: cachedServer.url, port: cachedServer.port };
    } else {
      console.log('[ServerManager] Cached server port not available, removing from cache');
      activeServers.delete(evaluationId);
    }
  }

  // 2. 检查是否有正在进行的重启操作（防止并发）
  const ongoingRestart = restartLocks.get(evaluationId);
  if (ongoingRestart) {
    console.log('[ServerManager] Waiting for ongoing restart for evaluation', evaluationId);
    return ongoingRestart;
  }

  // 3. 从数据库获取评估会话信息
  const evaluation = await prisma.evaluationSession.findUnique({
    where: { id: evaluationId },
    include: {
      project: {
        include: {
          config: true,
        },
      },
    },
  });

  if (!evaluation) {
    throw new Error('评估会话不存在');
  }

  if (!evaluation.project.projectPath) {
    throw new Error('项目目录未配置');
  }

  // 4. 检查数据库中保存的端口是否可用
  if (evaluation.port) {
    const available = await checkPortAvailable(evaluation.port);
    if (available) {
      console.log('[ServerManager] Database port still available:', evaluation.port);
      const url = `http://127.0.0.1:${evaluation.port}`;
      // 不缓存，因为不知道进程是否真的是我们的
      return { url, port: evaluation.port };
    }
  }

  // 5. 端口不可用，需要重启服务器
  console.log('[ServerManager] Port not available, restarting server...');

  // 创建重启 Promise 并加锁
  const restartPromise = (async () => {
    try {
      // 分配新端口
      const newPort = await getAvailablePort();
      console.log('[ServerManager] Allocated new port:', newPort);

      // 获取模型配置
      const modelStr = evaluation.project.config?.modelPreferences || 'openai/gpt-4';

      // 创建新服务器
      const server = await createOpencodeServer({
        port: newPort,
        directory: evaluation.project.projectPath,
        config: { model: modelStr },
      });

      // 更新数据库
      await prisma.evaluationSession.update({
        where: { id: evaluationId },
        data: { port: newPort },
      });

      // 缓存服务器实例
      activeServers.set(evaluationId, server);

      console.log('[ServerManager] Server restarted successfully on port', newPort);
      return { url: server.url, port: server.port };
    } finally {
      // 移除锁
      restartLocks.delete(evaluationId);
    }
  })();

  // 加锁
  restartLocks.set(evaluationId, restartPromise);

  return restartPromise;
}

/**
 * 关闭服务器实例
 */
export function closeServer(evaluationId: string) {
  const server = activeServers.get(evaluationId);
  if (server) {
    server.close();
    activeServers.delete(evaluationId);
    console.log('[ServerManager] Server closed for evaluation', evaluationId);
  }
}

/**
 * 获取或创建项目级 OpenCode 服务器（共享实例）
 * 同一项目的多个评估会话共享一个服务器实例
 */
export async function getOrCreateProjectServer(projectId: string): Promise<{ url: string; port: number }> {
  // 1. 检查项目级服务器缓存
  const cachedServer = projectServers.get(projectId);
  if (cachedServer) {
    // 检查端口是否仍然可用
    const available = await checkPortAvailable(cachedServer.port);
    if (available) {
      console.log('[ServerManager] Using cached project server on port', cachedServer.port);
      cachedServer.refCount++;
      return { url: cachedServer.url, port: cachedServer.port };
    } else {
      console.log('[ServerManager] Cached project server port not available, removing from cache');
      projectServers.delete(projectId);
    }
  }

  // 2. 检查是否有正在进行的重启操作（防止并发）
  const ongoingRestart = restartLocks.get(`project:${projectId}`);
  if (ongoingRestart) {
    console.log('[ServerManager] Waiting for ongoing project server restart for project', projectId);
    return ongoingRestart;
  }

  // 3. 从数据库获取项目信息
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      config: true,
    },
  });

  if (!project) {
    throw new Error('项目不存在');
  }

  if (!project.projectPath) {
    throw new Error('项目目录未配置');
  }

  // 4. 检查是否有运行中的评估会话（获取端口）
  const runningEvaluation = await prisma.evaluationSession.findFirst({
    where: {
      projectId: projectId,
      status: 'running',
    },
    orderBy: {
      startedAt: 'desc',
    },
  });

  if (runningEvaluation?.port) {
    const available = await checkPortAvailable(runningEvaluation.port);
    if (available) {
      console.log('[ServerManager] Using running evaluation port:', runningEvaluation.port);
      const url = `http://127.0.0.1:${runningEvaluation.port}`;
      // 缓存项目级服务器
      projectServers.set(projectId, { url, port: runningEvaluation.port, close: () => {}, refCount: 1 });
      return { url, port: runningEvaluation.port };
    }
  }

  // 5. 端口不可用，需要启动新服务器
  console.log('[ServerManager] No available port, starting new project server...');

  // 创建重启 Promise 并加锁
  const restartPromise = (async () => {
    try {
      // 分配新端口
      const newPort = await getAvailablePort();
      console.log('[ServerManager] Allocated new port for project:', projectId, 'port:', newPort);

      // 获取模型配置
      const modelStr = project.config?.modelPreferences || 'openai/gpt-4';

      // 创建新服务器
      const server = await createOpencodeServer({
        port: newPort,
        directory: project.projectPath,
        config: { { model: modelStr } },
      });

      // 缓存项目级服务器实例
      projectServers.set(projectId, { ...server, refCount: 1 });

      console.log('[ServerManager] Project server started successfully on port', newPort);
      return { url: server.url, port: server.port };
    } finally {
      // 移除锁
      restartLocks.delete(`project:${projectId}`);
    }
  })();

  // 加锁
  restartLocks.set(`project:${projectId}`, restartPromise);

  return restartPromise;
}

/**
 * 释放项目级服务器实例（引用计数）
 */
export function releaseProjectServer(projectId: string) {
  const server = projectServers.get(projectId);
  if (server) {
    server.refCount--;
    if (server.refCount <= 0) {
      server.close();
      projectServers.delete(projectId);
      console.log('[ServerManager] Project server closed for project', projectId);
    } else {
      console.log('[ServerManager] Project server ref count decreased for project', projectId, 'count:', server.refCount);
    }
  }
}

/**
 * 获取所有活跃的服务器
 */
export function getActiveServers() {
  return Array.from(activeServers.entries()).map(([id, server]) => ({
    evaluationId: id,
    port: server.port,
    url: server.url,
  }));
}
