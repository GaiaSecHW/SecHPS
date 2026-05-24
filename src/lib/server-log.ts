import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const LOG_DIR = process.env.LOG_DIR || join(process.cwd(), 'logs');

let dirReady = false;

function dateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function ensureDir() {
  if (dirReady) return;
  try {
    if (!existsSync(LOG_DIR)) await mkdir(LOG_DIR, { recursive: true });
    dirReady = true;
  } catch {}
}

async function writeToFile(level: string, ...args: unknown[]) {
  try {
    await ensureDir();
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    const line = `[${timestamp()}] [${level.toUpperCase()}] ${msg}\n`;
    await appendFile(join(LOG_DIR, `log-${dateStr()}.log`), line);
  } catch {}
}

export const serverLog = {
  info: (...args: unknown[]) => {
    console.log(`[${timestamp()}]`, ...args);
    writeToFile('info', ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn(`[${timestamp()}]`, ...args);
    writeToFile('warn', ...args);
  },
  error: (...args: unknown[]) => {
    console.error(`[${timestamp()}]`, ...args);
    writeToFile('error', ...args);
  },
};
