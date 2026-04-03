import { prisma } from '@/lib/prisma';
import type { OpencodeClient } from '@opencode-ai/sdk';
import { spawn } from 'node:child_process';
import { getAvailablePort } from './port-manager';

// 动态导入 createOpencodeClient，避免编译错误
let createOpencodeClient: ((config?: { baseUrl: string }) => OpencodeClient) | null = null;

// 项目级 OpenCode 实例缓存
const projectInstances = new Map<string, {
  client: OpencodeClient;
  server: { url: string; port: number; close: () => void };
  refCount: number;
}>();

// 评估会话级 OpenCode 实例缓存（兼容旧代码）
const evaluationInstances = new Map<string, {
  client: OpencodeClient;
  server: { url: string; close: () => void };
}>();

// 获取 createOpencodeClient 函数
async function getCreateOpencodeClient() {
  if (!createOpencodeClient) {
    const sdk = await import('@opencode-ai/sdk');
    createOpencodeClient = sdk.createOpencodeClient;
  }
  return createOpencodeClient!;
}

/**
 * 创建 OpenCode 服务器实例（指定工作目录）
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

  console.log('[OpenCodeManager] Starting OpenCode server...');
  console.log('[OpenCodeManager]   command: opencode', args.join(' '));
  console.log('[OpenCodeManager]   working directory:', directory);
  console.log('[OpenCodeManager]   port:', port);

  // 启动服务器进程 - 关键：指定 cwd 为项目目录
  const proc = spawn('opencode', args, {
    cwd: directory,  // 关键：设置工作目录
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
            console.log('[OpenCodeManager] Server started at:', urlMatch[1]);
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

/**
 * 获取或创建项目级 OpenCode 客户端
 * 每个项目使用一个 OpenCode 实例，后续所有操作都基于这个实例
 */
export async function getOrCreateProjectClient(projectId: string): Promise<{
  client: OpencodeClient;
  server: { url: string; port: number; close: () => void };
}> {
  // 1. 检查缓存
  const cached = projectInstances.get(projectId);
  if (cached) {
    console.log('[OpenCodeManager] Using cached instance for project:', projectId);
    cached.refCount++;
    return { client: cached.client, server: cached.server };
  }

  // 2. 从数据库获取项目信息
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { config: true },
  });

  if (!project) {
    throw new Error('项目不存在');
  }

  if (!project.projectPath) {
    throw new Error('项目目录未配置');
  }

  // 3. 分配端口并启动 OpenCode 服务器
  console.log('[OpenCodeManager] Creating new instance for project:', projectId);
  console.log('[OpenCodeManager]   directory:', project.projectPath);
  console.log('[OpenCodeManager]   model:', project.config?.modelPreferences || 'openai/gpt-4');

  const port = await getAvailablePort();
  const server = await createOpencodeServer({
    port,
    directory: project.projectPath,
    config: { model: project.config?.modelPreferences || 'openai/gpt-4' },
  });

  console.log('[OpenCodeManager] Instance created at:', server.url);

  // 4. 创建客户端
  const createOpencodeClientFn = await getCreateOpencodeClient();
  const client = createOpencodeClientFn({ baseUrl: server.url });

  // 5. 缓存实例
  const instance = {
    client,
    server,
    refCount: 1,
  };
  projectInstances.set(projectId, instance);

  return instance;
}

/**
 * 释放项目级 OpenCode 客户端
 */
export function releaseProjectClient(projectId: string) {
  const instance = projectInstances.get(projectId);
  if (instance) {
    instance.refCount--;
    console.log('[OpenCodeManager] Instance ref count decreased for project:', projectId, 'count:', instance.refCount);
    
    if (instance.refCount <= 0) {
      console.log('[OpenCodeManager] Closing instance for project:', projectId);
      instance.server.close();
      projectInstances.delete(projectId);
    }
  }
}

/**
 * 获取或创建评估会话级 OpenCode 客户端（兼容旧代码）
 * 基于项目级实例，但使用评估会话 ID 作为缓存键
 */
export async function getOrCreateServer(evaluationId: string): Promise<{
  client: OpencodeClient;
  url: string;
  port: number;
  close: () => void;
}> {
  // 1. 检查评估会话级缓存
  const cached = evaluationInstances.get(evaluationId);
  if (cached) {
    console.log('[OpenCodeManager] Using cached instance for evaluation:', evaluationId);
    return {
      url: cached.server.url,
      port: parseInt(cached.server.url.split(':').pop() || '3000'),
      close: () => {}, // 不关闭，由项目级实例管理
      client: cached.client,
    };
  }

  // 2. 从数据库获取评估会话信息
  const evaluation = await prisma.evaluationSession.findUnique({
    where: { id: evaluationId },
    include: {
      project: {
        include: { config: true },
      },
    },
  });

  if (!evaluation) {
    throw new Error('评估会话不存在');
  }

  if (!evaluation.project.projectPath) {
    throw new Error('项目目录未配置');
  }

  // 3. 使用项目级实例
  const instance = await getOrCreateProjectClient(evaluation.projectId);

  // 4. 缓存到评估会话级（共享项目级实例）
  evaluationInstances.set(evaluationId, instance);

  return {
    url: instance.server.url,
    port: instance.server.port,
    close: () => {
      // 评估会话级不负责关闭，由项目级实例管理
      evaluationInstances.delete(evaluationId);
      releaseProjectClient(evaluation.projectId);
    },
    client: instance.client,
  };
}

/**
 * 关闭服务器实例（兼容旧代码）
 */
export function closeServer(evaluationId: string) {
  const instance = evaluationInstances.get(evaluationId);
  if (instance) {
    evaluationInstances.delete(evaluationId);
    // 实际关闭由项目级实例管理
  }
}

/**
 * 获取所有活跃的服务器（兼容旧代码）
 */
export function getActiveServers() {
  return Array.from(projectInstances.entries()).map(([id, instance]) => ({
    projectId: id,
    url: instance.server.url,
    refCount: instance.refCount,
  }));
}
