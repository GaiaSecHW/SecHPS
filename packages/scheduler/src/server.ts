/**
 * Fastify HTTP Server — Scheduler 入口
 * 注册所有路由 + 健康检查 + Prometheus 指标 + Debug UI 静态托管
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerWorkerRoutes } from './routes/worker.js';
import { registerTaskRoutes } from './routes/task.js';
import { registerNodeRoutes } from './routes/nodes.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { metrics } from './services/metrics.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SchedulerServerOptions {
  port: number;
  dispatcher: any; // Dispatcher instance — will be typed when dispatcher.ts is complete
}

export async function createServer(options: SchedulerServerOptions): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false, // Use our own logger
    bodyLimit: 50 * 1024 * 1024, // 50MB for large payloads
  });

  // CORS for platform proxy
  server.addHook('preHandler', (_req, reply, done) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') {
      return reply.send();
    }
    done();
  });

  // Health check
  server.get('/health', async () => {
    return {
      service: 'codeswarm-scheduler',
      status: 'running',
      port: options.port,
      uptime: process.uptime(),
    };
  });

  // Prometheus metrics
  server.get('/metrics', async (_req, reply) => {
    const content = await metrics.getMetrics();
    reply.header('Content-Type', metrics.contentType);
    return reply.send(content);
  });

  // Register route groups
  registerWorkerRoutes(server, options.dispatcher);
  registerTaskRoutes(server, options.dispatcher);
  registerNodeRoutes(server);
  registerStreamRoutes(server);
  registerPlatformRoutes(server);

  // Serve Debug UI static files (from debug-ui/dist)
  const debugUiDist = path.join(__dirname, '../../debug-ui/dist');
  try {
    await server.register(fastifyStatic, {
      root: debugUiDist,
      prefix: '/debug/',
      wildcard: false,
      decorateReply: false,
    });

    // SPA fallback: /debug/* non-file paths return index.html
    server.get('/debug/*', (_req, reply) => {
      return reply.type('text/html').sendFile('index.html');
    });

    logger.info(`[Server] Debug UI served from ${debugUiDist}`);
  } catch (err: any) {
    logger.warn(`[Server] Debug UI not found at ${debugUiDist} — skipping static serving (${err.message})`);
  }

  // Start listening
  await server.listen({ port: options.port, host: '0.0.0.0' });
  logger.info(`[Server] Scheduler listening on port ${options.port}`);

  return server;
}
