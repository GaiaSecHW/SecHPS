'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

interface TerminalComponentProps {
  sessionId: string;
  cwd: string;
  token: string;
  onDisconnect?: () => void;
  onConnected?: () => void;
  onError?: (error: string) => void;
  className?: string;
}

/**
 * 终端组件
 * 基于 xterm.js 的终端模拟器，通过 WebSocket 连接到服务器端的 PTY
 */
export default function TerminalComponent({
  sessionId,
  cwd,
  token,
  onDisconnect,
  onConnected,
  onError,
  className = '',
}: TerminalComponentProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  /**
   * 处理终端大小调整
   */
  const handleResize = useCallback(() => {
    if (terminalInstance.current && fitAddonRef.current) {
      try {
        fitAddonRef.current.fit();
        
        // 通知服务器终端大小变化
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'resize',
            cols: terminalInstance.current.cols,
            rows: terminalInstance.current.rows,
          }));
        }
      } catch (error) {
        console.error('[Terminal] Error resizing:', error);
      }
    }
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    // 创建终端实例
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      letterSpacing: 0,
      scrollback: 10000,
      allowProposedApi: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        selectionForeground: '#d4d4d4',
        // ANSI 颜色
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
    });

    // 加载 Fit 插件
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // 尝试加载 WebGL 渲染器（提升性能）
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL 不可用，使用 Canvas 回退
      console.log('[Terminal] WebGL not available, using canvas fallback');
    }

    // 打开终端
    terminal.open(terminalRef.current);
    
    // 等待一帧后调整大小
    requestAnimationFrame(() => {
      fitAddon.fit();
    });
    
    terminalInstance.current = terminal;

    // 连接 WebSocket
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/terminal?token=${encodeURIComponent(token)}&cwd=${encodeURIComponent(cwd)}&sessionId=${encodeURIComponent(sessionId)}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      terminal.writeln('\x1b[32m✓ Terminal connected\x1b[0m');
      terminal.writeln(`\x1b[36mWorking directory: ${cwd}\x1b[0m`);
      terminal.writeln('');
      onConnected?.();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        switch (msg.type) {
          case 'output':
            terminal.write(msg.data);
            break;
          case 'exit':
            terminal.writeln('');
            terminal.writeln(`\x1b[33mProcess exited with code ${msg.exitCode}\x1b[0m`);
            terminal.writeln('\x1b[36mPress any key to reconnect or close the terminal.\x1b[0m');
            onDisconnect?.();
            break;
          case 'connected':
            // 连接确认消息，终端已初始化
            break;
          default:
            console.warn('[Terminal] Unknown message type:', msg.type);
        }
      } catch (error) {
        console.error('[Terminal] Error parsing message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[Terminal] WebSocket error:', error);
      terminal.writeln('\x1b[31m✗ Connection error\x1b[0m');
      onError?.('Connection error');
    };

    ws.onclose = (event) => {
      terminal.writeln('');
      if (event.code === 1008) {
        terminal.writeln('\x1b[31m✗ Unauthorized: Invalid or expired token\x1b[0m');
        onError?.('Unauthorized');
      } else {
        terminal.writeln('\x1b[31m✗ Connection closed\x1b[0m');
      }
      onDisconnect?.();
    };

    // 终端输入 -> WebSocket
    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // 监听窗口大小变化
    window.addEventListener('resize', handleResize);

    // 清理函数
    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      
      terminal.dispose();
      terminalInstance.current = null;
      wsRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, cwd, token, onDisconnect, onConnected, onError, handleResize]);

  /**
   * 手动调整终端大小
   */
  const resize = useCallback(() => {
    handleResize();
  }, [handleResize]);

  /**
   * 清空终端
   */
  const clear = useCallback(() => {
    if (terminalInstance.current) {
      terminalInstance.current.clear();
    }
  }, []);

  /**
   * 重连终端
   */
  const reconnect = useCallback(() => {
    // 关闭现有连接
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    // 重新初始化会触发 useEffect 重新执行
    // 这里需要改变 sessionId 或其他依赖来触发重连
  }, []);

  return (
    <div 
      ref={terminalRef} 
      className={`w-full h-full min-h-[200px] bg-[#1e1e1e] rounded-lg overflow-hidden ${className}`}
      style={{ padding: '8px' }}
    />
  );
}
