#!/usr/bin/env node
/**
 * @codeswarm/scheduler — Scheduler 微服务入口
 * 启动 Fastify HTTP server + 初始化 Dispatcher
 */
import { createServer } from './server.js';
import { CodeswarmDispatcher as Dispatcher } from './dispatcher.js';
import { logger } from './logger.js';
import { cleanupExpiredWorkspaces } from './services/workspace.js';

const PORT = parseInt(process.env.PORT || '8080');

async function main(): Promise<void> {
  logger.info('[Scheduler] Starting...');

  // Initialize Dispatcher
  const dispatcher = new Dispatcher();
  await dispatcher.init();
  logger.info('[Dispatcher] Initialized');

  // Create HTTP server
  const server = await createServer({
    port: PORT,
    dispatcher,
  });

  // Periodic workspace cleanup (every 24 hours)
  setInterval(async () => {
    try {
      const cleaned = await cleanupExpiredWorkspaces();
      if (cleaned > 0) {
        logger.info(`[Workspace] Cleaned ${cleaned} expired workspaces`);
      }
    } catch (err) {
      logger.error(`[Workspace] Cleanup error: ${err}`);
    }
  }, 24 * 60 * 60 * 1000);

  // Graceful shutdown
  async function shutdown() {
    logger.info('[Scheduler] Shutting down...');
    await dispatcher.destroy();
    await server.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.on('unhandledRejection', (reason) => {
    logger.error(`[Scheduler] Unhandled rejection: ${reason}`);
  });

  process.on('uncaughtException', (err) => {
    logger.error(`[Scheduler] Uncaught exception: ${err}`);
    shutdown().catch(() => process.exit(1));
  });

  logger.info(`[Scheduler] Ready on port ${PORT}`);
}

main().catch((err) => {
  logger.error(`[Scheduler] Fatal: ${err}`);
  process.exit(1);
});
