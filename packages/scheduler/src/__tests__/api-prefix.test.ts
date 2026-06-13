import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import { registerNodeRoutes } from '../routes/nodes.js';
import { registerPlatformRoutes } from '../routes/platform.js';
import { registerStreamRoutes } from '../routes/stream.js';
import { registerTaskRoutes } from '../routes/task.js';
import { registerWorkerRoutes } from '../routes/worker.js';

describe('CodeSwarm API prefix', () => {
  test('registers public scheduler APIs under /api/codeswarm', async () => {
    const server = Fastify({ logger: false });
    const dispatcher = {};

    registerWorkerRoutes(server, dispatcher);
    registerTaskRoutes(server, dispatcher);
    registerNodeRoutes(server);
    registerStreamRoutes(server);
    registerPlatformRoutes(server);

    await server.ready();

    expect(server.hasRoute({ method: 'POST', url: '/api/codeswarm/task/submit' })).toBe(true);
    expect(server.hasRoute({ method: 'GET', url: '/api/codeswarm/task/list' })).toBe(true);
    expect(server.hasRoute({ method: 'GET', url: '/api/codeswarm/task/:taskId/stream' })).toBe(true);
    expect(server.hasRoute({ method: 'POST', url: '/api/codeswarm/worker/heartbeat' })).toBe(true);
    expect(server.hasRoute({ method: 'POST', url: '/api/codeswarm/worker/event' })).toBe(true);
    expect(server.hasRoute({ method: 'POST', url: '/api/codeswarm/worker/result' })).toBe(true);
    expect(server.hasRoute({ method: 'GET', url: '/api/codeswarm/node/list' })).toBe(true);
    expect(server.hasRoute({ method: 'GET', url: '/api/codeswarm/platform/status' })).toBe(true);
    expect(server.hasRoute({ method: 'POST', url: '/api/task/submit' })).toBe(false);
    expect(server.hasRoute({ method: 'POST', url: '/api/worker/heartbeat' })).toBe(false);
    expect(server.hasRoute({ method: 'GET', url: '/api/node/list' })).toBe(false);
  });
});
