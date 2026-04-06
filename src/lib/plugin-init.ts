/**
 * 插件系统初始化
 */

import { PluginRunner } from '@/services/plugin-runner';

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
    console.log('[PluginInit] Plugin system initialized successfully');
  } catch (error) {
    console.error('[PluginInit] Failed to initialize plugin system:', error);
    throw error;
  }
}

/**
 * 检查插件系统是否已初始化
 */
export function isPluginSystemInitialized(): boolean {
  return initialized;
}
