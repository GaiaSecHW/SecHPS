import * as Minio from 'minio';
import fs from 'node:fs';
import path from 'node:path';

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
    console.log(`[MinIO] Client initialized: ${MINIO_ENDPOINT}:${MINIO_PORT} bucket=${MINIO_BUCKET} ssl=${MINIO_USE_SSL}`);
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
        console.warn(`[MinIO] ${label} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms: ${lastError.message}`);
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
      console.log(`[MinIO] Created bucket: ${MINIO_BUCKET}`);
    } else {
      console.log(`[MinIO] Bucket exists: ${MINIO_BUCKET}`);
    }
    bucketEnsured = true;
  } catch (err) {
    console.error(`[MinIO] ensureBucket failed: ${err instanceof Error ? err.message : String(err)}`);
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
        writeStream.on('error', reject);
        stream.on('error', reject);
      });
    }, `download ${objectName}`);

    const stat = fs.statSync(destPath);
    if (stat.size === 0) {
      console.warn(`[MinIO] Downloaded file is empty (0 bytes), treating as failure`);
      try { fs.unlinkSync(destPath); } catch { /* best effort */ }
      return false;
    }
    console.log(`[MinIO] Downloaded ${objectName} → ${destPath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    return true;
  } catch (err) {
    console.warn(`[MinIO] downloadFile failed for ${objectName}: ${err instanceof Error ? err.message : String(err)}`);
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
    console.log(`[MinIO] Uploading ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)}MB) → ${objectName}...`);

    await retry(async () => {
      const result = await client.fPutObject(MINIO_BUCKET, objectName, filePath, {
        'Content-Type': 'application/x-sqlite3',
      });
      console.log(`[MinIO] Upload complete: ${objectName} (etag=${result.etag})`);
    }, `upload ${objectName}`);

    return true;
  } catch (err) {
    console.error(`[MinIO] uploadFile failed for ${objectName}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
