import * as tar from 'tar';
import { mkdir } from 'fs/promises';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { logger, LOG_MODULES } from '@/lib/logger';
import * as Minio from 'minio';

export const WORKSPACE_BUCKET = process.env.MINIO_WORKSPACE_BUCKET || 'workspace';

let _client: Minio.Client | null = null;
let _bucketEnsured = false;

function getClient(): Minio.Client {
  if (_client) return _client;
  _client = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || '172.31.23.181',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  });
  return _client;
}

/** Ensure workspace bucket exists (idempotent) */
export async function ensureWorkspaceBucket(): Promise<void> {
  if (_bucketEnsured) return;
  const client = getClient();
  const exists = await client.bucketExists(WORKSPACE_BUCKET);
  if (!exists) {
    await client.makeBucket(WORKSPACE_BUCKET);
    logger.info(LOG_MODULES.FILE, `MinIO workspace bucket created: ${WORKSPACE_BUCKET}`);
  }
  _bucketEnsured = true;
}

/** Pack a local directory into tar.gz and upload to MinIO */
export async function uploadDirectory(
  localDir: string,
  objectKey: string,
  opts?: { exclude?: string[] },
): Promise<{ objectKey: string; bytes: number }> {
  const client = getClient();
  const exclude = opts?.exclude || [];

  logger.info(LOG_MODULES.FILE, `[MinIO-Upload] 开始打包工作区: localDir=${localDir}, objectKey=${objectKey}, exclude=${exclude.join(',')}`);

  const packStream = tar.c({
    gzip: true,
    cwd: localDir,
    filter: (path: string) => !exclude.some(e => path.startsWith(e + '/') || path === e),
    portable: true,
  }, ['.']);

  // Collect to buffer — MinIO putObject needs content-length
  const chunks: Buffer[] = [];
  for await (const chunk of packStream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const buffer = Buffer.concat(chunks);

  logger.info(LOG_MODULES.FILE, `[MinIO-Upload] 打包完成: ${(buffer.length / 1024 / 1024).toFixed(1)} MB, 开始上传到 bucket=${WORKSPACE_BUCKET}`);

  await client.putObject(WORKSPACE_BUCKET, objectKey, buffer, buffer.length, {
    'Content-Type': 'application/gzip',
  });

  logger.info(LOG_MODULES.FILE, `[MinIO-Upload] 上传成功: bucket=${WORKSPACE_BUCKET}, objectKey=${objectKey}, size=${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
  return { objectKey, bytes: buffer.length };
}

/** Download tar.gz from MinIO and extract to local directory (streaming) */
export async function downloadAndExtract(
  objectKey: string,
  destDir: string,
): Promise<{ bytes: number }> {
  const client = getClient();

  logger.info(LOG_MODULES.FILE, `[MinIO-Download] 开始下载: bucket=${WORKSPACE_BUCKET}, objectKey=${objectKey}, destDir=${destDir}`);

  const dataStream = await client.getObject(WORKSPACE_BUCKET, objectKey);

  logger.info(LOG_MODULES.FILE, `[MinIO-Download] 流已建立, 开始解压到 ${destDir}`);

  await mkdir(destDir, { recursive: true });

  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      cb(null, chunk);
    },
  });

  await pipeline(
    dataStream,
    counter,
    tar.x({ gzip: true, cwd: destDir }),
  );

  logger.info(LOG_MODULES.FILE, `[MinIO-Download] 下载解压成功: bucket=${WORKSPACE_BUCKET}, objectKey=${objectKey}, destDir=${destDir}, size=${(bytes / 1024 / 1024).toFixed(1)} MB`);
  return { bytes };
}

/** Check if a workspace object exists in MinIO */
export async function workspaceObjectExists(objectKey: string): Promise<boolean> {
  try {
    const client = getClient();
    await client.statObject(WORKSPACE_BUCKET, objectKey);
    return true;
  } catch {
    return false;
  }
}
