#!/usr/bin/env node
import { WorkerDaemon } from './daemon.js';

const config = {
  nodeId: process.env.NODE_ID || `node-${Math.random().toString(36).slice(2, 10)}`,
  port: parseInt(process.env.PORT || '8080'),
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '5'),
  orchestratorUrl: process.env.ORCHESTRATOR_URL || 'http://localhost:3000',
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
export type { EnvironmentFactoryConfig } from './environment.js';
