import * as Minio from 'minio';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';

// ============================================================================
// MinIO Config
// ============================================================================

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '172.31.23.181';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin123';
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const MINIO_HARNESS_BUCKET = process.env.MINIO_HARNESS_BUCKET || 'agent-harness';

// ============================================================================
// Client Singleton
// ============================================================================

let client: Minio.Client | null = null;

function getClient(): Minio.Client {
  if (!client) {
    client = new Minio.Client({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
      useSSL: MINIO_USE_SSL,
    });
  }
  return client;
}

async function ensureBucket(bucket: string): Promise<void> {
  const mc = getClient();
  const exists = await mc.bucketExists(bucket);
  if (!exists) {
    await mc.makeBucket(bucket);
    console.log(`[MinIO] Created bucket: ${bucket}`);
  }
}

// ============================================================================
// Agent Harness Operations
// ============================================================================

/**
 * Upload agent harness files to MinIO.
 * Files are stored under {bucket}/{appId}/{relativePath}
 */
export async function uploadAgentHarness(
  appId: string,
  files: Map<string, Buffer>,
): Promise<void> {
  if (files.size === 0) return;

  const mc = getClient();
  const bucket = MINIO_HARNESS_BUCKET;
  await ensureBucket(bucket);

  for (const [relativePath, content] of files) {
    const objectName = `${appId}/${relativePath}`;
    await mc.putObject(bucket, objectName, content, content.length, {
      'Content-Type': 'application/octet-stream',
    });
    console.log(`[MinIO] Uploaded: ${objectName} (${content.length} bytes)`);
  }

  console.log(`[MinIO] Uploaded ${files.size} files for agent ${appId}`);
}

/**
 * Download all agent harness files from MinIO to a local directory.
 * Returns the root directory name if all files share a common prefix, null otherwise.
 */
export async function downloadAgentHarness(
  appId: string,
  destDir: string,
): Promise<string | null> {
  const mc = getClient();
  const bucket = MINIO_HARNESS_BUCKET;
  const prefix = `${appId}/`;

  // Quick check: bucket must exist
  try {
    const exists = await mc.bucketExists(bucket);
    if (!exists) {
      console.log(`[MinIO] Bucket ${bucket} does not exist, skip download`);
      return null;
    }
  } catch (err) {
    console.error(`[MinIO] bucketExists check failed:`, err);
    return null;
  }

  const objectNames: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const stream = mc.listObjects(bucket, prefix, true);
    const timeout = setTimeout(() => {
      stream.destroy();
      resolve();
    }, 10 * 60 * 1000);
    stream.on('data', (obj: { name?: string }) => {
      if (obj.name) objectNames.push(obj.name);
    });
    stream.on('end', () => { clearTimeout(timeout); resolve(); });
    stream.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
  });

  if (objectNames.length === 0) {
    console.log(`[MinIO] No harness files found for agent ${appId}`);
    return null;
  }

  let rootDir: string | null = null;

  for (const objectName of objectNames) {
    const relativePath = objectName.replace(prefix, '');
    if (!relativePath) continue;

    const destPath = join(destDir, relativePath);
    const destPathDir = dirname(destPath);
    await mkdir(destPathDir, { recursive: true });

    await mc.fGetObject(bucket, objectName, destPath);
    console.log(`[MinIO] Downloaded: ${relativePath}`);

    if (!rootDir && relativePath.includes('/')) {
      rootDir = relativePath.split('/')[0];
    }
  }

  console.log(`[MinIO] Downloaded ${objectNames.length} files for agent ${appId}`);
  return rootDir;
}

/**
 * Delete all harness files for an agent from MinIO.
 */
export async function deleteAgentHarness(appId: string): Promise<void> {
  const mc = getClient();
  const bucket = MINIO_HARNESS_BUCKET;
  const prefix = `${appId}/`;

  const objectNames: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const stream = mc.listObjects(bucket, prefix, true);
    stream.on('data', (obj: { name?: string }) => {
      if (obj.name) objectNames.push(obj.name);
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  if (objectNames.length === 0) {
    console.log(`[MinIO] No harness files to delete for agent ${appId}`);
    return;
  }

  for (const objectName of objectNames) {
    await mc.removeObject(bucket, objectName);
  }

  console.log(`[MinIO] Deleted ${objectNames.length} files for agent ${appId}`);
}

/**
 * Check if agent harness files exist in MinIO.
 */
export async function agentHarnessExists(appId: string): Promise<boolean> {
  const mc = getClient();
  const bucket = MINIO_HARNESS_BUCKET;

  const exists = await mc.bucketExists(bucket);
  if (!exists) return false;

  return new Promise((resolve) => {
    const stream = mc.listObjects(bucket, `${appId}/`, true);
    stream.on('data', () => {
      resolve(true);
      stream.destroy();
    });
    stream.on('end', () => resolve(false));
    stream.on('error', () => resolve(false));
  });
}

export async function listHarnessFiles(appId: string): Promise<string[]> {
  const mc = getClient();
  const bucket = MINIO_HARNESS_BUCKET;
  const prefix = `${appId}/`;

  const exists = await mc.bucketExists(bucket);
  if (!exists) return [];

  const files: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const stream = mc.listObjects(bucket, prefix, true);
    stream.on('data', (obj: { name?: string }) => {
      if (obj.name) files.push(obj.name.replace(prefix, ''));
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  return files;
}
