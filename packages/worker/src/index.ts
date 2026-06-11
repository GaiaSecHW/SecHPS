#!/usr/bin/env node
import { WorkerDaemon } from './daemon.js';
import { logger, LOG_MODULES } from './logger.js';

const DEFAULT_TASK_TIMEOUT_SEC = 7 * 24 * 3600; // 7 days default

const config = {
  nodeId: process.env.NODE_ID || `node-${Math.random().toString(36).slice(2, 10)}`,
  port: parseInt(process.env.PORT || '8080'),
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '5'),
  schedulerUrl: process.env.SCHEDULER_URL || 'http://localhost:8080',
  address: process.env.WORKER_ADDRESS || undefined,
  workerToken: process.env.WORKER_TOKEN || undefined,
  taskTimeoutMs: parseInt(process.env.TASK_TIMEOUT_SEC || String(DEFAULT_TASK_TIMEOUT_SEC)) * 1000,
  gracefulShutdownTimeoutMs: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || '300000'),
};

const daemon = new WorkerDaemon(config);

daemon.start().catch(err => {
  logger.error(LOG_MODULES.DAEMON, 'Worker daemon failed', err);
  process.exit(1);
});

async function shutdown() {
  logger.info(LOG_MODULES.DAEMON, 'Shutting down worker...');
  await daemon.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('unhandledRejection', (reason) => {
  logger.error(LOG_MODULES.DAEMON, 'Unhandled promise rejection', reason);
});

process.on('uncaughtException', (err) => {
  logger.error(LOG_MODULES.DAEMON, 'Uncaught exception', err);
  shutdown().catch(() => process.exit(1));
});

export { WorkerDaemon } from './daemon.js';
export { Semaphore } from './semaphore.js';
export { EnvironmentFactory } from './environment.js';
export { ProcessManager } from './process-manager.js';
export type { EnvironmentFactoryConfig } from './environment.js';
