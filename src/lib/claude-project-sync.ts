// src/lib/claude-project-sync.ts

import { join } from 'path';
import { homedir } from 'os';
import { mkdir, readFile, writeFile, access, rm } from 'fs/promises';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * Claude 项目配置接口
 */
interface ClaudeProjectConfig {
  projects: {
    [projectName: string]: {
      originalPath: string;
      createdAt: string;
      lastAccessedAt?: string;
      metadata?: {
        name?: string;
        description?: string;
        SecHPSProjectId?: string;
      };
    };
  };
}

/**
 * Claude 项目管理器
 * 负责同步 SecHPS 项目到 Claude 本地工作区
 */
export class ClaudeProjectManager {
  private claudeProjectsDir: string;
  private configPath: string;

  constructor() {
    this.claudeProjectsDir = join(homedir(), '.claude', 'projects');
    this.configPath = join(this.claudeProjectsDir, 'project-config.json');
  }

  /**
   * 确保 Claude 项目目录存在
   */
  private async ensureClaudeProjectsDir(): Promise<void> {
    try {
      await mkdir(this.claudeProjectsDir, { recursive: true });
    } catch (error) {
      logger.error(LOG_MODULES.PROJECT, '创建 Claude 项目目录失败', { details: { error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  /**
   * 读取 Claude 项目配置
   */
  private async readConfig(): Promise<ClaudeProjectConfig> {
    try {
      const data = await readFile(this.configPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // 配置文件不存在或解析失败，返回默认配置
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info(LOG_MODULES.PROJECT, '项目配置文件不存在，将使用默认配置');
      } else {
        logger.warn(LOG_MODULES.PROJECT, '读取项目配置失败，使用默认配置', { details: { error: error instanceof Error ? error.message : String(error) } });
      }
      return { projects: {} };
    }
  }

  /**
   * 写入 Claude 项目配置
   */
  private async writeConfig(config: ClaudeProjectConfig): Promise<void> {
    await this.ensureClaudeProjectsDir();
    await writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * 清理项目名称（移除特殊字符）
   */
  private sanitizeProjectName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100); // 限制长度
  }

  /**
   * 创建 Claude 项目目录
   * @param projectName SecHPS 项目名称
   * @param projectPath SecHPS 项目路径
   * @param metadata 项目元数据
   */
  async createClaudeProject(
    projectName: string,
    projectPath: string,
    metadata?: {
      description?: string;
      SecHPSProjectId?: string;
    }
  ): Promise<{ claudeProjectDir: string; claudeProjectName: string }> {
    try {
      await this.ensureClaudeProjectsDir();

      const claudeProjectName = this.sanitizeProjectName(projectName);
      const claudeProjectDir = join(this.claudeProjectsDir, claudeProjectName);

      // 创建 Claude 项目目录
      await mkdir(claudeProjectDir, { recursive: true });

      // 创建或更新项目配置
      const config = await this.readConfig();
      config.projects[claudeProjectName] = {
        originalPath: projectPath,
        createdAt: new Date().toISOString(),
        metadata: {
          name: projectName,
          description: metadata?.description,
          SecHPSProjectId: metadata?.SecHPSProjectId,
        },
      };

      await this.writeConfig(config);

      logger.info(LOG_MODULES.PROJECT, '创建 Claude 项目成功', { details: {
        name: claudeProjectName,
        path: claudeProjectDir,
        originalPath: projectPath,
      } });

      return { claudeProjectDir, claudeProjectName };
    } catch (error) {
      logger.error(LOG_MODULES.PROJECT, '创建 Claude 项目失败', { details: { error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  /**
   * 更新 Claude 项目配置
   */
  async updateClaudeProject(
    claudeProjectName: string,
    updates: {
      originalPath?: string;
      metadata?: {
        name?: string;
        description?: string;
        SecHPSProjectId?: string;
      };
    }
  ): Promise<void> {
    try {
      const config = await this.readConfig();

      if (!config.projects[claudeProjectName]) {
        logger.warn(LOG_MODULES.PROJECT, `Claude 项目不存在，跳过更新: ${claudeProjectName}`);
        return;
      }

      if (updates.originalPath) {
        config.projects[claudeProjectName].originalPath = updates.originalPath;
      }

      if (updates.metadata) {
        config.projects[claudeProjectName].metadata = {
          ...config.projects[claudeProjectName].metadata,
          ...updates.metadata,
        };
      }

      config.projects[claudeProjectName].lastAccessedAt = new Date().toISOString();

      await this.writeConfig(config);

      logger.info(LOG_MODULES.PROJECT, `更新 Claude 项目配置成功: ${claudeProjectName}`);
    } catch (error) {
      logger.error(LOG_MODULES.PROJECT, '更新 Claude 项目配置失败', { details: { error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  /**
   * 删除 Claude 项目
   */
  async deleteClaudeProject(claudeProjectName: string): Promise<void> {
    try {
      const claudeProjectDir = join(this.claudeProjectsDir, claudeProjectName);

      // 检查目录是否存在
      try {
        await access(claudeProjectDir);
      } catch {
        logger.warn(LOG_MODULES.PROJECT, `Claude 项目目录不存在，跳过删除: ${claudeProjectDir}`);
        return;
      }

      // 删除目录
      await rm(claudeProjectDir, { recursive: true, force: true });

      // 从配置中移除
      const config = await this.readConfig();
      if (config.projects[claudeProjectName]) {
        delete config.projects[claudeProjectName];
        await this.writeConfig(config);
      }

      logger.info(LOG_MODULES.PROJECT, `删除 Claude 项目成功: ${claudeProjectName}`);
    } catch (error) {
      logger.error(LOG_MODULES.PROJECT, '删除 Claude 项目失败', { details: { error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  /**
   * 根据 SecHPS 项目名称查找 Claude 项目
   */
  async findClaudeProjectByName(SecHPSProjectName: string): Promise<string | null> {
    try {
      const config = await this.readConfig();
      const sanitized = this.sanitizeProjectName(SecHPSProjectName);

      if (config.projects[sanitized]) {
        return sanitized;
      }

      // 尝试模糊匹配
      for (const [key, value] of Object.entries(config.projects)) {
        if (value.metadata?.name === SecHPSProjectName) {
          return key;
        }
      }

      return null;
    } catch (error) {
      logger.error(LOG_MODULES.PROJECT, '查找 Claude 项目失败', { details: { error: error instanceof Error ? error.message : String(error) } });
      return null;
    }
  }

  /**
   * 根据 SecHPS 项目 ID 查找 Claude 项目
   */
  async findClaudeProjectById(SecHPSProjectId: string): Promise<string | null> {
    try {
      const config = await this.readConfig();

      for (const [key, value] of Object.entries(config.projects)) {
        if (value.metadata?.SecHPSProjectId === SecHPSProjectId) {
          return key;
        }
      }

      return null;
    } catch (error) {
      logger.error(LOG_MODULES.PROJECT, '根据 ID 查找 Claude 项目失败', { details: { error: error instanceof Error ? error.message : String(error) } });
      return null;
    }
  }

  /**
   * 列出所有 Claude 项目
   */
  async listClaudeProjects(): Promise<ClaudeProjectConfig['projects']> {
    try {
      const config = await this.readConfig();
      return config.projects;
    } catch (error) {
      logger.error(LOG_MODULES.PROJECT, '列出 Claude 项目失败', { details: { error: error instanceof Error ? error.message : String(error) } });
      return {};
    }
  }
}

// 导出单例实例
export const claudeProjectManager = new ClaudeProjectManager();
