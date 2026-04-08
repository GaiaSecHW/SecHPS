"use strict";
/**
 * 自定义服务器入口
 * 支持 WebSocket 连接用于终端功能
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const url_1 = require("url");
const next_1 = __importDefault(require("next"));
const websocket_server_1 = require("./src/lib/websocket-server");
const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);
// 创建 Next.js 应用
const app = (0, next_1.default)({ dev, hostname, port });
const handle = app.getRequestHandler();
// 优雅关闭处理
let isShuttingDown = false;
async function shutdown(signal) {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);
    try {
        await (0, websocket_server_1.closeWebSocketServer)();
        console.log('[Server] WebSocket server closed');
    }
    catch (error) {
        console.error('[Server] Error closing WebSocket server:', error);
    }
    process.exit(0);
}
// 注册关闭信号处理
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
app.prepare().then(() => {
    const server = (0, http_1.createServer)((req, res) => {
        const parsedUrl = (0, url_1.parse)(req.url, true);
        handle(req, res, parsedUrl);
    });
    // 初始化 WebSocket 服务器
    (0, websocket_server_1.initWebSocketServer)(server);
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
