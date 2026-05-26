import { readdir, unlink, mkdir } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join } from 'path';
import archiver from 'archiver';
import { logger, LOG_MODULES } from '@/lib/logger';

const LOG_DIR = process.env.LOG_DIR || join(process.cwd(), 'logs');

let archiveTimer: ReturnType<typeof setInterval> | null = null;
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
    const archiveDir = join(LOG_DIR, 'archive');
    const range = getLastWeekRange();

    const files = await readdir(LOG_DIR);
    const logFiles = files.filter(f => {
      const match = f.match(/^log-(\d{8})\.log$/);
      return match ? match[1] >= range.start && match[1] <= range.end : false;
    });

    if (logFiles.length === 0) {
      logger.info(LOG_MODULES.MONITOR, `日志归档: 上周(${range.start}~${range.end})无日志文件，跳过`);
      return;
    }

    if (!existsSync(archiveDir)) await mkdir(archiveDir, { recursive: true });

    const zipName = `log-${range.start}-${range.end}.zip`;
    const zipPath = join(archiveDir, zipName);

    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    for (const f of logFiles) {
      archive.file(join(LOG_DIR, f), { name: f });
    }
    await archive.finalize();

    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
    });

    for (const f of logFiles) {
      await unlink(join(LOG_DIR, f));
    }

    logger.info(LOG_MODULES.MONITOR, `日志归档完成: ${zipName}，共 ${logFiles.length} 个文件`);
  } catch (e) {
    logger.error(LOG_MODULES.MONITOR, '日志归档失败', {
      details: { error: e instanceof Error ? e.message : String(e) },
    });
  }
}

export function startLogArchiveScheduler() {
  if (archiveTimer) return;

  const check = () => {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const shanghai = new Date(utc + 8 * 60 * 60000);
    const dayOfWeek = shanghai.getDay() || 7;

    if (dayOfWeek === 1) {
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
