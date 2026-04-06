/**
 * 插件运行器服务
 * 负责插件的加载、执行、卸载等运行时操作
 */

import { prisma } from '@/lib/prisma';
import * as path from 'path';
import * as fs from 'fs';
import type {
  PluginResponse,
  PluginType,
  PluginExecutionContext,
  PluginExecutionResult,
  PluginExecutor,
  PluginRuntimeState,
} from '@/types/plugin';

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

// 运行时状态缓存
const runtimeStates = new Map<string, PluginRuntimeState>();

/**
 * 插件运行器类
 */
export class PluginRunner {
  /**
   * 初始化插件运行器
   */
  static async initialize(): Promise<void> {
    // 确保插件目录存在
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }

    // 初始化所有已启用插件的运行时状态
    const enabledPlugins = await prisma.plugin.findMany({
      where: { isEnabled: true },
    });

    for (const plugin of enabledPlugins) {
      runtimeStates.set(plugin.id, {
        pluginId: plugin.id,
        status: 'idle',
        executionCount: 0,
        errorCount: 0,
      });
    }

    console.log(`[PluginRunner] Initialized with ${enabledPlugins.length} enabled plugins`);
  }

  /**
   * 获取运行时状态
   */
  static getRuntimeState(pluginId: string): PluginRuntimeState | undefined {
    return runtimeStates.get(pluginId);
  }

  /**
   * 获取所有运行时状态
   */
  static getAllRuntimeStates(): PluginRuntimeState[] {
    return Array.from(runtimeStates.values());
  }

  /**
   * 加载插件
   */
  static async loadPlugin(plugin: PluginResponse): Promise<void> {
    const state = runtimeStates.get(plugin.id);
    if (state) {
      state.status = 'loading';
    }

    try {
      // 根据插件类型选择加载策略
      const executor = this.getExecutor(plugin.type);
      await executor.load(plugin);

      if (state) {
        state.status = 'idle';
      }

      console.log(`[PluginRunner] Loaded plugin: ${plugin.name}`);
    } catch (error) {
      if (state) {
        state.status = 'error';
        state.lastError = error instanceof Error ? error.message : 'Unknown error';
        state.errorCount++;
      }
      throw error;
    }
  }

  /**
   * 卸载插件
   */
  static async unloadPlugin(plugin: PluginResponse): Promise<void> {
    try {
      const executor = this.getExecutor(plugin.type);
      await executor.unload(plugin);

      const state = runtimeStates.get(plugin.id);
      if (state) {
        state.status = 'unloaded';
      }

      console.log(`[PluginRunner] Unloaded plugin: ${plugin.name}`);
    } catch (error) {
      console.error(`[PluginRunner] Failed to unload plugin ${plugin.name}:`, error);
      throw error;
    }
  }

  /**
   * 执行插件
   */
  static async executePlugin(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult> {
    const startTime = Date.now();
    const state = runtimeStates.get(plugin.id);

    if (!state || state.status === 'unloaded') {
      // 尝试加载插件
      await this.loadPlugin(plugin);
    }

    if (state) {
      state.status = 'running';
    }

    try {
      // 验证插件
      const executor = this.getExecutor(plugin.type);
      const isValid = await executor.validate(plugin);

      if (!isValid) {
        throw new Error('Plugin validation failed');
      }

      // 执行插件
      const result = await executor.execute(plugin, context);

      if (state) {
        state.status = 'idle';
        state.executionCount++;
        state.lastExecution = new Date();
      }

      // 更新数据库统计
      await prisma.plugin.update({
        where: { id: plugin.id },
        data: {
          // 可以添加执行统计字段
        },
      });

      return {
        ...result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      if (state) {
        state.status = 'error';
        state.lastError = error instanceof Error ? error.message : 'Unknown error';
        state.errorCount++;
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 获取插件执行器
   */
  private static getExecutor(type: PluginType): PluginExecutor {
    switch (type) {
      case 'tool':
        return new ToolPluginExecutor();
      case 'backend-service':
        return new BackendServiceExecutor();
      case 'integration':
        return new IntegrationExecutor();
      case 'ui-tab':
        return new UITabExecutor();
      default:
        throw new Error(`Unknown plugin type: ${type}`);
    }
  }

  /**
   * 验证插件完整性
   */
  static async validatePlugin(plugin: PluginResponse): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // 检查插件路径
    if (!plugin.pluginPath && !plugin.isBuiltin) {
      errors.push('Plugin path is missing');
    }

    // 检查插件文件
    if (plugin.pluginPath) {
      const manifestPath = path.join(plugin.pluginPath, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        errors.push('manifest.json not found');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * 工具插件执行器
 */
class ToolPluginExecutor implements PluginExecutor {
  type: PluginType = 'tool';

  async load(plugin: PluginResponse): Promise<void> {
    console.log(`[ToolExecutor] Loading tool plugin: ${plugin.name}`);
  }

  async unload(plugin: PluginResponse): Promise<void> {
    console.log(`[ToolExecutor] Unloading tool plugin: ${plugin.name}`);
  }

  async validate(plugin: PluginResponse): Promise<boolean> {
    return true;
  }

  async execute(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult> {
    const startTime = Date.now();

    try {
      console.log(`[ToolExecutor] Executing tool: ${plugin.name}`, context);

      return {
        success: true,
        data: { message: `Tool ${plugin.name} executed successfully` },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * 后端服务插件执行器
 */
class BackendServiceExecutor implements PluginExecutor {
  type: PluginType = 'backend-service';

  async load(plugin: PluginResponse): Promise<void> {
    console.log(`[BackendExecutor] Loading backend service: ${plugin.name}`);
  }

  async unload(plugin: PluginResponse): Promise<void> {
    console.log(`[BackendExecutor] Unloading backend service: ${plugin.name}`);
  }

  async validate(plugin: PluginResponse): Promise<boolean> {
    return true;
  }

  async execute(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult> {
    const startTime = Date.now();

    try {
      console.log(`[BackendExecutor] Executing service: ${plugin.name}`, context);

      return {
        success: true,
        data: { message: `Service ${plugin.name} executed` },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * 集成插件执行器
 */
class IntegrationExecutor implements PluginExecutor {
  type: PluginType = 'integration';

  async load(plugin: PluginResponse): Promise<void> {
    console.log(`[IntegrationExecutor] Loading integration: ${plugin.name}`);
  }

  async unload(plugin: PluginResponse): Promise<void> {
    console.log(`[IntegrationExecutor] Unloading integration: ${plugin.name}`);
  }

  async validate(plugin: PluginResponse): Promise<boolean> {
    return true;
  }

  async execute(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult> {
    const startTime = Date.now();

    try {
      console.log(`[IntegrationExecutor] Executing integration: ${plugin.name}`, context);

      return {
        success: true,
        data: { message: `Integration ${plugin.name} executed` },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * UI 标签页插件执行器
 */
class UITabExecutor implements PluginExecutor {
  type: PluginType = 'ui-tab';

  async load(plugin: PluginResponse): Promise<void> {
    console.log(`[UITabExecutor] Loading UI tab: ${plugin.name}`);
  }

  async unload(plugin: PluginResponse): Promise<void> {
    console.log(`[UITabExecutor] Unloading UI tab: ${plugin.name}`);
  }

  async validate(plugin: PluginResponse): Promise<boolean> {
    return true;
  }

  async execute(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult> {
    const startTime = Date.now();

    try {
      console.log(`[UITabExecutor] Rendering UI tab: ${plugin.name}`, context);

      // UI 标签页插件返回渲染信息
      return {
        success: true,
        data: {
          component: plugin.name,
          props: context.config || {},
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }
}

export default PluginRunner;
