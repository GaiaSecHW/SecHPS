/**
 * Scheduler 日志模块
 */

export const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: string, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase()}] ${message}`;
}

export const logger = {
  debug(message: string, ...args: unknown[]) {
    if (shouldLog('debug')) console.debug(formatMessage('debug', message), ...args);
  },
  info(message: string, ...args: unknown[]) {
    if (shouldLog('info')) console.info(formatMessage('info', message), ...args);
  },
  warn(message: string, ...args: unknown[]) {
    if (shouldLog('warn')) console.warn(formatMessage('warn', message), ...args);
  },
  error(message: string, ...args: unknown[]) {
    if (shouldLog('error')) console.error(formatMessage('error', message), ...args);
  },
};
