import AdmZip from 'adm-zip';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import * as tar from 'tar';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { path7za } = require('7zip-bin') as { path7za: string };

const SUPPORTED_ARCHIVE_MESSAGE = '请上传 ZIP、TAR、TAR.GZ、TGZ 或 7Z 格式的压缩包';

export class ArchiveExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveExtractError';
  }
}

function getArchiveFormat(fileName: string): 'zip' | 'tar' | '7z' {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.rar')) {
    throw new ArchiveExtractError(`暂不支持 RAR 压缩包，${SUPPORTED_ARCHIVE_MESSAGE}`);
  }
  if (lowerName.endsWith('.zip')) return 'zip';
  if (lowerName.endsWith('.tar') || lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz')) return 'tar';
  if (lowerName.endsWith('.7z')) return '7z';
  throw new ArchiveExtractError(`不支持的压缩包格式，${SUPPORTED_ARCHIVE_MESSAGE}`);
}

function normalizeArchivePath(entryPath: string): string | null {
  const normalized = entryPath.replace(/\\+/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) return null;

  const parts = normalized.split('/');
  if (parts.includes('..')) return null;

  return normalized;
}

async function collectExtractedFiles(rootDir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizeArchivePath(path.relative(rootDir, absolutePath));
      if (!relativePath) continue;

      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.set(relativePath, await readFile(absolutePath));
      }
    }
  }

  await walk(rootDir);
  return files;
}

export async function extractArchiveToMap(fileName: string, buffer: Buffer): Promise<Map<string, Buffer>> {
  const format = getArchiveFormat(fileName);

  try {
    if (format === 'zip') {
      const zip = new AdmZip(buffer);
      const files = new Map<string, Buffer>();

      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const entryName = normalizeArchivePath(entry.entryName);
        if (entryName) files.set(entryName, entry.getData());
      }

      return files;
    }

    const tempDir = await mkdtemp(path.join(tmpdir(), 'sechps-harness-'));
    const archivePath = path.join(tempDir, fileName.replace(/[^a-zA-Z0-9_.-]/g, '-'));

    try {
      await writeFile(archivePath, buffer);
      const extractDir = path.join(tempDir, 'extract');
      await mkdir(extractDir, { recursive: true });

      if (format === 'tar') {
        await tar.extract({ file: archivePath, cwd: extractDir, strip: 0 });
      } else {
        await execFileAsync(path7za, ['x', archivePath, `-o${extractDir}`, '-y']);
      }

      try {
        await stat(extractDir);
      } catch {
        return new Map();
      }

      return await collectExtractedFiles(extractDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error instanceof ArchiveExtractError) throw error;
    throw new ArchiveExtractError(`压缩包解压失败，请确认文件完整且格式正确。${SUPPORTED_ARCHIVE_MESSAGE}`);
  }
}
