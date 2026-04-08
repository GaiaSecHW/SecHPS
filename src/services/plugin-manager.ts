/**
 * 插件管理器服务
 * 负责插件的发现、安装、卸载、启用/禁用等操作
 */

import { prisma } from '@/lib/prisma';
import type { Plugin, PluginManifest, PluginResponse, PluginType, PluginStatus } from '@/types/plugin';
import * as fs from 'fs';
import * as path from 'path';

// 插件目录路径
const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

/**
 * 插件管理器类
 */
export class PluginManager {
  /**
   * 确保插件目录存在
   */
  private static ensurePluginsDir(): void {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }
  }

  /**
   * 发现插件目录中的所有插件
   */
  static async discoverPlugins(): Promise<PluginManifest[]> {
    this.ensurePluginsDir();
    
    const manifests: PluginManifest[] = [];
    
    try {
      const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const manifestPath = path.join(PLUGINS_DIR, entry.name, 'manifest.json');
        
        if (fs.existsSync(manifestPath)) {
          try {
            const content = fs.readFileSync(manifestPath, 'utf-8');
            const manifest = JSON.parse(content) as PluginManifest;
            manifests.push(manifest);
          } catch (error) {
            console.error(`Failed to read plugin manifest: ${entry.name}`, error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to discover plugins:', error);
    }
    
    return manifests;
  }

  /**
   * 同步插件到数据库
   * 扫描插件目录并同步到数据库
   */
  static async syncPlugins(): Promise<void> {
    const manifests = await this.discoverPlugins();
    
    for (const manifest of manifests) {
      const existingPlugin = await prisma.plugin.findUnique({
        where: { name: manifest.name },
      });
      
      if (!existingPlugin) {
        // 创建新插件记录
        await prisma.plugin.create({
          data: {
            name: manifest.name,
            displayName: manifest.displayName,
            description: manifest.description,
            version: manifest.version,
            author: manifest.author,
            type: manifest.type,
            status: 'inactive',
            pluginPath: path.join(PLUGINS_DIR, manifest.name),
            isEnabled: false,
            isBuiltin: false,
            icon: manifest.icon,
            homepage: manifest.homepage,
            repository: manifest.repository,
          },
        });
      } else {
        // 更新现有插件信息
        await prisma.plugin.update({
          where: { name: manifest.name },
          data: {
            displayName: manifest.displayName,
            description: manifest.description,
            version: manifest.version,
            author: manifest.author,
            type: manifest.type,
            icon: manifest.icon,
            homepage: manifest.homepage,
            repository: manifest.repository,
          },
        });
      }
    }
  }

  /**
   * 获取所有插件列表
   */
  static async getPlugins(): Promise<PluginResponse[]> {
    // 先同步插件
    await this.syncPlugins();
    
    const plugins = await prisma.plugin.findMany({
      orderBy: { createdAt: 'desc' },
    });
    
    return plugins.map(plugin => this.toPluginResponse(plugin));
  }

  /**
   * 获取单个插件
   */
  static async getPlugin(id: string): Promise<PluginResponse | null> {
    const plugin = await prisma.plugin.findUnique({
      where: { id },
    });
    
    if (!plugin) return null;
    
    return this.toPluginResponse(plugin);
  }

  /**
   * 根据名称获取插件
   */
  static async getPluginByName(name: string): Promise<PluginResponse | null> {
    const plugin = await prisma.plugin.findUnique({
      where: { name },
    });
    
    if (!plugin) return null;
    
    return this.toPluginResponse(plugin);
  }

  /**
   * 安装插件
   */
  static async installPlugin(
    manifest: PluginManifest, 
    pluginPath?: string
  ): Promise<PluginResponse> {
    // 检查插件是否已存在
    const existingPlugin = await prisma.plugin.findUnique({
      where: { name: manifest.name },
    });
    
    if (existingPlugin) {
      throw new Error(`插件 ${manifest.name} 已存在`);
    }
    
    // 创建插件记录
    const plugin = await prisma.plugin.create({
      data: {
        name: manifest.name,
        displayName: manifest.displayName,
        description: manifest.description,
        version: manifest.version,
        author: manifest.author,
        type: manifest.type,
        status: 'inactive',
        pluginPath: pluginPath || null,
        isEnabled: false,
        isBuiltin: false,
        icon: manifest.icon,
        homepage: manifest.homepage,
        repository: manifest.repository,
        config: manifest.configSchema ? JSON.stringify(manifest.configSchema) : null,
      },
    });
    
    return this.toPluginResponse(plugin);
  }

  /**
   * 卸载插件
   */
  static async uninstallPlugin(id: string): Promise<void> {
    const plugin = await prisma.plugin.findUnique({
      where: { id },
    });
    
    if (!plugin) {
      throw new Error('插件不存在');
    }
    
    if (plugin.isBuiltin) {
      throw new Error('内置插件不能卸载');
    }
    
    // 如果插件启用，先禁用
    if (plugin.isEnabled) {
      await this.togglePlugin(id, false);
    }
    
    // 删除插件记录
    await prisma.plugin.delete({
      where: { id },
    });
    
    // 如果插件目录存在，删除插件文件
    if (plugin.pluginPath && fs.existsSync(plugin.pluginPath)) {
      try {
        fs.rmSync(plugin.pluginPath, { recursive: true, force: true });
      } catch (error) {
        console.error('Failed to remove plugin directory:', error);
      }
    }
  }

  /**
   * 启用/禁用插件
   */
  static async togglePlugin(id: string, enabled: boolean): Promise<PluginResponse> {
    const plugin = await prisma.plugin.findUnique({
      where: { id },
    });
    
    if (!plugin) {
      throw new Error('插件不存在');
    }
    
    // 更新插件状态
    const updatedPlugin = await prisma.plugin.update({
      where: { id },
      data: {
        isEnabled: enabled,
        status: enabled ? 'active' : 'inactive',
      },
    });
    
    return this.toPluginResponse(updatedPlugin);
  }

  /**
   * 更新插件配置
   */
  static async updatePluginConfig(
    id: string, 
    config: Record<string, any>
  ): Promise<PluginResponse> {
    const plugin = await prisma.plugin.findUnique({
      where: { id },
    });
    
    if (!plugin) {
      throw new Error('插件不存在');
    }
    
    const updatedPlugin = await prisma.plugin.update({
      where: { id },
      data: {
        config: JSON.stringify(config),
      },
    });
    
    return this.toPluginResponse(updatedPlugin);
  }

  /**
   * 获取已启用的插件
   */
  static async getEnabledPlugins(): Promise<PluginResponse[]> {
    const plugins = await prisma.plugin.findMany({
      where: {
        isEnabled: true,
        status: 'active',
      },
      orderBy: { createdAt: 'desc' },
    });
    
    return plugins.map(plugin => this.toPluginResponse(plugin));
  }

  /**
   * 按类型获取插件
   */
  static async getPluginsByType(type: PluginType): Promise<PluginResponse[]> {
    const plugins = await prisma.plugin.findMany({
      where: { type },
      orderBy: { createdAt: 'desc' },
    });
    
    return plugins.map(plugin => this.toPluginResponse(plugin));
  }

  /**
   * 获取插件统计信息
   */
  static async getPluginStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    error: number;
    byType: Record<PluginType, number>;
  }> {
    const plugins = await prisma.plugin.findMany();
    
    const stats = {
      total: plugins.length,
      active: 0,
      inactive: 0,
      error: 0,
      byType: {
        'ui-tab': 0,
        'backend-service': 0,
        'integration': 0,
        'tool': 0,
      } as Record<PluginType, number>,
    };
    
    for (const plugin of plugins) {
      // 统计状态
      if (plugin.status === 'active') stats.active++;
      else if (plugin.status === 'inactive') stats.inactive++;
      else if (plugin.status === 'error') stats.error++;
      
      // 统计类型
      const type = plugin.type as PluginType;
      if (stats.byType[type] !== undefined) {
        stats.byType[type]++;
      }
    }
    
    return stats;
  }

  /**
   * 将数据库插件模型转换为响应格式
   */
  private static toPluginResponse(plugin: any): PluginResponse {
    return {
      id: plugin.id,
      name: plugin.name,
      displayName: plugin.displayName,
      description: plugin.description,
      version: plugin.version,
      author: plugin.author,
      type: plugin.type as PluginType,
      status: plugin.status as PluginStatus,
      config: plugin.config ? JSON.parse(plugin.config) : undefined,
      isEnabled: plugin.isEnabled,
      isBuiltin: plugin.isBuiltin,
      icon: plugin.icon || undefined,
      homepage: plugin.homepage || undefined,
      repository: plugin.repository || undefined,
      createdAt: plugin.createdAt.toISOString(),
      updatedAt: plugin.updatedAt.toISOString(),
    };
  }
}

export default PluginManager;
