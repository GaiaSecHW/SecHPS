// src/lib/skill-init.ts
/**
 * Skills 初始化模块
 *
 * 应用启动时检查 data/skills 目录是否存在
 * 不存在则从数据库同步所有 Skills
 */

import { ensureSkillsDataDir } from '@/services/skill-files';
import { logger, LOG_MODULES } from '@/lib/logger';

let initialized = false;

/**
 * 初始化 Skills 数据目录
 * 在应用启动时调用
 */
export async function initializeSkillsData(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    logger.info(LOG_MODULES.SKILL, '检查 Skills 数据目录...');
    await ensureSkillsDataDir();
    initialized = true;
    logger.info(LOG_MODULES.SKILL, 'Skills 数据目录初始化完成');
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '初始化失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    // 不抛出错误，允许应用继续运行
  }
}

/**
 * 在 Node.js 环境中自动初始化
 * 仅在服务端执行
 */
if (typeof window === 'undefined') {
  // 延迟初始化，避免阻塞应用启动
  setImmediate(() => {
    initializeSkillsData().catch(err => {
      logger.error(LOG_MODULES.SKILL, '自动初始化失败', { details: { error: err instanceof Error ? err.message : String(err) } });
    });
  });
}
