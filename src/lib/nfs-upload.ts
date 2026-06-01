import * as fs from 'fs';
import * as path from 'path';
import { logger, LOG_MODULES } from '@/lib/logger';
import { TASK_INPUT_DIR } from '@/lib/task-creation';

interface NfsConfig {
  mountPath: string;
}

interface GiteaFile {
  path: string;
  content: Buffer;
  size: number;
}

function getNfsConfig(): NfsConfig | null {
  const mountPath = process.env.NFS_MOUNT_PATH;

  if (!mountPath) {
    logger.warn(LOG_MODULES.FILE, 'NFS configuration incomplete: NFS_MOUNT_PATH not set');
    return null;
  }

  return { mountPath };
}

export async function uploadFileToRemote(
  taskId: string,
  fileName: string,
  fileBuffer: Buffer
): Promise<{ remoteFilePath: string; remoteDirPath: string }> {
  const config = getNfsConfig();

  if (!config) {
    throw new Error('NFS configuration is incomplete. Please check NFS_MOUNT_PATH environment variable.');
  }

  const remoteDirPath = path.join(config.mountPath, taskId, TASK_INPUT_DIR);
  const remoteFilePath = path.join(remoteDirPath, fileName);

  fs.mkdirSync(remoteDirPath, { recursive: true });
  fs.writeFileSync(remoteFilePath, fileBuffer);

  return { remoteFilePath, remoteDirPath };
}

export async function testNfsConnection(): Promise<boolean> {
  const config = getNfsConfig();

  if (!config) {
    return false;
  }

  try {
    fs.mkdirSync(config.mountPath, { recursive: true });
    const testFile = path.join(config.mountPath, '.nfs_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return true;
  } catch (error) {
    logger.error(LOG_MODULES.FILE, 'NFS connection test failed', { details: { error: error instanceof Error ? error.message : String(error) } });
    return false;
  }
}

export async function checkRemotePathExists(remotePath: string): Promise<boolean> {
  try {
    return fs.existsSync(remotePath);
  } catch {
    return false;
  }
}

const ARCHIVE_EXTENSIONS = ['.zip', '.tar', '.tar.gz', '.tgz', '.gz'];

function isArchiveFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return ARCHIVE_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  const fileName = path.basename(archivePath);
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.zip')) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(targetDir, true);
  } else if (lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz')) {
    const tar = require('tar');
    await tar.x({ file: archivePath, cwd: targetDir });
  } else if (lowerName.endsWith('.tar')) {
    const tar = require('tar');
    await tar.x({ file: archivePath, cwd: targetDir });
  } else if (lowerName.endsWith('.gz') && !lowerName.endsWith('.tar.gz')) {
    const zlib = require('zlib');
    const input = fs.readFileSync(archivePath);
    const output = zlib.gunzipSync(input);
    const outputPath = archivePath.replace(/\.gz$/i, '');
    fs.writeFileSync(outputPath, output);
  } else {
    throw new Error(`Unsupported archive format: ${fileName}`);
  }

  fs.unlinkSync(archivePath);
}

export async function uploadAndExtractArchive(
  taskId: string,
  fileName: string,
  fileBuffer: Buffer,
  targetDir?: string
): Promise<{ remoteFilePath: string; remoteDirPath: string; extracted: boolean }> {
  const config = getNfsConfig();

  if (!config) {
    throw new Error('NFS configuration is incomplete. Please check NFS_MOUNT_PATH environment variable.');
  }

  const remoteDirPath = targetDir || path.join(config.mountPath, taskId, TASK_INPUT_DIR);
  const remoteFilePath = path.join(remoteDirPath, fileName);

  fs.mkdirSync(remoteDirPath, { recursive: true });
  fs.writeFileSync(remoteFilePath, fileBuffer);

  const isArchive = isArchiveFile(fileName);
  let extracted = false;

  if (isArchive) {
    try {
      await extractArchive(remoteFilePath, remoteDirPath);
      extracted = true;
      logger.info(LOG_MODULES.FILE, `Archive extracted and original file deleted: ${fileName}`);
    } catch (error) {
      logger.error(LOG_MODULES.FILE, `Failed to extract archive: ${fileName}`, { details: { error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  return {
    remoteFilePath: isArchive ? remoteDirPath : remoteFilePath,
    remoteDirPath,
    extracted,
  };
}

export async function uploadFilesToRemote(
  taskId: string,
  files: GiteaFile[],
  targetSubDir?: string
): Promise<{ uploadedCount: number; remoteDirPath: string }> {
  const config = getNfsConfig();

  if (!config) {
    throw new Error('NFS configuration is incomplete. Please check NFS_MOUNT_PATH environment variable.');
  }

  if (files.length === 0) {
    return { uploadedCount: 0, remoteDirPath: '' };
  }

  const baseDirPath = targetSubDir
    ? path.join(config.mountPath, taskId, targetSubDir)
    : path.join(config.mountPath, taskId, TASK_INPUT_DIR);

  fs.mkdirSync(baseDirPath, { recursive: true });

  let uploadedCount = 0;
  let actualProjectPath = baseDirPath;

  if (!targetSubDir && files.length > 0) {
    const firstPathParts = files[0].path.split('/');
    if (firstPathParts.length > 1) {
      const topDir = firstPathParts[0];
      const allInTopDir = files.every(f => f.path.startsWith(`${topDir}/`));
      if (allInTopDir) {
        actualProjectPath = path.join(baseDirPath, topDir);
      }
    }
  }

  for (const file of files) {
    const remoteFilePath = path.join(baseDirPath, file.path);
    const parentDir = path.dirname(remoteFilePath);

    fs.mkdirSync(parentDir, { recursive: true });

    try {
      fs.writeFileSync(remoteFilePath, file.content);
      uploadedCount++;
      logger.info(LOG_MODULES.FILE, `File uploaded: ${file.path}`);
    } catch (uploadError) {
      logger.error(LOG_MODULES.FILE, `Failed to upload file: ${file.path}`, { details: { error: uploadError instanceof Error ? uploadError.message : String(uploadError) } });
    }
  }

  logger.info(LOG_MODULES.FILE, `Uploaded ${uploadedCount}/${files.length} files to ${baseDirPath}`);
  return { uploadedCount, remoteDirPath: actualProjectPath };
}

export { getNfsConfig };