import * as Minio from 'minio';
import fs from 'node:fs';
import path from 'node:path';
import { logger, LOG_MODULES } from './logger.js';

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '172.31.23.181';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin123';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'codedmap-dbs';
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export { MINIO_BUCKET };

let clientInstance: Minio.Client | null = null;
let bucketEnsured = false;

function getClient(): Minio.Client {
  if (!clientInstance) {
    clientInstance = new Minio.Client({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
      useSSL: MINIO_USE_SSL,
    });
    logger.info(LOG_MODULES.MINIO, `Client initialized: ${MINIO_ENDPOINT}:${MINIO_PORT} bucket=${MINIO_BUCKET} ssl=${MINIO_USE_SSL}`);
  }
  return clientInstance;
}

async function retry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(LOG_MODULES.MINIO, `${label} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms: ${lastError.message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError!;
}

/**
 * Ensure the configured bucket exists (create if missing). Called once at startup.
 */
export async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const client = getClient();
  try {
    const exists = await client.bucketExists(MINIO_BUCKET);
    if (!exists) {
      await client.makeBucket(MINIO_BUCKET);
      logger.info(LOG_MODULES.MINIO, `Created bucket: ${MINIO_BUCKET}`);
    } else {
      logger.info(LOG_MODULES.MINIO, `Bucket exists: ${MINIO_BUCKET}`);
    }
    bucketEnsured = true;
  } catch (err) {
    logger.error(LOG_MODULES.MINIO, `ensureBucket failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Check if an object exists in the bucket.
 */
export async function objectExists(objectName: string): Promise<boolean> {
  const client = getClient();
  try {
    await client.statObject(MINIO_BUCKET, objectName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download an object from MinIO to a local file. Returns true on success.
 */
export async function downloadFile(objectName: string, destPath: string): Promise<boolean> {
  const client = getClient();
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    await retry(async () => {
      const stream = await client.getObject(MINIO_BUCKET, objectName);
      const writeStream = fs.createWriteStream(destPath);
      await new Promise<void>((resolve, reject) => {
        stream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', (err) => { stream.destroy(); reject(err); });
        stream.on('error', (err) => { writeStream.destroy(); reject(err); });
      });
    }, `download ${objectName}`);

    const stat = fs.statSync(destPath);
    if (stat.size === 0) {
      logger.warn(LOG_MODULES.MINIO, 'Downloaded file is empty (0 bytes), treating as failure');
      try { fs.unlinkSync(destPath); } catch { /* best effort */ }
      return false;
    }
    logger.info(LOG_MODULES.MINIO, `Downloaded ${objectName} → ${destPath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    return true;
  } catch (err) {
    logger.warn(LOG_MODULES.MINIO, `downloadFile failed for ${objectName}: ${err instanceof Error ? err.message : String(err)}`);
    if (fs.existsSync(destPath)) {
      try { fs.unlinkSync(destPath); } catch { /* best effort */ }
    }
    return false;
  }
}

/**
 * Upload a local file to MinIO. Returns true on success.
 */
export async function uploadFile(objectName: string, filePath: string): Promise<boolean> {
  const client = getClient();

  try {
    const stat = fs.statSync(filePath);
    logger.info(LOG_MODULES.MINIO, `Uploading ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)}MB) → ${objectName}...`);

    await retry(async () => {
      const result = await client.fPutObject(MINIO_BUCKET, objectName, filePath, {
        'Content-Type': 'application/x-sqlite3',
      });
      logger.info(LOG_MODULES.MINIO, `Upload complete: ${objectName} (etag=${result.etag})`);
    }, `upload ${objectName}`);

    return true;
  } catch (err) {
    logger.error(LOG_MODULES.MINIO, `uploadFile failed for ${objectName}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Upload multiple db files to MinIO under dbs/{targetProduct}/ prefix.
 * Returns the number of successfully uploaded files.
 */
export async function uploadDbFiles(
  targetProduct: string,
  workspaceDir: string,
  dbFiles: string[],
): Promise<{ uploaded: number; failed: number; files: { name: string; success: boolean; size: number }[] }> {
  const results: { name: string; success: boolean; size: number }[] = [];
  let uploaded = 0;
  let failed = 0;

  for (const dbFile of dbFiles) {
    const localPath = path.join(workspaceDir, dbFile);
    if (!fs.existsSync(localPath)) {
      logger.warn(LOG_MODULES.MINIO, `Local db file not found: ${localPath}`);
      continue;
    }

    const stat = fs.statSync(localPath);
    const objectName = `dbs/${targetProduct}/${dbFile}`;
    const success = await uploadFile(objectName, localPath);

    results.push({ name: dbFile, success, size: stat.size });
    if (success) {
      uploaded++;
    } else {
      failed++;
    }
  }

  logger.info(LOG_MODULES.MINIO, `Batch upload complete for ${targetProduct}: ${uploaded} uploaded, ${failed} failed`);
  return { uploaded, failed, files: results };
}

/**
 * Download all db files from MinIO under dbs/{targetProduct}/ prefix.
 * Returns the number of successfully downloaded files.
 */
export async function downloadDbFiles(
  targetProduct: string,
  workspaceDir: string,
  dbFiles: string[],
): Promise<{ downloaded: number; failed: number; files: { name: string; success: boolean; size: number }[] }> {
  const client = getClient();
  const results: { name: string; success: boolean; size: number }[] = [];
  let downloaded = 0;
  let failed = 0;

  // Ensure target directory exists
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  for (const dbFile of dbFiles) {
    const objectName = `dbs/${targetProduct}/${dbFile}`;
    const destPath = path.join(workspaceDir, dbFile);

    // Ensure subdirectory exists (e.g., analysis/)
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const success = await downloadFile(objectName, destPath);

    if (success && fs.existsSync(destPath)) {
      const stat = fs.statSync(destPath);
      results.push({ name: dbFile, success: true, size: stat.size });
      downloaded++;
    } else {
      results.push({ name: dbFile, success: false, size: 0 });
      failed++;
    }
  }

  logger.info(LOG_MODULES.MINIO, `Batch download complete for ${targetProduct}: ${downloaded} downloaded, ${failed} not found`);
  return { downloaded, failed, files: results };
}

/**
 * Check if dbs/{targetProduct}/graph.db exists in MinIO.
 */
export async function graphDbExists(targetProduct: string): Promise<boolean> {
  return objectExists(`dbs/${targetProduct}/graph.db`);
}

/**
 * List all db files for a targetProduct in MinIO.
 */
export async function listDbFiles(targetProduct: string): Promise<string[]> {
  const client = getClient();
  const prefix = `dbs/${targetProduct}/`;
  const files: string[] = [];

  try {
    const objects = client.listObjectsV2(MINIO_BUCKET, prefix, true);
    for await (const obj of objects) {
      // Remove prefix to get relative path
      const relativePath = obj.name.replace(prefix, '');
      if (relativePath.endsWith('.db')) {
        files.push(relativePath);
      }
    }
    logger.info(LOG_MODULES.MINIO, `Found ${files.length} db files for ${targetProduct}`);
    return files;
  } catch (err) {
    logger.error(LOG_MODULES.MINIO, `listDbFiles failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
