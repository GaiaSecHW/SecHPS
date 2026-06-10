/**
 * 平台回调接口（占位 — 接收平台侧调用，目前不需要）
 * 平台回调由 Worker result 路由中直接处理（HTTP POST 到 platformCallbackUrl）
 */
import type { FastifyInstance } from 'fastify';

export function registerPlatformRoutes(server: FastifyInstance): void {
  // 预留：未来可用于平台主动查询 Scheduler 状态
  server.get('/api/platform/status', async () => {
    return {
      service: 'codeswarm-scheduler',
      version: '0.1.0',
      status: 'running',
    };
  });
}
