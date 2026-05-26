import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 终端会话类
 * 管理单个 PTY 进程与 WebSocket 的通信
 */
export class TerminalSession {
  private ptyProcess: pty.IPty;
  private ws: WebSocket;
  private sessionId: string;
  private isDisposed = false;

  constructor(cwd: string, ws: WebSocket, sessionId: string) {
    this.ws = ws;
    this.sessionId = sessionId;

    // 根据平台选择 shell
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    
    this.ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: cwd || process.cwd(),
      env: process.env as Record<string, string>,
    });

    // PTY 输出发送到 WebSocket
    this.ptyProcess.onData((data) => {
      if (!this.isDisposed && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    // PTY 退出时关闭 WebSocket
    this.ptyProcess.onExit(({ exitCode }) => {
      if (!this.isDisposed && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode }));
        ws.close();
      }
    });

    logger.info(LOG_MODULES.SESSION, 'Session created', { details: { sessionId, cwd } });
  }

  /**
   * 处理来自 WebSocket 的消息
   */
  handleMessage(message: string): void {
    if (this.isDisposed) return;

    try {
      const msg = JSON.parse(message);
      
      switch (msg.type) {
        case 'input':
          this.ptyProcess.write(msg.data);
          break;
        case 'resize':
          if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
            this.ptyProcess.resize(msg.cols, msg.rows);
          }
          break;
        default:
          logger.warn(LOG_MODULES.SESSION, 'Unknown message type', { details: { type: msg.type } });
      }
    } catch (error) {
      logger.error(LOG_MODULES.SESSION, 'Error parsing message', { details: { error: error instanceof Error ? error.message : String(error) } });
    }
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 释放终端会话
   */
  dispose(): void {
    if (this.isDisposed) return;
    
    this.isDisposed = true;
    
    try {
      this.ptyProcess.kill();
    } catch (error) {
      logger.error(LOG_MODULES.SESSION, 'Error killing PTY process', { details: { error: error instanceof Error ? error.message : String(error) } });
    }

    logger.info(LOG_MODULES.SESSION, 'Session disposed', { details: { sessionId: this.sessionId } });
  }
}

/**
 * 终端管理器
 * 管理所有终端会话
 */
export class TerminalManager {
  private sessions: Map<string, TerminalSession> = new Map();

  /**
   * 创建新的终端会话
   */
  createSession(cwd: string, ws: WebSocket, sessionId: string): TerminalSession {
    // 如果已存在相同 ID 的会话，先释放它
    const existingSession = this.sessions.get(sessionId);
    if (existingSession) {
      existingSession.dispose();
      this.sessions.delete(sessionId);
    }

    const session = new TerminalSession(cwd, ws, sessionId);
    this.sessions.set(sessionId, session);

    // WebSocket 关闭时清理会话
    ws.on('close', () => {
      this.disposeSession(sessionId);
    });

    // WebSocket 错误处理
    ws.on('error', (error) => {
      logger.error(LOG_MODULES.SESSION, 'WebSocket error for session', { details: { sessionId, error: error instanceof Error ? error.message : String(error) } });
      this.disposeSession(sessionId);
    });

    // 接收 WebSocket 消息
    ws.on('message', (data) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.handleMessage(data.toString());
      }
    });

    return session;
  }

  /**
   * 获取终端会话
   */
  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 释放终端会话
   */
  disposeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.dispose();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * 释放所有终端会话
   */
  disposeAll(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    logger.info(LOG_MODULES.SESSION, 'All sessions disposed');
  }

  /**
   * 获取活跃会话数量
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 获取所有会话 ID
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}

// 导出单例
export const terminalManager = new TerminalManager();
