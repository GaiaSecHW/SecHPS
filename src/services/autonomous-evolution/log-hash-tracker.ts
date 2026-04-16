/**
 * log-hash-tracker.ts
 * 基于文件路径 + 最后修改时间的哈希去重，避免重复处理同一日志文件
 */

import { createHash } from 'crypto';
import { stat } from 'fs/promises';
import { prisma } from '@/lib/prisma';

export function computeFileHash(filePath: string, mtimeMs: number): string {
  return createHash('sha256')
    .update(`${filePath}:${mtimeMs}`)
    .digest('hex');
}

/**
 * 检查文件是否已处理（哈希未变化）
 * 返回 true 表示已处理，可跳过
 */
export async function isAlreadyProcessed(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    const hash = computeFileHash(filePath, s.mtimeMs);
    const record = await prisma.logFileRecord.findUnique({ where: { filePath } });
    return record?.fileHash === hash;
  } catch {
    return false;
  }
}

/**
 * 标记文件已处理，记录哈希
 */
export async function markProcessed(filePath: string, sequenceCount: number): Promise<void> {
  const s = await stat(filePath);
  const hash = computeFileHash(filePath, s.mtimeMs);
  await prisma.logFileRecord.upsert({
    where: { filePath },
    create: { 
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      filePath, 
      fileHash: hash, 
      sequenceCount,
      updatedAt: new Date(),
    },
    update: { fileHash: hash, sequenceCount, processedAt: new Date(), updatedAt: new Date() },
  });
}

/**
 * 清除所有哈希记录（全量重新处理时使用）
 */
export async function clearAllRecords(): Promise<void> {
  await prisma.logFileRecord.deleteMany({});
}
