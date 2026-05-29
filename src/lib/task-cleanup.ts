import * as Minio from 'minio';
import { prisma } from '@/lib/prisma';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { logger, LOG_MODULES } from '@/lib/logger';

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '172.31.23.181';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin123';
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const WORKSPACE_BUCKET = process.env.MINIO_WORKSPACE_BUCKET || 'workspace';

const SHARED_WORKSPACE_BASE = process.env.NFS_MOUNT_PATH || process.env.SHARED_WORKSPACE_PATH || '/data/shared-workspace';
const RESOLVED_SHARED_WORKSPACE_BASE = resolve(SHARED_WORKSPACE_BASE);
const _retentionParsed = parseInt(process.env.TASK_CLEANUP_RETENTION_DAYS || '30', 10);
const RETENTION_DAYS = Number.isFinite(_retentionParsed) && _retentionParsed > 0 ? _retentionParsed : 30;
const MIN_RETENTION_DAYS = 7;
const BATCH_SIZE = 100;

let minioClient: Minio.Client | null = null;

function getMinioClient(): Minio.Client {
  if (!minioClient) {
    minioClient = new Minio.Client({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
      useSSL: MINIO_USE_SSL,
    });
  }
  return minioClient;
}

export async function cleanupExpiredTasks(): Promise<{ cleaned: number; errors: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  if (RETENTION_DAYS < MIN_RETENTION_DAYS) {
    logger.warn(LOG_MODULES.CODESWARM, `[TaskCleanup] TASK_CLEANUP_RETENTION_DAYS=${RETENTION_DAYS} 低于建议最小值 ${MIN_RETENTION_DAYS}`);
  }
  logger.info(LOG_MODULES.CODESWARM, `[TaskCleanup] 开始扫描，截止时间: ${cutoff.toISOString()}，保留天数: ${RETENTION_DAYS}`);

  const tasks = await prisma.taskInstance.findMany({
    where: {
      status: { in: ['completed', 'failed'] },
      completedAt: { not: null, lt: cutoff },
      filesCleanedAt: null,
    },
    select: { id: true, projectPath: true },
    orderBy: { completedAt: 'asc' },
    take: BATCH_SIZE,
  });

  if (tasks.length === 0) {
    logger.info(LOG_MODULES.CODESWARM, '[TaskCleanup] 无过期任务需要清理');
    return { cleaned: 0, errors: 0 };
  }

  logger.info(LOG_MODULES.CODESWARM, `[TaskCleanup] 找到 ${tasks.length} 个过期任务`);

  let cleaned = 0;
  let errors = 0;
  const mc = getMinioClient();

  for (const task of tasks) {
    try {
      const objectKey = `workspaces/${task.id}.tar.gz`;
      try {
        await mc.removeObject(WORKSPACE_BUCKET, objectKey);
        logger.info(LOG_MODULES.CODESWARM, `[TaskCleanup] 已删除 MinIO 对象: ${objectKey}`);
      } catch (e: unknown) {
        if (!isNotFoundError(e)) {
          throw e;
        }
      }

      const taskDir = resolveTaskDirectory(task.id, task.projectPath);
      if (existsSync(taskDir)) {
        await rm(taskDir, { recursive: true, force: true });
        logger.info(LOG_MODULES.CODESWARM, `[TaskCleanup] 已删除 NFS 目录: ${taskDir}`);
      }

      const updateResult = await prisma.taskInstance.updateMany({
        where: {
          id: task.id,
          status: { in: ['completed', 'failed'] },
          completedAt: { not: null, lt: cutoff },
          filesCleanedAt: null,
        },
        data: { filesCleanedAt: new Date() },
      });

      if (updateResult.count === 0) {
        errors++;
        logger.warn(LOG_MODULES.CODESWARM, `[TaskCleanup] 任务状态已变化，未标记 filesCleanedAt: ${task.id}`);
        continue;
      }

      cleaned++;
    } catch (e: unknown) {
      errors++;
      logger.error(LOG_MODULES.CODESWARM, `[TaskCleanup] 清理任务 ${task.id} 失败`, {
        details: { error: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  logger.info(LOG_MODULES.CODESWARM, `[TaskCleanup] 批次完成，清理: ${cleaned}，错误: ${errors}`);
  return { cleaned, errors };
}

function resolveTaskDirectory(taskId: string, projectPath: string | null): string {
  const expectedPath = resolve(RESOLVED_SHARED_WORKSPACE_BASE, taskId);
  if (projectPath && resolve(projectPath) !== expectedPath) {
    throw new Error(`任务目录路径非法: ${projectPath}`);
  }
  return expectedPath;
}

function isNotFoundError(e: unknown): boolean {
  const error = e as { code?: string; statusCode?: number; message?: string };
  return error?.code === 'NoSuchKey'
    || error?.code === 'NoSuchBucket'
    || error?.statusCode === 404
    || String(error?.message || '').includes('does not exist');
}
