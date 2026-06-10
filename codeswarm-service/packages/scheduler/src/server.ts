/**
 * Fastify HTTP Server — Scheduler 入口
 * 注册所有路由 + 健康检查 + Prometheus 指标
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { registerWorkerRoutes } from './routes/worker.js';
import { registerTaskRoutes } from './routes/task.js';
import { registerNodeRoutes } from './routes/nodes.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { metrics } from './services/metrics.js';
import { logger } from './logger.js';

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

  // Start listening
  await server.listen({ port: options.port, host: '0.0.0.0' });
  logger.info(`[Server] Scheduler listening on port ${options.port}`);

  return server;
}
