#!/usr/bin/env node
import { WorkerDaemon } from './daemon.js';

const DEFAULT_TASK_TIMEOUT_SEC = 7 * 24 * 3600; // 7 days default

const config = {
  nodeId: process.env.NODE_ID || `node-${Math.random().toString(36).slice(2, 10)}`,
  port: parseInt(process.env.PORT || '8080'),
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '5'),
  orchestratorUrl: process.env.ORCHESTRATOR_URL || 'http://localhost:3000',
  address: process.env.WORKER_ADDRESS || undefined,  // 可访问的外部地址
  taskTimeoutMs: parseInt(process.env.TASK_TIMEOUT_SEC || String(DEFAULT_TASK_TIMEOUT_SEC)) * 1000,
};

const daemon = new WorkerDaemon(config);
daemon.start().catch(err => {
  console.error('Worker daemon failed:', err);
  process.exit(1);
});

async function shutdown() {
  console.log('Shutting down worker...');
  await daemon.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { WorkerDaemon } from './daemon.js';
export { Semaphore } from './semaphore.js';
export { EnvironmentFactory } from './environment.js';
export { AgentRunner } from './agent-runner.js';
export { ProcessManager } from './process-manager.js';
export type { EnvironmentFactoryConfig } from './environment.js';
export type { AgentRunnerConfig, AgentRunnerEvents, AgentRunResult } from './agent-runner.js';
