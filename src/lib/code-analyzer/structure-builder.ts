// src/lib/code-analyzer/structure-builder.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectStructure, FileStructureNode, LANGUAGE_MAP } from './types';

/**
 * 项目结构构建器
 */
export class StructureBuilder {
  private projectPath: string;
  private projectId: string;

  constructor(projectPath: string, projectId: string) {
    this.projectPath = projectPath;
    this.projectId = projectId;
  }

  /**
   * 构建项目结构
   */
  async build(): Promise<ProjectStructure> {
    const root: FileStructureNode = {
      name: path.basename(this.projectPath),
      path: '',
      type: 'directory',
      children: [],
    };

    let fileCount = 0;
    let codeCount = 0;
    const languageStats: Record<string, number> = {};

    try {
      await this.buildDirectory(root, this.projectPath, '', {
        fileCount: 0,
        codeCount: 0,
        languageStats,
      });

      // 统计文件数量
      const stats = await this.countFiles(this.projectPath);
      fileCount = stats.fileCount;
      codeCount = stats.codeCount;
      Object.assign(languageStats, stats.languageStats);

    } catch (error) {
      console.error('[StructureBuilder] 构建结构失败:', error);
    }

    return {
      root,
      fileCount,
      codeCount,
      languageStats,
    };
  }

  /**
   * 递归构建目录结构
   */
  private async buildDirectory(
    node: FileStructureNode,
    dirPath: string,
    relativePath: string,
    stats: { fileCount: number; codeCount: number; languageStats: Record<string, number> }
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // 跳过隐藏文件和常见忽略目录
      if (entry.name.startsWith('.') || this.shouldIgnore(entry.name, entry.isDirectory())) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        const childNode: FileStructureNode = {
          name: entry.name,
          path: relPath,
          type: 'directory',
          children: [],
        };

        await this.buildDirectory(childNode, fullPath, relPath, stats);

        if (childNode.children && childNode.children.length > 0) {
          node.children = node.children || [];
          node.children.push(childNode);
        }
      } else if (entry.isFile()) {
        const ext = entry.name.split('.').pop()?.toLowerCase() || '';
        const language = LANGUAGE_MAP[ext];

        // 只包含代码文件
        if (language) {
          stats.codeCount++;
          stats.languageStats[language] = (stats.languageStats[language] || 0) + 1;

          try {
            const stat = await fs.stat(fullPath);
            const childNode: FileStructureNode = {
              name: entry.name,
              path: relPath,
              type: 'file',
              language,
              size: stat.size,
            };

            node.children = node.children || [];
            node.children.push(childNode);
          } catch {
            // 忽略无法访问的文件
          }
        }
      }
    }
  }

  /**
   * 统计文件数量
   */
  private async countFiles(dirPath: string): Promise<{
    fileCount: number;
    codeCount: number;
    languageStats: Record<string, number>;
  }> {
    const result = {
      fileCount: 0,
      codeCount: 0,
      languageStats: {} as Record<string, number>,
    };

    const countRecursive = async (currentPath: string): Promise<void> => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || this.shouldIgnore(entry.name, entry.isDirectory())) {
          continue;
        }

        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await countRecursive(fullPath);
        } else if (entry.isFile()) {
          result.fileCount++;

          const ext = entry.name.split('.').pop()?.toLowerCase() || '';
          const language = LANGUAGE_MAP[ext];

          if (language) {
            result.codeCount++;
            result.languageStats[language] = (result.languageStats[language] || 0) + 1;
          }
        }
      }
    };

    try {
      await countRecursive(dirPath);
    } catch (error) {
      console.error('[StructureBuilder] 统计文件失败:', error);
    }

    return result;
  }

  /**
   * 判断是否应该忽略
   */
  private shouldIgnore(name: string, isDirectory: boolean): boolean {
    const ignoreDirs = [
      'node_modules',
      'dist',
      'build',
      'out',
      '.next',
      '.git',
      '__pycache__',
      'venv',
      '.venv',
      'env',
      '.env',
    ];

    const ignoreFiles = [
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
    ];

    if (isDirectory) {
      return ignoreDirs.includes(name);
    }

    return ignoreFiles.includes(name);
  }
}
