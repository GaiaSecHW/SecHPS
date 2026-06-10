/**
 * PVC 工作区路径分配 + 清理服务
 */
import fs from 'node:fs';
import { prisma } from '../prisma.js';
import { logger } from '../logger.js';

const WORKSPACE_BASE = process.env.WORKSPACE_BASE_PATH || '/mnt/workspace';
const CLEANUP_RETENTION_DAYS = parseInt(process.env.TASK_CLEANUP_RETENTION_DAYS || '30');

/**
 * 为任务分配工作区路径
 * 规则：
 *   1. 平台指定了 workspacePath → 直接使用
 *   2. 未指定 → 自动生成 /mnt/workspace/{taskId}/
 */
export function allocateWorkspacePath(taskId: string, specified?: string): string {
  if (specified) return specified;
  return `${WORKSPACE_BASE}/${taskId}`;
}

/**
 * 确保工作区目录存在并有正确权限
 */
export function ensureWorkspaceDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logger.info(`[Workspace] Created: ${dirPath}`);
  }
}

/**
 * 清理单个工作区（只清理 PVC 路径）
 */
export function cleanupWorkspace(workspacePath: string): void {
  if (!workspacePath.startsWith(WORKSPACE_BASE)) return; // 不清理非 PVC 路径
  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
    logger.info(`[Workspace] Cleaned: ${workspacePath}`);
  }
}

/**
 * 定时清理过期工作区（每天执行）
 */
export async function cleanupExpiredWorkspaces(): Promise<number> {
  const cutoff = new Date(Date.now() - CLEANUP_RETENTION_DAYS * 86400000);

  const expired = await prisma.codeswarmTask.findMany({
    where: {
      state: { in: ['completed', 'failed'] },
      completedAt: { lt: cutoff },
      workspacePath: { not: null },
    },
    select: { taskId: true, workspacePath: true },
    take: 100,
  });

  for (const t of expired) {
    if (t.workspacePath) {
      cleanupWorkspace(t.workspacePath);
    }
  }

  if (expired.length > 0) {
    logger.info(`[Workspace] Cleaned ${expired.length} expired workspaces`);
  }
  return expired.length;
}
