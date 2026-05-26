import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { terminalManager } from '@/services/terminal-manager';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

let wss: WebSocketServer | null = null;

export interface TerminalWebSocketQuery {
  token: string;
  cwd: string;
  sessionId: string;
}

/**
 * 从请求 URL 中解析查询参数
 */
function parseQueryParams(url: string): TerminalWebSocketQuery | null {
  try {
    const urlObj = new URL(url, 'http://localhost');
    const token = urlObj.searchParams.get('token');
    const cwd = urlObj.searchParams.get('cwd');
    const sessionId = urlObj.searchParams.get('sessionId');

    if (!token) {
      return null;
    }

    return {
      token,
      cwd: cwd || process.cwd(),
      sessionId: sessionId || crypto.randomUUID(),
    };
  } catch (error) {
    logger.error(LOG_MODULES.WEBSOCKET, 'Error parsing query params', { details: { error: error instanceof Error ? error.message : String(error) } });
    return null;
  }
}

/**
 * 验证 WebSocket 连接
 */
function validateConnection(query: TerminalWebSocketQuery): boolean {
  const payload = verifyToken(query.token);
  if (!payload) {
    logger.warn(LOG_MODULES.WEBSOCKET, 'Invalid or expired token');
    return false;
  }
  return true;
}

/**
 * 初始化 WebSocket 服务器
 */
export function initWebSocketServer(server: import('http').Server): WebSocketServer {
  if (wss) {
    return wss;
  }

  wss = new WebSocketServer({ 
    server, 
    path: '/ws/terminal',
    perMessageDeflate: false, // 禁用压缩以提高性能
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // 解析查询参数
    const queryParams = parseQueryParams(req.url || '');
    
    if (!queryParams) {
      ws.close(1008, 'Missing required parameters');
      return;
    }

    // 验证 token
    if (!validateConnection(queryParams)) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    const { cwd, sessionId } = queryParams;

    // 发送连接成功消息
    ws.send(JSON.stringify({ 
      type: 'connected', 
      sessionId,
      cwd,
    }));

    // 创建终端会话
    terminalManager.createSession(cwd, ws, sessionId);
  });

  wss.on('error', (error) => {
    logger.error(LOG_MODULES.WEBSOCKET, 'Server error', { details: { error: error instanceof Error ? error.message : String(error) } });
  });

  logger.info(LOG_MODULES.WEBSOCKET, 'Server initialized at /ws/terminal');
  return wss;
}

/**
 * 获取 WebSocket 服务器实例
 */
export function getWebSocketServer(): WebSocketServer | null {
  return wss;
}

/**
 * 关闭 WebSocket 服务器
 */
export function closeWebSocketServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!wss) {
      resolve();
      return;
    }

    // 先清理所有终端会话
    terminalManager.disposeAll();

    wss.close((error) => {
      if (error) {
        logger.error(LOG_MODULES.WEBSOCKET, 'Error closing server', { details: { error: error instanceof Error ? error.message : String(error) } });
        reject(error);
      } else {
        wss = null;
        logger.info(LOG_MODULES.WEBSOCKET, 'Server closed');
        resolve();
      }
    });
  });
}
