/**
 * Worker 统一日志模块
 * 对齐 Server 侧 src/lib/logger.ts 方案：按天写文件 + 控制台双输出 + 日志归档
 */

import { appendFile, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export const LOG_MODULES = {
  DAEMON: 'DAEMON',
  AGENT: 'AGENT',
  ENV: 'ENV',
  MINIO: 'MINIO',
  PROCESS: 'PROCESS',
  HEARTBEAT: 'HEARTBEAT',
} as const;

let logDirReady = false;
let LOG_DIR = '';

function dateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function formatTimestamp(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).replace(/\//g, '-');
}

async function ensureLogDir() {
  if (logDirReady) return;
  if (!LOG_DIR) LOG_DIR = process.env.LOG_DIR || join(process.cwd(), 'logs');
  if (!existsSync(LOG_DIR)) {
    await mkdir(LOG_DIR, { recursive: true });
  }
  logDirReady = true;
}

async function writeToFile(message: string) {
  try {
    await ensureLogDir();
    await appendFile(join(LOG_DIR, `worker-${dateStr()}.log`), `${message}\n`);
  } catch {}
}

function formatDetails(details?: any): string {
  if (details === undefined || details === null) return '';
  if (typeof details === 'string') return ` ${details}`;
  if (details instanceof Error) return ` ${JSON.stringify({ error: details.message, stack: details.stack })}`;
  return ` ${JSON.stringify(details)}`;
}

function log(level: LogLevel, module: string, message: string, details?: any) {
  const timestamp = formatTimestamp();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}${formatDetails(details)}`;

  switch (level) {
    case 'info': console.log(logMessage); break;
    case 'warn': console.warn(logMessage); break;
    case 'error': console.error(logMessage); break;
    case 'debug':
      if (process.env.NODE_ENV === 'development') {
        console.log(logMessage);
      }
      break;
  }

  if (level !== 'debug' || process.env.NODE_ENV === 'development') {
    writeToFile(logMessage);
  }
}

export const logger = {
  info: (module: string, message: string, details?: any) => log('info', module, message, details),
  warn: (module: string, message: string, details?: any) => log('warn', module, message, details),
  error: (module: string, message: string, details?: any) => log('error', module, message, details),
  debug: (module: string, message: string, details?: any) => log('debug', module, message, details),
};

// ========== Log Archive (每周一 03:00 CST 归档上周日志) ==========

const LOG_ARCHIVE_DAYS = parseInt(process.env.LOG_ARCHIVE_DAYS || '180');
let lastArchiveWeek = '';

function getWeekId(now: Date): string {
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = (now.getTime() - start.getTime() + (start.getDay() || 7) * 86400000) / 86400000;
  return `${now.getFullYear()}-W${Math.ceil(diff / 7)}`;
}

function getLastWeekRange(): { start: string; end: string } {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const shanghai = new Date(utc + 8 * 60 * 60000);
  const dayOfWeek = shanghai.getDay() || 7;
  const mondayThisWeek = new Date(shanghai);
  mondayThisWeek.setDate(shanghai.getDate() - dayOfWeek + 1);
  const mondayLastWeek = new Date(mondayThisWeek);
  mondayLastWeek.setDate(mondayThisWeek.getDate() - 7);
  const sundayLastWeek = new Date(mondayLastWeek);
  sundayLastWeek.setDate(mondayLastWeek.getDate() + 6);

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return { start: fmt(mondayLastWeek), end: fmt(sundayLastWeek) };
}

async function archiveLastWeekLogs() {
  try {
    await ensureLogDir();
    const archiveDir = join(LOG_DIR, 'archive');
    if (!existsSync(archiveDir)) await mkdir(archiveDir, { recursive: true });

    const range = getLastWeekRange();
    const files = await readdir(LOG_DIR);
    const logFiles = files.filter(f => {
      const match = f.match(/^worker-(\d{8})\.log$/);
      return match ? match[1] >= range.start && match[1] <= range.end : false;
    });

    if (logFiles.length === 0) return;

    // 压缩为单个 .gz 包
    for (const file of logFiles) {
      const srcPath = join(LOG_DIR, file);
      const gzPath = join(archiveDir, `${file}.gz`);
      await new Promise<void>((resolve, reject) => {
        createReadStream(srcPath)
          .pipe(createGzip())
          .pipe(createWriteStream(gzPath))
          .on('finish', resolve)
          .on('error', reject);
      });
      await unlink(srcPath);
    }

    log('info', LOG_MODULES.DAEMON, `日志归档完成: ${range.start}~${range.end}，共 ${logFiles.length} 个文件`);

    // 删除超过归档保留天数的压缩文件
    const now = Date.now();
    const archiveMs = LOG_ARCHIVE_DAYS * 86400000;
    const archives = await readdir(archiveDir);
    for (const file of archives) {
      const filePath = join(archiveDir, file);
      const fileStat = await stat(filePath);
      if (now - fileStat.mtimeMs > archiveMs) {
        await unlink(filePath);
      }
    }
  } catch {}
}

let archiveTimer: ReturnType<typeof setInterval> | null = null;

export function startLogArchive() {
  const check = () => {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const shanghai = new Date(utc + 8 * 60 * 60000);
    const dayOfWeek = shanghai.getDay() || 7;
    const hour = shanghai.getHours();

    // 每周一凌晨 2~4 点之间触发（每小时检查一次）
    if (dayOfWeek === 1 && hour >= 2 && hour <= 4) {
      const weekId = getWeekId(shanghai);
      if (weekId !== lastArchiveWeek) {
        lastArchiveWeek = weekId;
        archiveLastWeekLogs();
      }
    }
  };
  archiveTimer = setInterval(check, 3600000);
  check();
}
