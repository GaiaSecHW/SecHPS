/**
 * 自定义服务器入口
 * 支持 WebSocket 连接用于终端功能
 */

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { initWebSocketServer, closeWebSocketServer } from './src/lib/websocket-server';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// 创建 Next.js 应用
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// 优雅关闭处理
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);
  
  try {
    await closeWebSocketServer();
    console.log('[Server] WebSocket server closed');
  } catch (error) {
    console.error('[Server] Error closing WebSocket server:', error);
  }
  
  process.exit(0);
}

// 注册关闭信号处理
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // 初始化 WebSocket 服务器
  initWebSocketServer(server);

  server.listen(port, () => {
    console.log(`
  ╭─────────────────────────────────────────────────────────╮
  │                                                         │
  │   🚀 AI4WEB Test Platform Server                        │
  │                                                         │
  │   Local:    http://localhost:${port}                      │
  │   Network:  http://${hostname}:${port}                     │
  │                                                         │
  │   WebSocket: ws://localhost:${port}/ws/terminal          │
  │                                                         │
  │   Press Ctrl+C to stop                                  │
  │                                                         │
  ╰─────────────────────────────────────────────────────────╯
    `);
  });

  server.on('error', (error) => {
    console.error('[Server] HTTP server error:', error);
    process.exit(1);
  });
}).catch((error) => {
  console.error('[Server] Failed to start:', error);
  process.exit(1);
});
