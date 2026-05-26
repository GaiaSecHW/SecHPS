/**
 * 插件系统初始化
 */

import { PluginRunner } from '@/services/plugin-runner';
import { logger, LOG_MODULES } from '@/lib/logger';

let initialized = false;

/**
 * 初始化插件系统
 */
export async function initializePlugins(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    await PluginRunner.initialize();
    initialized = true;
    logger.info(LOG_MODULES.PLUGIN, 'Plugin system initialized successfully');
  } catch (error) {
    logger.error(LOG_MODULES.PLUGIN, 'Failed to initialize plugin system', { details: { error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

/**
 * 检查插件系统是否已初始化
 */
export function isPluginSystemInitialized(): boolean {
  return initialized;
}
